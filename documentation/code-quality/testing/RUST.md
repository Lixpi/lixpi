---
title: Rust Testing and Tooling
description: Container-only Rust tests, dependency maintenance, formatting and linting.
---

# Rust Testing and Tooling

Lixpi's Rust crates are the [desktop app](../../platform/DESKTOP-APP.md) and the Rust quality runner's own checker. Every Rust command runs inside Docker. The one-shot test and quality runners follow the Go runners' layout: manifests and source are mounted separately, the crate root belongs to the disposable container, and the Cargo registry and build output live in named Docker volumes. There is no host toolchain, registry cache or build output. Tests mount source read-only, and quality fixes write to the mounted source.

Reusable service definitions live under `dev-tools/code-quality/runner-compose/`, and the Compose files in `infrastructure/docker/utilities/code-quality/` are the main repository's mount adapters. Each target registers `Cargo.toml` and `Cargo.lock` under `/usr/src/manifests/<target>` and its source under `/usr/src/service/<target>`. Target names are restricted to lowercase letters, digits and internal hyphens, and a target runs only when both manifest files and its source directory are mounted. [Code Quality Runners](../../../dev-tools/code-quality/README.md) explains the shared service and adapter boundary.

| Target | Crate |
|--------|-------|
| `desktop` | `gui/tauri/src-tauri`, the macOS desktop app |
| `rust-quality-tools` | `dev-tools/code-quality/rust-quality-runner`, the source-convention checker |

The desktop app builds for macOS, but the runners compile it natively on Linux so they can run its tests and clippy in CI. The Tauri web view binds GTK and WebKitGTK there, so both runner images carry those development packages. The adapters also set placeholder values for `LIXPI_WEB_UI_URL` and `LIXPI_API_URL`, because the app's build script refuses to build without them.

## Writing tests

Read the [`code-quality` skill](${LIXPI_REPOSITORY_PATH}/skills/code-quality/SKILL.md) before writing or running tests. Its `CODING_AGENTS_TEST_EXECUTION_MODE` rule controls writing, modifying and running tests, and `CODING_AGENTS_TEST_LINTER_MODE` controls formatting and lint checks.

Put unit tests in a `#[cfg(test)] mod tests` beside the code they cover, either at the end of the file or in a sibling `tests.rs` when the cases are long. Clippy rejects tests outside such a module. Name each test after the behavior it proves, such as `only_api_downloads_leave_the_navigation_to_the_download_handler`.

When several inputs exercise the same behavior, loop over an array of cases and pass the input as the assertion message, so a failure names the case. Keep a direct test when a table would hide the behavior. Tests may unwrap, expect and panic, because a failing assertion is how a test reports.

Test decisions rather than the platform. The desktop app's tests call the functions that decide what happens to a navigation, a new window or a download script, without creating a window or starting WebKit. Tests must not open windows, reach the network or depend on the host. A checker rule is tested from source text in, diagnostics and fixed text out, and every fix is checked for idempotence so `fix` never changes a file on its next run.

## Commands

Build the runners from the repository root:

```bash
docker compose -f infrastructure/docker/utilities/code-quality/docker-compose.rust-test-runner.yml --profile dev build
docker compose -f infrastructure/docker/utilities/code-quality/docker-compose.rust-quality-runner.yml --profile dev build
```

Both runners enable every feature of a crate, so code behind an optional feature, such as the desktop app's `diagnostics`, is linted and tested too. Run a target's tests. Extra arguments pass to `cargo test`, so a name filter selects tests:

```bash
docker compose -f infrastructure/docker/utilities/code-quality/docker-compose.rust-test-runner.yml --profile dev run --rm --no-deps -T lixpi-rust-test-runner desktop
docker compose -f infrastructure/docker/utilities/code-quality/docker-compose.rust-test-runner.yml --profile dev run --rm --no-deps -T lixpi-rust-test-runner desktop origins
```

Fix, validate or reconcile dependencies:

```bash
docker compose -f infrastructure/docker/utilities/code-quality/docker-compose.rust-quality-runner.yml --profile dev run --rm --no-deps -T lixpi-rust-quality-runner desktop fix
docker compose -f infrastructure/docker/utilities/code-quality/docker-compose.rust-quality-runner.yml --profile dev run --rm --no-deps -T lixpi-rust-quality-runner desktop validate
docker compose -f infrastructure/docker/utilities/code-quality/docker-compose.rust-quality-runner.yml --profile dev run --rm --no-deps -T lixpi-rust-quality-runner desktop dependencies
```

`fix` applies clippy's machine-applicable suggestions, the checker's spacing fixes and rustfmt, then reports whatever is left; it is required during implementation. `validate` checks formatting, source conventions and clippy without changing source. Both run every stage and fail if any stage fails. After editing `Cargo.toml`, run `dependencies` to bring `Cargo.lock` in line with it. It writes only the lockfile back to the checkout, and every other command uses `--locked`. [Rust Quality Runner](../../../dev-tools/code-quality/rust-quality-runner/README.md) describes the rules and how they are configured, and the [Rust coding style guide](../coding-style/RUST.md) explains them.

## Platform-specific code

The runners compile on Linux, so code gated to macOS, such as the desktop app's `src/local_trust/macos.rs`, isn't compiled or linted there. Keep such modules small, keep their decisions in portable functions the runners can test, and lint them for the Apple target with the same policy through the desktop builder:

```bash
docker compose --env-file .env.<stage> -f infrastructure/docker/utilities/desktop/docker-compose.tauri.yml run --rm -v "$PWD/dev-tools/code-quality/rust-quality-runner/clippy.toml:/usr/src/clippy/clippy.toml:ro" -e CLIPPY_CONF_DIR=/usr/src/clippy -w /usr/src/desktop/src-tauri --entrypoint sh lixpi-tauri-macos-builder -c "rustup component add clippy >/dev/null && cargo-zigbuild clippy --locked --all-targets --target aarch64-apple-darwin -- $(grep -v -e '^#' -e '^$' dev-tools/code-quality/rust-quality-runner/clippy-lints | tr '\n' ' ')"
```

`cargo-zigbuild clippy` is needed instead of `cargo clippy` because a dependency compiles Objective-C, which only Zig can build for macOS in that container.

## GitHub Actions

The `CI` workflow has a Rust section with independent `rust-quality` and `rust-tests` matrices over the `desktop` and `rust-quality-tools` targets. Their status names begin with `Rust /`. Each job builds and invokes its own Docker runner, and both must succeed for `Required CI gate` to pass. The desktop app's macOS bundle isn't built in CI, because its builder needs the macOS SDK from a developer's Mac.
