---
title: Rust Test Runner
description: Docker image and mount contract for isolated Rust test execution.
---

# Rust Test Runner

This directory builds the shared Rust test image. A repository-specific Compose adapter mounts Cargo manifests and source, then invokes [`run-tests.sh`](run-tests.sh) with a target name and optional `cargo test` arguments.

The reusable service is defined in [`../runner-compose/rust-test.base.yml`](../runner-compose/rust-test.base.yml). The main repository extends it from [`../../../infrastructure/docker/utilities/code-quality/docker-compose.rust-test-runner.yml`](../../../infrastructure/docker/utilities/code-quality/docker-compose.rust-test-runner.yml). Other repositories extend the same base file and supply their own read-only targets.

## Target mount contract

A target name contains lowercase letters, digits, and internal hyphens. The runner requires these paths:

```text
/usr/src/manifests/<target>/Cargo.toml
/usr/src/manifests/<target>/Cargo.lock
/usr/src/service/<target>/
```

The adapter mounts manifests and source read-only. The runner copies the manifests into the container-owned crate root and runs:

```text
cargo test --locked --all-features
```

Additional arguments pass directly to `cargo test`, so a name filter selects tests. The base service provides separate Cargo registry and build output volumes, and each target builds into its own directory inside the output volume. The consuming adapter declares those top-level volumes because Compose `extends` does not import them from another file.

The image carries the GTK and WebKitGTK development packages, because crates that bind the system web view link them on Linux. Those libraries are shared, so the image turns off static C runtime linking, which the Alpine Rust toolchain uses by default.

Run a main-repository target from the repository root:

```bash
docker compose -f infrastructure/docker/utilities/code-quality/docker-compose.rust-test-runner.yml --profile dev run --rm --no-deps -T lixpi-rust-test-runner <target> [cargo test arguments]
```

The complete Rust test workflow is in [Rust Testing and Tooling](../../../documentation/code-quality/testing/RUST.md).
