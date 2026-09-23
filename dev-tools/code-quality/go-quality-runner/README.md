---
title: Go Quality Runner
description: Docker image, mount contract, and commands for Go formatting, linting, source conventions, and module maintenance.
---

# Go Quality Runner

This directory builds the shared Go quality image. A repository-specific Compose adapter mounts one or more Go modules into the image and invokes [`run-quality.sh`](run-quality.sh) with a target name and action.

The reusable service is defined in [`../runner-compose/go-quality.base.yml`](../runner-compose/go-quality.base.yml). The main repository extends it from [`../../../docker-compose.go-quality-runner.yml`](../../../docker-compose.go-quality-runner.yml). Other repositories extend the same base file and supply their own target mounts.

## Target mount contract

A target name contains lowercase letters, digits, and internal hyphens. The runner requires these paths:

```text
/usr/src/manifests/<target>/go.mod
/usr/src/manifests/<target>/go.sum
/usr/src/service/<target>/
```

The runner copies `go.mod` and `go.sum` into the container-owned module root before running Go. Source mounts are writable because `fix` changes source and `dependencies` writes reconciled manifests back through `/usr/src/manifests/<target>`.

The base service provides separate module, build, and GolangCI-Lint cache volumes. The consuming adapter declares those top-level volumes because Compose `extends` does not import them from another file.

## Actions

| Action | Behavior |
|--------|----------|
| `fix` | Applies the AST source-convention fixes, runs the configured Go formatters, then runs GolangCI-Lint with safe fixes. This is the default action. |
| `validate` | Reports source-convention, formatting, and lint failures without changing source. |
| `dependencies` | Runs `go mod tidy` and copies the resulting `go.mod` and `go.sum` back to the mounted manifest paths. |

Run a main-repository target from the repository root:

```bash
docker compose -f docker-compose.go-quality-runner.yml --profile dev run --rm --no-deps -T lixpi-go-quality-runner <target> <fix|validate|dependencies>
```

[`golangci.yml`](golangci.yml) configures the enabled linters, formatters, and repository restrictions. [`source-conventions.go`](source-conventions.go) adds AST checks that are not supplied by GolangCI-Lint: it rejects block comments and keeps a validation `if` attached to the assignment whose value it checks. The image compiles that checker during the Docker build, after validating the checker with the same formatter and linter configuration.

The complete Go workflow and target-specific commands are in [Go Testing and Tooling](../../../documentation/code-quality/testing/GO.md).
