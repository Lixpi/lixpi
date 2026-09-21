---
title: Dependency Version Registry Operations
description: Docker commands for release review, apply, exact selections, drift checks, native metadata maintenance, and failure diagnosis.
---

# Dependency Version Registry Operations

Run every registry command from the repository root through [`docker-compose.versions-registry.yml`](../../../docker-compose.versions-registry.yml). The offline service checks or synchronizes committed declarations. The update service contacts publishers and requires a release review before it changes a selected release.

[Configuration](CONFIGURATION.md) defines catalogs, selectors, references, and container inputs. [Architecture](ARCHITECTURE.md) explains what each command does before it writes.

## Commands

| Task | Command |
|---|---|
| List update selectors | `docker compose -f docker-compose.versions-registry.yml run --rm --no-deps -T versions-registry-update list` |
| Dry-run selected updates | `docker compose -f docker-compose.versions-registry.yml run --rm --no-deps -T versions-registry-update apply --dry-run <selectors...>` |
| Apply selected updates | `docker compose -f docker-compose.versions-registry.yml run --rm --no-deps -T versions-registry-update apply <selectors...>` |
| Synchronize manually edited catalogs | `docker compose -f docker-compose.versions-registry.yml run --rm --no-deps -T versions-registry sync` |
| Check repository drift | `docker compose -f docker-compose.versions-registry.yml run --rm --no-deps -T versions-registry check` |

The `run` commands create disposable containers and do not start application services. `--no-deps` prevents Compose from starting unrelated services. `-T` disables pseudo-terminal allocation so CI and agent runs receive stable output.

## List dependencies and groups

Run `list` before constructing a selector when you do not know the exact group or canonical name:

```bash
docker compose -f docker-compose.versions-registry.yml run --rm --no-deps -T versions-registry-update list
```

The output lists each group followed by qualified selectors such as `npmPackages:typescript`, `goModules:github.com/nats-io/nats.go`, `runtimes:node`, and `containerImages:alpine`. Those names come from the live catalogs and resolver, so the list remains accurate when dependencies are added or removed.

## Dry-run an update

A dry run is the review step. It resolves the newest stable publisher release, including a newer major, and returns the available release material between the selected and proposed versions. It does not change a catalog or native consumer.

Review one dependency:

```bash
docker compose -f docker-compose.versions-registry.yml run --rm --no-deps -T versions-registry-update apply --dry-run npmPackages:typescript
```

Review a complete group:

```bash
docker compose -f docker-compose.versions-registry.yml run --rm --no-deps -T versions-registry-update apply --dry-run goTools
```

Review several dependencies and groups as one union:

```bash
docker compose -f docker-compose.versions-registry.yml run --rm --no-deps -T versions-registry-update apply --dry-run npmPackages:typescript goTools:gopls containerImages:alpine
```

Review every update coordinate:

```bash
docker compose -f docker-compose.versions-registry.yml run --rm --no-deps -T versions-registry-update apply --dry-run all
```

The command prints changed dependencies only after resolving the full selected scope. Each changed dependency includes the selected version, proposed version, release-history source, and release bodies, official Node.js changelog sections, or commit messages. The same structured result is written to the ignored `reports/update-plan.json` inspection artifact.

An `unavailable` review means the target version could be resolved but the resolver could not obtain complete upstream release information. Do not infer migration safety from that absence. Actual apply refuses that changed dependency.

Large groups can make many GitHub requests. Set `GITHUB_TOKEN` in the invoking environment when GitHub rate limits would otherwise interrupt the review, then run the same Docker Compose command.

The Compose service passes the token into the disposable update container. The report records source URLs and release data, not the token.

## Review repository compatibility

Read the release material before apply. A major target is expected to require inspection; a minor or patch target can also change runtime requirements, supported platforms, generated formats, or transitive constraints.

Check the code and deployment surfaces that use the dependency. Common examples include:

- source imports and removed APIs;
- Node.js or Go language requirements;
- Docker base-image distribution changes;
- AWS Lambda runtime availability for a Node.js major;
- CLI flag and output changes used by Dockerfiles or scripts;
- Go module-path changes required by semantic import versioning;
- peer dependency and package-manager requirements;
- provider SDK request shapes, parameters, model compatibility, and generated types.

If an SDK update changes AI provider requests, defaults, parameters, compatibility, or model handling, follow the [AI Model Registry contract](../../../services/ai-model-registry/documentation/AI-MODEL-REGISTRY.md) in the same implementation iteration. A dependency version change does not override that code/data synchronization requirement.

Update the affected repository code before actual apply when the release review identifies a migration. The update command synchronizes version declarations; it does not rewrite application APIs for a new dependency major.

## Apply a reviewed update

Apply the same selector after the compatibility work is ready:

```bash
docker compose -f docker-compose.versions-registry.yml run --rm --no-deps -T versions-registry-update apply npmPackages:typescript
```

`apply` performs a fresh target and release-history lookup. It prints that fresh review before writes, rejects missing release information, creates prospective catalog data in memory, and plans every native consumer change. If planning succeeds, it writes the report, catalogs, and planned native declarations.

Apply can target a dependency, a group, several selectors, or `all`. A group apply succeeds only when every changed dependency in that selection has a complete review and the prospective catalogs can synchronize the whole repository.

The write phase is not a filesystem transaction across the repository. Planning prevents known catalog or native-format errors from starting the write phase, but an operating-system write failure can still stop after an earlier file was written. Inspect `git diff`, repair the filesystem condition, and rerun the same apply or `sync`; generation is deterministic from the catalogs.

