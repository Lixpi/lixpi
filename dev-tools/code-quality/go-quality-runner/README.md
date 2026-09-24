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

[`golangci.yml`](golangci.yml) selects specialized GolangCI-Lint analyzers and the syntax-aware `gofumpt`, `goimports`, and `golines` formatters. [`source-conventions.go`](source-conventions.go) parses Go syntax to reject block comments and keep a validation `if` attached to the assignment whose value it checks.

[`internal/conventions`](internal/conventions) implements the semantic rules with `go/analysis` and `go/types`, invoked through `go vet -vettool=/usr/local/bin/check-go-semantics ./...`. It resolves builtin symbols, imported functions, and methods to prohibit implicit command output and standard `log` calls, check constant error messages, and reject comparisons against error text outside tests. Import aliases and dot imports resolve to the same symbols; local names and unrelated methods are distinguished by their objects and types. Generated files are excluded, and Go's build configuration controls which packages and files are analyzed. These rules do not use regex matching on source or identifier names.

An unreachable builtin panic can carry `//lixpi:allow-panic <reason>` immediately above the call. Missing reasons and misplaced directives are errors; a directive cannot suppress another rule or a whole function. See [Go Coding Style](../../../documentation/code-quality/coding-style/GO.md#panic-and-exit).

Both quality actions run syntax, formatting, GolangCI-Lint, and semantic checks and return failure if any check fails. A GolangCI-Lint failure does not hide semantic diagnostics. The image build lints and tests the tools, compiles both executables, and runs the typed analyzer over its own module.

## Tool regression tests

The `go-quality-tools` target mounts this module into the shared runners. Its tests cover import aliases, dot imports, shadowed names, standard and unrelated methods, function references, constant error strings, panic exceptions, generated files, and exact error assertions in tests.

```bash
docker compose -f docker-compose.go-quality-runner.yml --profile dev run --rm --no-deps -T lixpi-go-quality-runner go-quality-tools dependencies
docker compose -f docker-compose.go-quality-runner.yml --profile dev run --rm --no-deps -T lixpi-go-quality-runner go-quality-tools fix
docker compose -f docker-compose.go-test-runner.yml --profile dev run --rm --no-deps -T lixpi-go-test-runner go-quality-tools
docker compose -f docker-compose.go-quality-runner.yml --profile dev build lixpi-go-quality-runner
```

After changing either checker, rebuild the quality image before validating consuming services. Source and configuration mounts do not replace the compiled analyzer executables.

The complete Go workflow and target-specific commands are in [Go Testing and Tooling](../../../documentation/code-quality/testing/GO.md).
