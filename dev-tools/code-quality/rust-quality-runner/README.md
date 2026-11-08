---
title: Rust Quality Runner
description: Docker image, mount contract, and commands for Rust formatting, linting, source conventions, and lockfile maintenance.
---

# Rust Quality Runner

This directory builds the shared Rust quality image. A repository-specific Compose adapter mounts one or more crates into the image and invokes [`run-quality.sh`](run-quality.sh) with a target name and action.

The reusable service is defined in [`../runner-compose/rust-quality.base.yml`](../runner-compose/rust-quality.base.yml). The main repository extends it from [`../../../infrastructure/docker/utilities/code-quality/docker-compose.rust-quality-runner.yml`](../../../infrastructure/docker/utilities/code-quality/docker-compose.rust-quality-runner.yml). Other repositories extend the same base file and supply their own target mounts.

## Target mount contract

A target name contains lowercase letters, digits, and internal hyphens. The runner requires these paths:

```text
/usr/src/manifests/<target>/Cargo.toml
/usr/src/manifests/<target>/Cargo.lock
/usr/src/service/<target>/
```

The runner copies both manifests into the container-owned crate root before running Cargo, so build scripts that write beside the crate, such as Tauri's, write into the container rather than the checkout. Mount source paths individually beneath `/usr/src/service/<target>`. Source mounts are writable because `fix` changes source, and the lockfile mount is writable because `dependencies` rewrites it.

The base service provides separate Cargo registry and build output volumes, and each target builds into its own directory inside the output volume. The consuming adapter declares those top-level volumes because Compose `extends` does not import them from another file.

## Actions

| Action | Behavior |
|--------|----------|
| `fix` | Applies clippy's machine-applicable fixes, the source-convention fixes and rustfmt, then reports the conventions and lints that remain. This is the default action. |
| `validate` | Reports formatting, source-convention and lint failures without changing source. |
| `dependencies` | Runs `cargo update --workspace` and writes the resulting `Cargo.lock` back to the mounted manifest. |

Run a main-repository target from the repository root:

```bash
docker compose -f infrastructure/docker/utilities/code-quality/docker-compose.rust-quality-runner.yml --profile dev run --rm --no-deps -T lixpi-rust-quality-runner <target> <fix|validate|dependencies>
```

Both quality actions run every stage and return failure if any stage fails, so a lint failure does not hide a formatting or convention failure. Every Cargo command except `dependencies` uses `--locked`, and clippy runs with `--all-features`, so code behind an optional feature is linted too.

## Rules

The runner has three layers, matching the Go runner's formatter, linter and source-convention checker.

[`rustfmt.toml`](rustfmt.toml) sets the layout: four-space indentation, a 150-column limit, one parameter per line when a signature has two or more, imports merged per crate and listed one per line, one field per line in struct literals and patterns, trailing commas, and line comments in place of block comments. Several of those options are unstable, so the runner formats with a pinned nightly rustfmt, selected as `rust-nightly` in the [version registry](../../versions-registry/README.md), while it compiles and lints on the stable toolchain. rustfmt works from the parsed syntax tree, like Oxfmt and gofumpt.

[`clippy-lints`](clippy-lints) is the lint policy, the counterpart of `golangci.yml`. It denies every warning and enables clippy's pedantic group, then adds the restriction lints that carry Lixpi's conventions: no `unwrap`, `expect` or `panic!` outside tests, no discarded `Result`, no process exit outside `main`, no stdout printing or `dbg!`, suppressions only through `#[expect]` with a reason, strings built with `format!`, tests inside a `#[cfg(test)]` module, and unsafe code only in a module that states its reason with `#[expect(unsafe_code)]`, one operation per block, each with a `// SAFETY:` comment. [`clippy.toml`](clippy.toml) lets tests unwrap, expect, panic and print. The runner passes the lint flags to the target's own crates only, because Cargo caps lints in dependencies.

[`src`](src) builds `check-rust-source`, which checks the source conventions no lint expresses. It parses each file with `ra_ap_syntax`, rust-analyzer's lossless parser, which keeps comments and whitespace as tokens. Rules find their constructs through syntax nodes and their fixes rewrite only the whitespace tokens between them:

| Rule | Behavior |
|------|----------|
| `no-block-comments` | Reports `/* */`, `/** */` and `/*! */` comments. rustfmt converts most of them first, so this catches what it cannot. |
| `statement-spacing` | Separates block statements (`if`, `match`, loops, blocks, items and `let ... else`), `return`, `break`, `continue` and a block's tail expression from their siblings with one blank line, never before the first statement or after the last. |
| `validation-if-spacing` | Keeps a `let` attached to a following `if` whose condition reads a name the `let` bound. |
| `match-arm-spacing` | Removes blank lines between match arms. |

The checker skips `target`, `gen` and hidden directories. It exits with 1 when it reports issues and 2 when a file cannot be read or parsed.

## Tool regression tests

The `rust-quality-tools` target mounts the checker crate into the shared runners. Its tests cover each rule's report and fix, the exceptions, comments between statements, positions, unparsable source, and that every fix is idempotent.

```bash
docker compose -f infrastructure/docker/utilities/code-quality/docker-compose.rust-quality-runner.yml --profile dev run --rm --no-deps -T lixpi-rust-quality-runner rust-quality-tools fix
docker compose -f infrastructure/docker/utilities/code-quality/docker-compose.rust-test-runner.yml --profile dev run --rm --no-deps -T lixpi-rust-test-runner rust-quality-tools
docker compose -f infrastructure/docker/utilities/code-quality/docker-compose.rust-quality-runner.yml --profile dev build lixpi-rust-quality-runner
```

The image build formats, tests, compiles and lints the checker against its own rules before installing it. After changing the checker, rebuild the image before validating other targets, because source mounts do not replace the installed executable. Edits to `rustfmt.toml`, `clippy-lints`, `clippy.toml` and `run-quality.sh` apply without a rebuild, because the base service mounts them.

The complete Rust workflow is in [Rust Testing and Tooling](../../../documentation/code-quality/testing/RUST.md).
