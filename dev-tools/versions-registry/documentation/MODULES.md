---
title: Dependency Version Registry Modules and Code Responsibilities
description: What each registry module does, why the responsibilities are separate, and where a versioning change belongs.
---

# Dependency Version Registry Modules and Code Responsibilities

The source separates three jobs. `shared` reads registry data and repository files. `sync` translates selected releases into native file formats. `update` contacts publishers, collects release evidence, and changes selected values after review. Keeping those jobs separate lets the offline CI check use the catalogs and synchronizers without network access or publisher-specific code.

[Architecture](ARCHITECTURE.md) shows the data flow and apply sequence. [Configuration](CONFIGURATION.md) defines the files and inputs that these modules read. [Operations](OPERATIONS.md) gives the Docker commands that enter each path.

## Command composition

[`src/sync/command.ts`](../src/sync/command.ts) owns the offline `check` and `sync` entry points. It constructs `RepositoryFiles` and `VersionCatalog`, asks `planRepositorySynchronization` for the complete change map, and either reports drift or writes that map. It does not know package, Go, Docker, Compose, or workflow syntax.

[`src/update/command.ts`](../src/update/command.ts) owns `list`, `apply --dry-run`, and `apply`. It parses selectors, batches publisher requests, joins target versions with release reviews, prints the review, writes the local update plan, builds prospective catalog data, and invokes the same repository synchronization planner used by `sync`.

The update command resolves and reviews every selected dependency before it builds prospective data. Actual apply refuses changed dependencies whose release review is `unavailable`. It creates the native-file plan before writing the catalogs, so an unregistered or unsupported native declaration fails the command before an authoritative catalog change.

Both commands are plain Node entry points. [`docker-compose.versions-registry.yml`](../../../docker-compose.versions-registry.yml) supplies the repository mount, Node image, working directory, network policy, optional GitHub token, and entrypoint. The offline service has no network. The update service has network access because publisher resolution requires it.

## Repository and catalog access

[`src/shared/repository-files.ts`](../src/shared/repository-files.ts) confines filesystem access to the repository root or registry root. It rejects absolute paths, paths that escape their root, and existing registry paths resolved through symlinks. JSON writes use four-space indentation and a final newline.

`RepositoryFiles.discoverNativeConsumerPaths()` recursively finds supported consumers. It ignores the registry itself, VCS metadata, agent configuration, package caches, virtual environments, fixtures, generated build output, and vendored test data. The discovery rule recognizes:

- `package.json` files anywhere outside ignored directories;
- `go.mod` files anywhere outside ignored directories;
- files whose names contain `Dockerfile` or `dockerfile`;
- root `docker-compose*.yml` and `docker-compose*.yaml` files;
- `.github/workflows/*.yml` and `.github/workflows/*.yaml`.

[`src/shared/version-catalog.ts`](../src/shared/version-catalog.ts) loads the five catalog files and the Docker build-argument adapter. `VersionCatalog` exposes the typed catalog data, resolves `{{...}}` templates, applies supported transforms, expands image tags, and builds the final Docker argument values.

Reference resolution tracks ancestor paths. Re-entering an ancestor is a circular reference and fails. A reference also fails when its path does not exist, resolves to a non-string or multiline value, or uses a transform other than `major`. These checks run when the catalog is constructed or a referenced value is requested.

## Native format synchronization

[`src/sync/repository-synchronizer.ts`](../src/sync/repository-synchronizer.ts) selects a synchronizer from the path, compares generated output with the source, and returns only changed files. Its planner does not write. `writeRepositoryChanges` is the separate commit step.

This split matters for both command paths. `check` can report drift without mutation. `sync` can validate every consumer before its first write. `apply` can test a prospective catalog against the entire repository before changing the authoritative catalog files.

### Package manifests

[`src/sync/package-json-synchronizer.ts`](../src/sync/package-json-synchronizer.ts) parses each manifest and processes `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`, `overrides`, and `resolutions`. Every ordinary dependency name must exist in either `typescript.npmPackages` or `typescript.workspacePackages`.

`workspace:`, `file:`, and `link:` values keep their native declarations because they identify local resolution rather than a publisher release. A versioned workspace package must have a name registered under `workspacePackages`. A manifest with `packageManager` must use pnpm, and synchronization writes the selected `pnpm@<version>` value.

The synchronizer preserves the manifest's detected indentation and writes a final newline. Unsupported dependency collections or non-string dependency declarations fail instead of being passed through silently.

### Go modules

[`src/sync/go-module-synchronizer.ts`](../src/sync/go-module-synchronizer.ts) requires exactly one `go` language directive and replaces it with `go.go`. It handles both requirement blocks and single-line requirements. Each module path must exist under `go.modules`; the selected value replaces the native version while trailing comments such as `// indirect` remain attached.

