---
title: Reusable Runner Compose Services
description: Compose extension contracts for sharing Lixpi's Go and TypeScript quality and test runners between repositories.
---

# Reusable Runner Compose Services

These files define the shared image, entrypoint, tool mounts, working directory, and cache mount points for each code-quality runner. They do not mount application source. Each consuming repository extends a base service from its own repository-root adapter and supplies the source, manifests, environment, privileges, and named volume declarations it needs.

| Base file | Extended service | Consumer responsibility |
|-----------|------------------|-------------------------|
| [`go-quality.base.yml`](go-quality.base.yml) | `go-quality-runner-base` | Writable Go source and manifests, plus module, build, and lint cache declarations. |
| [`go-test.base.yml`](go-test.base.yml) | `go-test-runner-base` | Read-only Go source and manifests, plus module and build cache declarations. |
| [`typescript-quality.base.yml`](typescript-quality.base.yml) | `typescript-quality-runner-base` | Selected repository paths, the repository Oxlint configuration path, and four cache declarations. |
| [`typescript-test.base.yml`](typescript-test.base.yml) | `typescript-test-runner-base` | Workspace manifests, source mounts, environment, and pnpm and `node_modules` cache declarations. |

## How extension paths resolve

Paths written in a base file are relative to this directory. That is why build contexts and tool mounts use `../<runner>/...`. Paths added by a repository adapter are resolved from that consuming Compose project.

The main repository uses relative extension paths:

```yaml
extends:
    file: ./dev-tools/code-quality/runner-compose/go-test.base.yml
    service: go-test-runner-base
```

A sibling repository uses the required absolute checkout path:

```yaml
extends:
    file: ${LIXPI_REPOSITORY_PATH:?LIXPI_REPOSITORY_PATH is required}/dev-tools/code-quality/runner-compose/go-test.base.yml
    service: go-test-runner-base
```

The required-variable expression makes Compose fail while loading the adapter when `LIXPI_REPOSITORY_PATH` is missing. The sibling repository's own startup scripts enforce the same requirement before agents or scripts can use the shared checkout.

## Named volumes stay in the adapter

Compose `extends` imports the selected service definition. It does not import top-level `volumes` declarations from the base file. A consuming adapter must declare every named volume referenced by the extended service and every workspace-specific `node_modules` volume it adds.

The volume names form the interface between the base and adapter, but the physical volumes remain isolated by the consuming Compose project's name. This lets two repositories use the same runner definitions without sharing caches accidentally.

## Mount permissions

Test adapters mount source and manifests read-only because test execution must not change the checkout. Quality adapters mount selected paths writable because fix actions edit source. Go quality adapters also mount `go.mod` and `go.sum` writable for the explicit `dependencies` action.

TypeScript workspaces that need a nested `node_modules` volume must keep the package root container-owned. Mount the package manifest and source paths separately. A read-only bind of the entire package directory prevents the container runtime from creating the nested volume mount point.

The parent [Code Quality Runners](../README.md) page documents the stable container paths and the complete cross-repository mount model.
