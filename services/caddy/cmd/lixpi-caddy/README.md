---
title: lixpi-caddy Executable
description: Turning container settings into a local CA run or a bounded public certificate maintenance job.
---

# lixpi-caddy Executable

This package is the container's entry point. [`main.go`](main.go) selects `local`, `maintain` or `version`, connects SIGINT/SIGTERM to cancellation and reports command failure through the exit status. It sets a private file-creation mask and writes application logs as JSON.

[`config.go`](config.go) reads and validates the environment before issuance. Explicit `local` and `maintain` arguments override `CADDY_LOCAL_MODE`. Public domains are trimmed, lowercased and deduplicated; invalid DNS names and unsupported storage settings fail before AWS clients or Caddy start. Local mode fixes the name to `localhost` and uses the configured certificate directory.

Local execution starts the embedded issuer against that directory and waits for a certificate that verifies against the generated root. Once Caddy stops, it exports the public CA, certificate and private key to the filenames Compose consumers expect. It needs neither AWS credentials nor public DNS access, and it doesn't install the CA into the host's trust store.

Public execution constructs the AWS SDK clients and passes them, the issuer and the domain list to `maintenance.Manager`. When `AWS_LAMBDA_RUNTIME_API` is present, the official Lambda runtime supplies each invocation's context and deadline. The handler reads deployment settings for each invocation and returns failures to Lambda. Its event body cannot change the configured domains.

Change this package when arguments, environment settings or startup dependencies change. Issuance and persistence behavior belong in the internal packages. [Configuration](../../documentation/CONFIGURATION.md) describes the inputs, and [Operations](../../documentation/OPERATIONS.md) covers local trust and public invocation failures. [`main_test.go`](main_test.go) exercises configuration rejection and runs the local CA twice to check that its persisted identity and serving certificate are reused.
