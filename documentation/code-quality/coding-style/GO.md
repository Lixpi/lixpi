---
title: Go Coding Style Guide
description: Repository-wide conventions for Go package structure, service boundaries, APIs, startup, errors, logging, data access, and concurrency.
---

# Go Coding Style Guide

This guide applies to every Go file. Service-specific architecture, storage, transport, and dependency rules stay in that service's repository documentation.

## Packages and ownership

- Keep executable wiring in `cmd/<binary>/` and implementation packages under `internal/` unless a package is deliberately published for external use. Treat `main` as the composition root that loads configuration, constructs dependencies, starts workers or servers, and coordinates shutdown.
- Keep packages focused on one responsibility. Split a package when unrelated transports, storage adapters, or domain rules start sharing only incidental state.
- Keep domain and application logic independent from transports and drivers. HTTP, NATS, database, and provider adapters translate their boundary types and delegate to the same domain or application operation instead of implementing business rules themselves.
- Define interfaces beside the code that consumes them, and let adapters implement those ports. Keep interfaces small and accept concrete types when substitution is not needed.
- Pass dependencies through constructors or function parameters. Prefer manual wiring in the composition root. Do not introduce a dependency-injection framework unless manual construction has become materially difficult to maintain.
- Do not use mutable package globals for runtime state. Avoid `init()` side effects such as configuration loading, network access, or goroutine startup. A framework-required static registration may use `init()` when it is deterministic, local to the registered implementation, and cannot be wired explicitly from the composition root.
- Prefer composition over framework-specific abstractions or deep embedding chains.

## Types and APIs

- Use named types for domain values when mixing primitive values would create a correctness risk.
- Represent exact quantities such as money with an integer unit or an exact decimal representation chosen by the domain. Do not use `float32` or `float64` when rounding would change persisted or transferred value.
- Put `context.Context` first on functions that perform I/O, wait, or cross a request boundary. Propagate cancellation and apply deadlines to bounded external work.
- Accept only the data a function needs. Avoid configuration bags and broad interfaces that expose unrelated behavior.
- Return values that let callers handle expected outcomes directly. Do not encode ordinary control flow in log messages or panics.
- Keep wire payloads typed. Validate required fields at the boundary before passing data into domain code.

## Configuration and startup

- Load and validate configuration once at startup, before accepting work. The service's deployment documentation decides whether values come from environment variables, files, flags, or another source.
- Construct runtime dependencies after configuration validation and pass them to the packages that use them. Packages must not reach back into process-wide configuration during normal work.
- Return startup errors to `main` with enough context to identify the failed component. Do not leave a partially started process running after required initialization fails.

## Errors

- Return errors to the caller and wrap them with operation context using `fmt.Errorf("...: %w", err)`.
- Use typed or sentinel errors only when callers need to branch on the failure with `errors.Is` or `errors.As`.
- Do not use `panic` for request, message, configuration, storage, or network failures.
- Preserve the original error when adding context. Error text should name the failed operation, not restate that an error occurred.

## Logging

- Use the standard library `log/slog` for structured logging.
- Select and configure the `slog.Handler` once at startup. Application and domain packages log through the configured logger without choosing environment-specific output formats themselves.
- Choose the handler output for its consumer. Prefer readable text for interactive local use and JSON for deployed log aggregation unless the runtime has a different stream or encoding contract.
- Log stable event names and structured attributes instead of formatting values into the message.
- Log an error where it is handled. Do not log the same failure at each layer while returning it unchanged.
- Never log credentials, tokens, private keys, sensitive payloads, or other secret material.

## Concurrency and shutdown

- Tie goroutines to an owning context or lifecycle object. Do not start background work without a defined stop path.
- Long-running commands derive their root context from the process shutdown signals they support. Every worker, server, and consumer must honor cancellation from that lifecycle.
- Bound waits, retries, and shutdown with contexts or deadlines.
- Close files, responses, subscriptions, connections, and servers through `defer` or the owning lifecycle cleanup path as soon as ownership is established.
- Coordinate worker failures so one failed goroutine cannot leave sibling work running without supervision.
- On shutdown, stop accepting new work before waiting for in-flight operations. Drain servers, consumers, and connection pools only after owned work reaches its documented completion boundary.
- Give graceful shutdown a deadline. If the deadline expires, report what is still running and return a failure instead of hanging indefinitely.

## Transactions and SQL

- Put writes that form one atomic state change in the same database transaction. Keep idempotency records or other replay guards in that transaction when they protect the same change.
- Pass every SQL value as a query parameter. Never concatenate or interpolate values into SQL, including values produced by trusted internal code.
- Keep query structure reviewable. Prefer maintained constants or embedded `.sql` files for fixed queries. If a query needs dynamic structure, build only the structural clauses and keep every value parameterized.
- Keep database-specific libraries, row-mapping choices, transaction boundaries, and ORM or query-builder policy in the service documentation when they are not shared by every Lixpi Go service.

## Formatting and tooling

Use the Dockerized Go quality runner documented in the [Go testing and tooling guide](../testing/GO.md). Its formatter and linter own mechanical layout, imports, and source-level convention checks. Do not hand-format code against a competing style or run Go tooling on the host.
