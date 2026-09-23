# Code Quality Runners

This directory contains the Docker images, entrypoints, tool configuration, fixtures, and reusable Compose services for Lixpi's Go and TypeScript test and quality runners. A consuming repository supplies only its source mounts, cache declarations, and any test-specific privileges.

## Directory layout

| Directory | Purpose |
|-----------|---------|
| [`go-test-runner/`](go-test-runner/README.md) | Go test image and mounted-target dispatcher |
| [`go-quality-runner/`](go-quality-runner/README.md) | Go dependency, formatting, source-convention, and lint runner |
| [`typescript-test-runner/`](typescript-test-runner/README.md) | pnpm workspace assembly and Vitest dispatcher |
| [`typescript-quality-runner/`](typescript-quality-runner/README.md) | TypeScript, HTML, Sass, and CSS formatter and linter toolchain |
| [`runner-compose/`](runner-compose/README.md) | Reusable Compose service definitions with no application source mounts |

The repository-root `docker-compose.*-runner.yml` files are Lixpi's mount adapters. Another repository keeps its own adapters and extends the same base services through an absolute path to this checkout.

## How the Compose layers fit together

Each runner has two Compose layers:

```text
dev-tools/code-quality/runner-compose/*.base.yml
    defines image, build context, entrypoint, tool files, cache mount points
        extended by
<consumer-repository>/docker-compose.*-runner.yml
    defines source mounts, manifest mounts, access mode, cache volumes, privileges
```

Compose `extends` imports the service definition, not top-level resources. The adapter must declare every named volume referenced by the base service. The base and adapter therefore use stable volume names, but each Compose project creates its own physical volumes.

Paths inside a base file are relative to that file under `runner-compose/`. Paths added by an adapter are relative to the consuming Compose project. A sibling repository uses an absolute `extends.file` path so Compose cannot resolve the runner from the wrong checkout:

```yaml
services:
    project-go-test-runner:
        extends:
            file: ${LIXPI_REPOSITORY_PATH:?LIXPI_REPOSITORY_PATH is required}/dev-tools/code-quality/runner-compose/go-test.base.yml
            service: go-test-runner-base
        volumes:
            - ./services/example/go.mod:/usr/src/manifests/example/go.mod:ro,cached
            - ./services/example/go.sum:/usr/src/manifests/example/go.sum:ro,cached
            - ./services/example/cmd:/usr/src/service/example/cmd:ro,cached
            - ./services/example/internal:/usr/src/service/example/internal:ro,cached

volumes:
    go-test-runner-module-cache:
    go-test-runner-build-cache:
```

Required-variable interpolation happens while Compose loads the file, before it creates a container. A missing main-checkout path therefore stops the command before a runner or application script can execute.

## Stable container paths

| Runner | Tool files | Consumer inputs | Persistent container state |
|--------|------------|-----------------|----------------------------|
| Go test | `/usr/src/runner` | `/usr/src/manifests/<target>` and `/usr/src/service/<target>` | module and build cache volumes |
| Go quality | `/usr/src/runner` | `/usr/src/manifests/<target>` and `/usr/src/service/<target>` | module, build, and lint cache volumes |
| TypeScript test | `/usr/src/service/run-tests.sh` | `/usr/src/service/<workspace>` and staged workspace manifests | pnpm store and per-workspace `node_modules` volumes |
| TypeScript quality | `/usr/src/quality-runner` | selected paths under `/usr/src/repository` | tool `node_modules`, pnpm store, and dprint cache volumes |

The runner scripts use these container paths as their API. Adding a Go target or ordinary TypeScript workspace is a mount-only change in the consumer adapter.

## Go mount behavior

The Go adapters mount `go.mod` and `go.sum` separately from source. The runner copies both manifests into the disposable module root before invoking Go, so tests and validation do not make install-time changes in the host checkout.

Test adapters mount source and manifests read-only. The test entrypoint sets readonly module resolution, downloads dependencies into the named module cache, and always enables the race detector. With no extra arguments it tests `./...`; supplied arguments replace that package selection and pass through to `go test`.

Quality adapters mount source and manifests read-write because `fix` edits source and `dependencies` intentionally writes reconciled `go.mod` and `go.sum` back to the checkout. `validate` uses the same mounts but only reports differences. A consumer adds privileges such as the Docker socket only in its own test adapter; the shared base services do not grant them.

A Go target name may contain lowercase letters, digits, and internal hyphens. It is accepted only when the corresponding manifest files and source directory are mounted.

## TypeScript test workspace assembly

The TypeScript test runner installs each workspace inside disposable container storage. The adapter mounts the workspace's `package.json`, test configuration, and source beneath `/usr/src/service/<workspace>`. If pnpm needs a workspace manifest, the adapter stages it at `/usr/src/service/workspace-manifests/<workspace>/pnpm-workspace.yaml`; the runner copies it into the disposable workspace before installation because pnpm may update that file.

Workspace package roots must remain container-owned when a named `node_modules` volume is mounted beneath them. Do not bind-mount an entire package directory read-only and then mount a volume at `<package>/node_modules`; the container runtime cannot create the nested mount point inside the read-only bind. Mount `package.json` and source files or subdirectories separately, then mount the named volume at the package root's `node_modules` path.

The pnpm store is a named volume shared by invocations in one Compose project. Each workspace root and each mounted workspace package gets its own `node_modules` volume. This keeps dependency downloads and links between runs without writing `node_modules`, a pnpm store, or an install-generated lockfile to the host.

Ordinary workspaces are discovered by their mounted `package.json`. The main repository also has specialized `shared`, `infrastructure`, `init-config`, and `all` dispatch paths because those targets assemble more than one source tree.

## TypeScript quality isolation

The TypeScript quality runner has two filesystems with different responsibilities. `/usr/src/quality-runner` contains the tool package, configurations, formatter and linter source, fixtures, and tool dependencies. `/usr/src/repository` contains only the consumer paths selected for the current quality domain.

Application package manifests are not mounted into `/usr/src/repository`, so the tool installation cannot create application lockfiles or `node_modules` directories. Fix-capable adapters mount selected source paths read-write. Validation uses the same paths without modifying them. External repositories normally call the generic `files` domain with explicit container-relative paths instead of adding private domain names to the shared dispatcher.

The detailed TypeScript rules and commands are in [TypeScript and Stylesheet Linting and Formatting](typescript-quality-runner/README.md). Go commands and target behavior are in [Go Testing and Tooling](../../documentation/code-quality/testing/GO.md), and TypeScript test commands are in [TypeScript Testing](../../documentation/code-quality/testing/TYPESCRIPT.md).