This module changes `go.mod`, not `go.sum`. Go computes the module graph and checksum file. [Operations](OPERATIONS.md#maintain-the-go-module-graph) explains the required follow-up after applying a Go selection.

### Dockerfiles

[`src/sync/dockerfile-synchronizer.ts`](../src/sync/dockerfile-synchronizer.ts) reads registered Docker build arguments from `VersionCatalog`. A managed argument has a name ending in `_VERSION` or `_IMAGE_REFERENCE` and receives its generated default from the adapter. A later redeclaration without a default is accepted only after the generated default was declared earlier in the Dockerfile.

Every external `FROM` must use a registered argument. The accepted exceptions are `scratch`, an earlier stage name, and a local image argument whose default starts with `lixpi/`. The synchronizer also rejects direct versioned pnpm, TypeScript, and `go install` expressions so those tool selections cannot bypass the catalog.

### Compose files and workflows

[`src/sync/docker-compose-synchronizer.ts`](../src/sync/docker-compose-synchronizer.ts) extracts an image repository from each root Compose `image:` declaration and writes the complete selected reference. External repositories must exist in `container-images.json`. Local repositories starting with `lixpi/` remain untouched.

[`src/sync/github-actions-synchronizer.ts`](../src/sync/github-actions-synchronizer.ts) rewrites external `uses:` declarations from `github-actions.json`. Local `./...` actions and `docker://...` actions retain their native references. Any other unregistered Action fails with its file and line number.

## Dependency selection

[`src/update/dependency-selector.ts`](../src/update/dependency-selector.ts) defines the update groups and turns command arguments into canonical dependency coordinates. `all` expands every available coordinate. A group name expands that group. `group:name` selects one exact entry. An unqualified name is accepted only when it matches one coordinate across all groups. Several arguments form a deduplicated union.

The selector works from `LatestReleaseResolver.availableDependencies()`. Derived container image entries are excluded because their tags come from another canonical selection. For example, the Node.js image updates through `runtimes:node`, not through a second independent container-image update.

## Latest-release resolution

[`src/update/latest-release-resolver.ts`](../src/update/latest-release-resolver.ts) maps dependency groups to publisher APIs. It does not constrain a result to the currently selected major.

| Resolver path | Publisher behavior |
|---|---|
| npm package and pnpm | Read the npm `latest` metadata |
| Go module and `gopls` | Read Go proxy `@latest` metadata for the exact module path |
| Node.js | Take the first stable semantic release from the Node.js distribution index |
| Go runtime | Take the first entry marked stable by Go download metadata |
| GitHub-backed tool or Action | Read the latest stable GitHub release |
| Alpine | Read the latest stable Alpine release metadata |
| Docker Hub image | Walk every tag page and select the highest stable three-part semantic tag |

Go semantic-import major suffixes remain part of the module path. A release under a different path such as `/v3` is a different dependency identity and requires source imports and the catalog key to change together.

[`src/update/release-client.ts`](../src/update/release-client.ts) performs JSON and text requests with a request timeout, caches repeated URLs during one command, records the source URL and selected version, and processes lookups in bounded batches. GitHub requests use the configured API version and include `GITHUB_TOKEN` when supplied.

## Release review

[`src/update/release-notes-resolver.ts`](../src/update/release-notes-resolver.ts) chooses a release-history source for each changed dependency and delegates to the matching resolver. An unchanged dependency produces an `unchanged` review without another release-history request.

[`src/update/release-notes-sources.ts`](../src/update/release-notes-sources.ts) contains the mapping from canonical dependency identities to GitHub repositories and tag prefixes. For npm packages it reads the repository field from npm metadata. A monorepo package with a repository directory uses package-qualified tag prefixes and does not accept unqualified repository tags. GitHub Go module paths derive their repository and module subpath from the module identity.

[`src/update/node-release-notes.ts`](../src/update/node-release-notes.ts) reads every official major-version changelog that intersects the selected-to-target range. It extracts each release section, sorts the releases from the selected version toward the target, and returns the full Markdown section.

[`src/update/github-release-notes.ts`](../src/update/github-release-notes.ts) walks stable GitHub releases until it reaches the selected version or exhausts the result. If every matching release has a body, those release bodies form the review. If bodies are missing or no release matches, it tries the valid source-tag forms and requests a paginated commit comparison. A comparison is accepted only when every reported commit is present. Pseudo-version commit hashes are also tried as comparison references.

[`src/update/semantic-version.ts`](../src/update/semantic-version.ts) owns the small semantic-version parser and ordering operations used only for release-range selection. [`src/update/release-notes.ts`](../src/update/release-notes.ts) defines the review and change shapes shared by the resolvers.

## Catalog updates and writes

[`src/update/catalog-updater.ts`](../src/update/catalog-updater.ts) applies a resolved release to cloned catalog data. npm entries that are direct values change in `npmPackages`. An npm entry that consists of one `{{catalog.path}}` reference updates that referenced canonical value instead, which prevents a derived alias from becoming a second independent selection.

The updater handles each dependency group explicitly and rejects unknown package managers, runtimes, tools, and Go tools. After planning succeeds, `writeVersionCatalogs` writes all catalog files in their stable JSON format. The update command then writes the already-planned native consumer changes.
