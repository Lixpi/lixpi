---
title: TypeScript Test Runner
description: Docker image, workspace assembly, cache layout, and dispatcher for Vitest domains.
---

# TypeScript Test Runner

This directory builds the shared one-shot TypeScript test image. The image contains Node and pnpm but no application dependencies. A repository-specific Compose adapter mounts a workspace under `/usr/src/service/<workspace>`, and [`run-tests.sh`](run-tests.sh) installs that workspace in container storage before invoking Vitest.

The reusable service is defined in [`../runner-compose/typescript-test.base.yml`](../runner-compose/typescript-test.base.yml). The main repository extends it from [`../../../docker-compose.typescript-test-runner.yml`](../../../docker-compose.typescript-test-runner.yml). Another repository can extend the same base service with a smaller adapter containing only its own workspaces.

## Ordinary workspace contract

An ordinary workspace needs these mounts:

```text
/usr/src/service/<workspace>/package.json
/usr/src/service/<workspace>/vitest.config.ts
/usr/src/service/<workspace>/<source paths>
```

If the workspace uses `pnpm-workspace.yaml`, mount it read-only at `/usr/src/service/workspace-manifests/<workspace>/pnpm-workspace.yaml`. The runner copies it into the disposable workspace before `pnpm install` because pnpm may update dependency build decisions in that file.

Mount package manifests and source directories separately when the adapter also mounts a named volume at the package's `node_modules` path. Binding the entire package directory read-only prevents the container runtime from creating that nested volume mount point.

Workspace names contain lowercase letters, digits, and internal hyphens. Any mounted workspace with a `package.json` uses the generic dispatch path. The `shared`, `infrastructure`, `init-config`, and `all` domains contain main-repository assembly logic because they combine multiple source trees.

## Installation and caches

Every invocation runs `pnpm install`, then `pnpm exec vitest run`. The pnpm content store and each workspace's linked `node_modules` tree live in named volumes declared by the consuming adapter. The install therefore reconciles the mounted manifests without writing dependencies, a pnpm store, or install-generated workspace changes into the host checkout.

[`nuke-cache.sh`](nuke-cache.sh) removes the main repository's `lixpi_typescript-test-runner-*` volumes when a stale workspace link or corrupt cache requires a clean installation. Routine dependency changes do not require clearing the cache.

Run a main-repository workspace from the repository root:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner <workspace> [vitest arguments]
```

For shared packages, the optional package selector comes before the Vitest arguments:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner shared [package] [vitest arguments]
```

The complete domain list and test conventions are in [TypeScript Testing](../../../documentation/code-quality/testing/TYPESCRIPT.md).
