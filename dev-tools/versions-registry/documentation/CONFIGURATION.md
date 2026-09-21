---
title: Dependency Version Registry Configuration
description: Catalog ownership, reference syntax, Docker argument mappings, update selectors, publisher sources, and container inputs.
---

# Dependency Version Registry Configuration

The registry configuration consists of five version catalogs, one Docker build-argument adapter, and two Compose command services. The catalog files hold release selections. The adapter translates Docker-specific argument names to catalog paths. Compose controls filesystem and network access for the offline and publisher-backed commands.

[Architecture](ARCHITECTURE.md) explains how these inputs flow into native files. [Operations](OPERATIONS.md) provides the commands that use them.

## Version catalogs

All catalog files live under [`versions/`](../versions/). Keys identify the upstream dependency. Values are exact selected releases, image tags, workspace package versions, or reference templates.

| Catalog | Sections and values |
|---|---|
| [`typescript.json`](../versions/typescript.json) | `node`, `pnpm`, exact `npmPackages` names, and exact `workspacePackages` names |
| [`go.json`](../versions/go.json) | `go`, exact Go `modules` paths, and the `gopls`, `dlv`, and `golangci-lint` tools |
| [`tools.json`](../versions/tools.json) | Upstream tool names such as `fnm`, `nex`, and `pulumi` |
| [`container-images.json`](../versions/container-images.json) | External image repositories mapped to selected tag values or templates |
| [`github-actions.json`](../versions/github-actions.json) | External Action repositories mapped to selected release references |

Catalog keys do not repeat their type. Use `node`, not `nodeVersion`; use `fnm`, not `fastNodeManagerVersion`; use the complete package or module name instead of an invented alias. The file and enclosing section provide the domain context.

Workspace package versions are release values for packages built from this repository. They are not publisher lookup targets. The update command exposes `npmPackages`, but it does not offer a `workspacePackages` group.

## Values that stay outside the registry

The registry holds dependency and tool release selections. It does not hold every string that contains a number or every package name used by an image.

Keep these values with their existing owners:

- unversioned operating-system package names such as `curl`, `jq`, `rsync`, `ffmpeg`, and `libreoffice`;
- application schema and protocol versions;
- deployment-generated resource names and identifiers;
- AI model IDs, provider parameters, capability rules, and model prices;
- source compatibility decisions that require a code migration;
- native checksums and graph metadata such as `go.sum`.

If a Dockerfile intentionally pins a distribution package to a release expression, keep that expression in the Dockerfile because its meaning depends on the image distribution and configured repositories.

## Catalog references

A string can reuse another catalog value with `{{catalog.path}}`. The reference path starts at the combined catalog object, whose top-level keys are `typescript`, `go`, `tools`, `containerImages`, and `githubActions`.

```json
{
    "node": "{{typescript.node}}-alpine",
    "public.ecr.aws/lambda/nodejs": "{{typescript.node|major}}",
    "golang": "{{go.go}}-bookworm",
    "pulumi/pulumi": "{{tools.pulumi}}"
}
```

Templates can combine literal text and one or more references. `{{typescript.node}}-alpine` resolves a complete Node.js release into a Node image tag. The `major` transform resolves the referenced value first, then keeps the text before its first dot. No other transforms are supported.

References must resolve to one nonempty string. Unknown paths, circular references, multiline values, and unknown transforms fail catalog construction. An npm package can consist of one direct reference, such as `"@pulumi/pulumi": "{{tools.pulumi}}"`. Applying an update through that npm selector changes `tools.pulumi`, which remains the canonical selection.

## Docker build-argument adapter

[`consumers/docker-build-arguments.json`](../consumers/docker-build-arguments.json) maps Dockerfile argument names to catalog identities. It does not contain Dockerfile paths or matching expressions.

| Adapter section | Reference base | Example |
|---|---|---|
| `containerImages` | Repository key in `container-images.json` | `NODE_JS_ALPINE_IMAGE_REFERENCE` maps to `node` |
| `typescript` | Path below `typescript` | `NODE_VERSION` maps to `node` |
| `go` | Path below `go` | `GOPLS_VERSION` maps to `tools.gopls` |
| `tools` | Path below `tools` | `NEX_VERSION` maps to `nex` |

