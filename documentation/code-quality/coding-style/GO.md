---
title: Go Coding Style Guide
description: Repository-wide conventions for Go package structure, service boundaries, APIs, startup, errors, logging, data access, and concurrency.
---

# Go Coding Style Guide

This guide applies to every Go file in Lixpi repositories that consume the shared guides. Service-specific architecture, storage, transport, and dependency rules stay in that service's repository documentation and supplement this guide.

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
- Return values that let callers handle expected outcomes directly. Do not encode ordinary control flow in log messages. [Panic and exit](#panic-and-exit) covers when `panic` is allowed.
- Keep wire payloads typed. Validate required fields at the boundary before passing data into domain code.

## Configuration and startup

- Load and validate configuration once at startup, before accepting work. The service's deployment documentation decides whether values come from environment variables, files, flags, or another source.
- Construct runtime dependencies after configuration validation and pass them to the packages that use them. Packages must not reach back into process-wide configuration during normal work.
- Return startup errors to `main`, which logs them and exits as described in [Panic and exit](#panic-and-exit). Do not leave a partially started process running after required initialization fails.

## Error handling

Use only the standard library for errors: `errors.New`, `fmt.Errorf` with `%w`, `errors.Is`, and `errors.As` or its generic form `errors.AsType`. Don't add a third-party error package.

### Wrap every error you return

Don't return a bare `err`. Wrap it with a message that says what the function was doing when the call failed, so the final error reads like a trail through the code.

The format is `"wrapping message: %w"`. Start the message with a lowercase letter and don't end it with punctuation.

```go
// Good
data, err := os.ReadFile(filename)
if err != nil {
	return NodeIdentity{}, fmt.Errorf("read persistent broker name: %w", err)
}

// Bad: the caller can't tell which step failed.
return NodeIdentity{}, err

// Bad: capitalized, ends with punctuation, and %v breaks the chain.
return NodeIdentity{}, fmt.Errorf("Failed to read broker name: %v.", err)
```

### Write the message as the failing step

A wrapping message names the step that failed, as a short verb phrase such as `list streams before backup` or `restore stream %q`. A sentinel's message names the condition, such as `credentials denied`. Each wrap adds one link, so the whole chain already reads as a path through the code. Anything beyond the step only repeats what the chain says: words like "failed to", "error", or "unable to", package or function names, and whatever the callee's own message already covers.

```go
// Good: each layer names one step, and the sentinel names a plain condition.
// capture broker snapshot: list streams before backup: request JetStream operation "$JS.API.STREAM.LIST": context deadline exceeded
return "", fmt.Errorf("list streams before backup: %w", err)

var ErrDenied = errors.New("credentials denied")

// Bad: "failed to" and "error" repeat what the chain already says, and the package prefix repeats where it came from.
// maintenance: failed to capture broker snapshot: error listing streams: context deadline exceeded
return "", fmt.Errorf("maintenance: failed to capture broker snapshot: %w", err)

var ErrDenied = errors.New("auth: credentials denied")
```

### Put identifying values in the message

Include values such as stream names, domains, subjects, or file paths when they help someone find the failing record, like `fmt.Errorf("restore stream %q: %w", name, err)`. Never include secrets, such as passwords, NKey seeds, private keys, or bearer tokens. Error messages end up in logs, so the rules in [Logging](#logging) apply to them too.

### Stop wrapping at the boundary

The wrap rule is for errors you return. At a boundary, such as a NATS message handler's reply, an auth callout response, an HTTP handler, a Lambda handler, or `main`, nothing is left to return the error to. Log it or map it to a response there instead of wrapping it again. When the boundary hands the error to a runtime, such as a Lambda handler's return value, mark that return with a `//nolint:wrapcheck` comment that names the boundary.

### Check errors in a wrap-aware way

Because errors are wrapped, the error you receive is rarely the original value. Use `errors.Is` to match a sentinel and `errors.As` or `errors.AsType` to match a type. Don't compare errors with `==`, don't use a type assertion or type switch on an error that may be wrapped, and never match on the error message text.

```go
// Good
if errors.Is(err, auth.ErrDenied) {
	identity = nil
}

if _, ok := errors.AsType[*s3types.NoSuchKey](err); ok {
	return nil, false, nil
}

// Bad: each of these misses a wrapped error or breaks when the text changes.
if err == auth.ErrDenied {
}

if _, ok := err.(*s3types.NoSuchKey); ok {
}

if strings.Contains(err.Error(), "denied") {
}
```

### Declare sentinel errors for repeated cases

When the same failure comes up in more than one place, or another package may want to handle that case on its own, declare a sentinel error for it. Give it an exported `Err` prefix and a lowercase message a person can read. Declare a custom error type instead only when callers need data from the error through `errors.As`.

Return a sentinel the same way as any other error: wrap it with `%w` and the context of the failing step. Callers still match it with `errors.Is`, because `errors.Is` walks the whole chain.

```go
var ErrDenied = errors.New("credentials denied")

if rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature) != nil {
	return nil, fmt.Errorf("verify browser token signature: %w", ErrDenied)
}
```

### Panic and exit

Never use `panic` to exit the app on purpose. Keep `panic` for unexpected situations and for branches that should never run, which means programmer errors and broken invariants. Don't panic in handlers or consumers on an expected failure, and treat request, message, configuration, storage, and network failures as expected. Return the error instead.

Every expected exit goes through `os.Exit`, and that includes an exit caused by an error. Log the error first, then call `os.Exit(1)`.

`os.Exit` skips deferred calls, so it belongs in `main` after cleanup has run, never deep in library code. The usual shape is a `run() error` function that holds the deferred cleanup, with `main` doing the log and the exit.

```go
// Good
func main() {
	if err := run(); err != nil {
		slog.Error("NATS command failed", "error", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	if err := serve(ctx); err != nil {
		return fmt.Errorf("run serve command: %w", err)
	}

	return nil
}

// Bad: panicking in main to report an expected failure.
if err := serve(ctx); err != nil {
	panic(err)
}

// Bad: a helper that exits, which skips the caller's deferred cleanup.
func loadPolicy() *policy.Policy {
	p, err := policy.Transport()
	if err != nil {
		slog.Error("load broker transport policy", "error", err)
		os.Exit(1)
	}

	return p
}
```

A `panic` is right for a branch that can't run, such as a `switch` default after configuration validation has already rejected every other value. The typed analyzer flags uses of the builtin `panic`. A deliberate one needs a `//lixpi:allow-panic` comment immediately above the call, with a reason explaining why the branch can't run. The exception applies to that call only.

```go
switch mode {
case "live", "broker", "ready":
	return probe(ctx, mode)
default:
	//lixpi:allow-panic readHealthMode rejects every other mode before this switch.
	panic(fmt.Sprintf("unreachable health mode %q", mode))
}
```

## Logging

- Use the standard library `log/slog` for structured logging. Do not add a competing logging framework; a custom or third-party `slog.Handler` can supply the required output format.
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

Use specialized GolangCI-Lint analyzers when they cover a rule. Custom source rules must inspect Go syntax trees; rules about functions, methods, packages, or types must resolve symbols through Go's type information. Do not classify source constructs by regex or their written identifier names. Text checks may inspect decoded constants or parsed comments after the AST identifies their role. Formatting changes must be derived from parsed syntax and preserve program behavior.
