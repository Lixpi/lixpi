---
title: Rust Coding Style Guide
description: Repository-wide conventions for Rust crate structure, errors, process exit, output, comments, suppressions, layout and tooling.
---

# Rust Coding Style Guide

This guide applies to every Rust crate Lixpi authors: the [desktop app](../../platform/DESKTOP-APP.md) in `gui/tauri/src-tauri` and the Rust quality runner's own checker in `dev-tools/code-quality/rust-quality-runner`. The vendored LocalAuth0 source under `services/localauth0` is upstream code built from a pinned release, so it follows its own style.

The rules carry the TypeScript and Go conventions over to Rust where the languages meet, and follow Rust's own practice where they don't. The [Rust quality runner](../../../dev-tools/code-quality/rust-quality-runner/README.md) enforces the mechanical ones, so this guide explains why they exist and covers the judgment calls a tool can't make.

## Crate structure

Keep the part of a crate that talks to the platform thin, and put the decisions it makes in plain functions and types that tests can call directly. The desktop app shows the shape: `lib.rs` wires Tauri's window callbacks, and each callback asks `origins.rs` what to do with a URL and gets back a `NavigationAction` or `NewWindowAction`. The decision is tested without a window, a web view or a running app.

- A binary keeps its `main` in `main.rs` and its logic in the library crate beside it, so tests reach the logic without starting the program.
- Name the outcomes of a decision with an `enum` rather than returning a `bool` the caller has to interpret.
- Keep a module's items `pub(crate)` unless another crate uses them. A `pub` item nothing outside the crate can reach is reported by `unreachable_pub`.
- Share a rule between `build.rs` and the crate by including one file in both, as the desktop app does with `connection_url.rs`, rather than writing the rule twice.

## Errors

Return errors with `Result` and propagate them with `?`. Production code never calls `unwrap`, `expect` or `panic!`, and never discards a `Result` with `let _ =`. A failure is either handled where it happens, for example by logging it and carrying on, or returned to a caller that can.

An error message names the step that failed or the condition that isn't met, and includes the identifying value that helps someone find the problem, such as `LIXPI_API_URL is not a valid URL (https://): empty host`. Never put a secret in an error or a log line. The desktop app's API URLs carry an access token in their query string, so anything it logs about them goes through `origins::without_query`.

Tests are the exception. A failing assertion is how a test reports, so tests may unwrap, expect and panic.

## Exiting

Only `main` ends the process, after reporting why. `main` returns `std::process::ExitCode`: it calls the library, prints the error it gets back to stderr, and returns `ExitCode::FAILURE`. A helper that calls `std::process::exit` would skip its caller's cleanup, so clippy's `exit` lint rejects it outside `main`. A build script follows the same rule and returns a failing `ExitCode` instead of panicking when its input is wrong.

## Output

A program writes to stdout only when that output is its product, and none of Lixpi's current Rust programs has such output, so `print!` and `println!` are rejected. Diagnostics go to stderr with `eprintln!`. `dbg!` is a debugging leftover and is rejected everywhere, tests included.

## Comments and documentation

Use `//` comments. Block comments, including `/** */` and `/*! */` doc comments, are rejected; write doc comments as `///` or `//!`. Document every `pub` function of a library with what it does, and add an `# Errors` section when it returns a `Result`. A comment explains why code is the way it is, or the constraint it works around, rather than restating what it does.

## Suppressing a lint

Suppress a lint with `#[expect(lint_name, reason = "...")]` on the narrowest item that needs it. `#[expect]` fails once the code it excused no longer triggers the lint, so a suppression can't outlive its reason. `#[allow]` and a suppression without a reason are both rejected, the same way the Go runner requires an explanation for every `nolint` directive.

## Unsafe code

Unsafe code is rejected unless a module explains why it can't be avoided. Reach the platform through a crate that wraps it safely whenever one exists. When none does, such as a WebKit callback that is only reachable through the Objective-C runtime, put the code in its own module and state the reason with `#![expect(unsafe_code, reason = "...")]`. Keep each `unsafe` block to one operation, and explain above it, in a `// SAFETY:` comment, why that operation is sound. The desktop app's `src/local_trust/macos.rs` is the reference. Code like this needs a reviewer who checks those claims, because the runner can only check that they are written down.

Platform-specific modules are gated with `#[cfg(target_os = "...")]`, so the Linux runners don't compile them. Lint a macOS module with the same policy for the Apple target before relying on it, as [Rust Testing and Tooling](../testing/RUST.md#platform-specific-code) describes.

## Layout

The quality runner's formatter decides layout, so don't hand-format against it:

- Four spaces of indentation, Unix line endings and a 150-column limit, the same as the Go and TypeScript formatters.
- A signature with two or more parameters puts one parameter on each line.
- Imports from one crate merge into a single `use`, grouped as `std`, external crates, then this crate, with one item per line when a list holds two or more.
- A struct literal or pattern puts one field on each line. rustfmt measures width rather than counting fields, so a single-field literal expands too, unlike a single-property TypeScript object.
- Lists that span lines end with a trailing comma, and so do match arms.

The source-convention checker adds the statement spacing rules the TypeScript and Go runners enforce. A block statement, such as `if`, `match`, a loop, a block, an item or a `let ... else`, is separated from its siblings by one blank line, and so are `return`, `break` and `continue`. A block's tail expression is the function's result, so it is separated from the statements above it the same way a `return` is. Nothing is inserted before the first statement of a block or after the last one. A `let` stays attached to an `if` whose condition reads a name the `let` bound, because together they read as one validation. Match arms stay on adjacent lines, like `case` clauses.

## Tooling

Use the Dockerized runners documented in the [Rust testing and tooling guide](../testing/RUST.md). Never run `cargo`, `rustc`, rustfmt or clippy on the host.

Custom source rules inspect rust-analyzer's syntax tree, which keeps comments and whitespace as tokens, so a rule finds its constructs through parsed nodes and rewrites only whitespace between them. Don't classify source by regex or by identifier spelling. Prefer a clippy lint when one covers the rule, and add a syntax rule to the checker only for layout and convention rules no lint expresses.
