---
title: Go Test Runner
description: Docker image and mount contract for isolated, race-enabled Go test execution.
---

# Go Test Runner

This directory builds the shared Go test image. A repository-specific Compose adapter mounts Go manifests and source, then invokes [`run-tests.sh`](run-tests.sh) with a target name and optional `go test` arguments.

The reusable service is defined in [`../runner-compose/go-test.base.yml`](../runner-compose/go-test.base.yml). The main repository extends it from [`../../../docker-compose.go-test-runner.yml`](../../../docker-compose.go-test-runner.yml). Other repositories extend the same base file and supply their own read-only targets.

## Target mount contract

A target name contains lowercase letters, digits, and internal hyphens. The runner requires these paths:

```text
/usr/src/manifests/<target>/go.mod
/usr/src/manifests/<target>/go.sum
/usr/src/service/<target>/
```

The adapter mounts manifests and source read-only. The runner copies the manifests into the container-owned module root, enables read-only module resolution, downloads dependencies into the named module cache, and runs:

```text
go test -race -count=1 -timeout=120s
```

With no additional arguments, the package selection is `./...`. Additional arguments replace that default and pass directly to `go test`.

The base service provides separate module and build cache volumes. The consuming adapter declares those top-level volumes because Compose `extends` does not import them from another file. The image also includes the NATS CLI used by the broker snapshot and restore acceptance tests; application images do not need to ship that CLI.

Run a main-repository target from the repository root:

```bash
docker compose -f docker-compose.go-test-runner.yml --profile dev run --rm --no-deps -T lixpi-go-test-runner <target> [go test arguments]
```

The complete Go test workflow, including the isolated broker acceptance sequence, is in [Go Testing and Tooling](../../../documentation/code-quality/testing/GO.md).