Use a descriptive Docker interface name where the Dockerfile needs context. `NODE_JS_ALPINE_IMAGE_REFERENCE` identifies a complete image reference, while the canonical container-image key remains the published repository name `node`. Tool arguments use their upstream name, including `FNM_VERSION`, `NEX_VERSION`, `GOPLS_VERSION`, and `DLV_VERSION`.

A registered argument must declare its generated default before a later stage redeclares it without a default. An unregistered argument ending in `_VERSION` or `_IMAGE_REFERENCE` fails synchronization when it declares a default.

## Native consumer discovery

Consumers are discovered from repository structure. There is no per-file registry.

| Native consumer | Discovery rule |
|---|---|
| Package manifest | Any `package.json` outside ignored directories |
| Go module | Any `go.mod` outside ignored directories |
| Dockerfile | A file name containing `Dockerfile` or `dockerfile` |
| Compose file | A root `docker-compose*.yml` or `docker-compose*.yaml` |
| GitHub Actions workflow | `.github/workflows/*.yml` or `.github/workflows/*.yaml` |

The registry source directory, dependency caches, virtual environments, VCS metadata, agent configuration, build output, fixtures, test data, and common vendored output directories are excluded. Adding a supported native file outside those locations places it under drift checking automatically.

## Update groups and selectors

`versions-registry-update list` prints the live selector inventory. These groups are accepted by `apply` and `apply --dry-run`:

| Group | Catalog ownership |
|---|---|
| `npmPackages` | `typescript.npmPackages` |
| `goModules` | `go.modules` |
| `packageManagers` | `typescript.pnpm` |
| `runtimes` | `typescript.node` and `go.go` |
| `tools` | `tools` |
| `goTools` | `go.tools` |
| `containerImages` | Direct, non-template values in `containerImages` |
| `githubActions` | `githubActions` |

Selectors have four forms:

| Selector | Meaning |
|---|---|
| `all` | Every dependency exposed by the update resolver |
| `npmPackages` | Every dependency in one group |
| `npmPackages:typescript` | One exact dependency in one group |
| `typescript` | One exact dependency name when that name is unique across groups |

Several selectors form a union. Duplicate coordinates are removed. An unknown group, an unknown qualified dependency, or an ambiguous unqualified name fails before publisher requests begin.

Derived container images are not independent update coordinates. For example, `node`, `public.ecr.aws/lambda/nodejs`, `golang`, `golangci/golangci-lint`, and `pulumi/pulumi` derive their tags from runtime or tool selections. Update the canonical runtime or tool selector and let synchronization update each derived image reference.

## Publisher and release-history sources

[`latest-release-resolver.ts`](../src/update/latest-release-resolver.ts) defines how each update group resolves its target. [`release-notes-sources.ts`](../src/update/release-notes-sources.ts) defines how changed dependencies locate their release history.

npm metadata supplies package repository URLs. GitHub-backed Go module paths derive the repository and any module subpath. Tools, Go tools, special container images, and runtimes that need explicit repositories are registered by their exact canonical names. A dependency with no complete release-history source receives an `unavailable` review.

Changing a publisher or repository mapping belongs in those source modules, not in the version catalog. The catalog says which release is selected; it does not describe how an upstream vendor publishes metadata.

## Command containers

[`docker-compose.versions-registry.yml`](../../../docker-compose.versions-registry.yml) defines two services:

| Service | Network | Entrypoint | Purpose |
|---|---|---|---|
| `versions-registry` | Disabled | `src/sync/command.ts` | Offline `check` and `sync` |
| `versions-registry-update` | Bridge network | `src/update/command.ts` | Publisher-backed `list`, dry run, and apply |

Both services mount the repository at `/workspace` and run from that directory. Their Node image is itself a generated native declaration sourced from the registry.

`versions-registry-update` accepts the optional `GITHUB_TOKEN` environment variable. When set, GitHub API requests send it as a bearer token. Use it for a large update scope that would exceed the anonymous API limit. The token is not written to the update report.

## Update report

The update command writes `reports/update-plan.json`. The file is ignored because it contains a timestamp and the result of the latest local selection. It is an inspection artifact, not another version catalog.

The report contains:

- the retrieval timestamp;
- whether the command was a dry run;
- the selectors supplied to the command;
- current and target versions grouped by dependency domain;
- the publisher URL that supplied the target;
- the release-review status and source;
- complete release bodies, Node.js changelog sections, or commit messages when available.

Dry run writes this report without changing authoritative catalogs or native consumers. Apply writes a fresh report before it writes the already-reviewed and planned catalog and native-file changes.