After apply, perform the build, quality, module, or service verification required by the affected dependency. Those commands remain governed by the repository's Docker-only command and testing rules.

## Select an exact version manually

Use a manual edit when the desired release is already known and publisher-latest selection is not appropriate. Edit the catalog that owns the dependency, then synchronize:

```bash
docker compose -f docker-compose.versions-registry.yml run --rm --no-deps -T versions-registry sync
docker compose -f docker-compose.versions-registry.yml run --rm --no-deps -T versions-registry check
```

Manual editing does not fetch release notes. Obtain and review the relevant upstream migration material separately before selecting the version.

Do not edit generated version fields in `package.json`, `go.mod`, Dockerfiles, Compose files, or workflows as the primary change. The next synchronization replaces those fields from the catalogs. A direct native edit is useful only while changing the synchronizer or diagnosing its expected output.

## Add a dependency

Register the dependency in its domain catalog before adding or synchronizing the native declaration:

| Dependency | Registration location |
|---|---|
| npm package | `versions/typescript.json` under `npmPackages` |
| Workspace package release | `versions/typescript.json` under `workspacePackages` |
| Go module | `versions/go.json` under `modules` |
| Go development tool | The fixed `tools` section of `versions/go.json` and its resolver when publisher lookup is required |
| External tool | `versions/tools.json` and its update resolver/source mapping |
| External container repository | `versions/container-images.json`; add a Docker argument mapping when a Dockerfile consumes it |
| External GitHub Action | `versions/github-actions.json` |

Use the exact published identity as the key. If the dependency needs latest-release discovery or release review beyond an existing generic path, add its publisher resolver and release-history source under `src/update/`. [Modules and Code Responsibilities](MODULES.md) identifies the module for each concern.

After registration, run `sync` and `check`. Discovery automatically includes a newly added supported native file; no file path needs to be added to the registry.

## Maintain the Go module graph

Changing `go.mod` selections can require Go to recompute minimal-version selection and `go.sum`. The registry cannot calculate that graph because its standalone Node container does not run Go tooling.

Use the appropriate Dockerized module-maintenance command from [Go Testing and Tooling](../../../documentation/code-quality/testing/GO.md). If Go raises or adds a requirement in `go.mod`, update the corresponding `go.modules` selection and run registry synchronization again. `go.sum` remains native checksum metadata and does not become a version catalog.

## Check repository drift

Run the offline check after any catalog, synchronizer, native dependency declaration, Dockerfile, root Compose file, or workflow change:

```bash
docker compose -f docker-compose.versions-registry.yml run --rm --no-deps -T versions-registry check
```

The command prints `Version declarations match the registry.` when the planned change map is empty. Otherwise it lists stale native files and exits unsuccessfully. It can also fail earlier with the file and declaration that uses an unregistered dependency, external image, Action, Docker argument, or unsupported syntax.

CI runs this same read-only check. It has no network access, so CI drift validation does not depend on npm, the Go proxy, Docker Hub, GitHub, Node.js, Go, or Alpine publisher availability.

## Container tags and Dockerfiles

The registry generates explicit container tags. Dockerfiles use registered `*_IMAGE_REFERENCE` arguments for external base images, which lets one selected runtime or tool release update every derived image consumer. Synchronization rejects an external `FROM` that bypasses a registered argument and rejects unregistered managed tool versions. Catalog image selections must use explicit release tags; do not store a floating `latest` tag.

The catalog does not add SHA digest pins. Image selections remain publisher tags. Local `lixpi/*` image names and Docker stage names are not external dependency versions.

## Diagnosing failures

| Symptom | Check |
|---|---|
| `Unknown dependency or group` | Run `versions-registry-update list`; use a qualified `group:name` selector when an unqualified name is ambiguous |
| Publisher lookup fails | Check network access, the reported URL, publisher availability, and `GITHUB_TOKEN` rate-limit capacity |
| Review is `unavailable` | Check the dependency's repository metadata, registered GitHub source, tag prefixes, release bodies, and comparable source tags |
| Apply refuses several group members | Read each unavailable entry in `update-plan.json`; a group apply requires complete release information for every changed member |
| `Generated version declarations are stale` | Run `sync`, inspect the diff, and confirm the catalog owns the intended value |
| Package synchronization says `Register <name>` | Add the exact npm or workspace package key, or restore a local `workspace:`, `file:`, or `link:` declaration |
| Go synchronization says `Register Go module` | Add the exact module path and selected version under `go.modules` |
| Dockerfile requires a registered image argument | Add the external repository to `container-images.json`, map a descriptive `*_IMAGE_REFERENCE`, and declare its generated default before `FROM` |
| Compose reports an unregistered external image | Add the exact repository to `container-images.json`; keep local build outputs under `lixpi/*` |
| Workflow reports an unregistered Action | Add the exact external Action repository and selected release to `github-actions.json` |
| Circular or unknown catalog reference | Follow each `{{catalog.path}}` from the combined catalog root and remove the cycle, typo, or unsupported transform |
| Go build reports missing checksums or a raised transitive version | Maintain the module graph in the Dockerized Go tooling flow, update changed declarations in the catalog, then synchronize again |
| An apply stopped during file writes | Inspect `git diff`, fix the filesystem failure, and rerun apply or `sync` from the authoritative catalogs |
