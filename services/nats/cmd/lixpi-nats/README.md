---
title: lixpi-nats Executable
description: Where container inputs become a running broker or a scoped maintenance client.
---

# lixpi-nats Executable

This package is the container's entry point. [`main.go`](main.go) selects a command, connects SIGINT/SIGTERM to shutdown and reports failure through the exit status.

[`serve.go`](serve.go) assembles the broker. It validates the registration authority configuration, verifies the callout key pairs, prepares node identity and certificates, then starts the server with its verifier and dispatcher. Setup happens in that order because the TLS listener needs a valid certificate and the authentication responder needs its internal transport and trust configuration before accepting clients.

Missing registration authorities or the registration password stop startup before any listener opens. The error names the missing environment setting and points to the normal init-config partial-update flow. Saving the same environment file that Compose uses supplies those settings while retaining existing credentials.

[`maintenance.go`](maintenance.go) assembles the shorter-lived commands. `health` probes loopback HTTP, and `fence` uses the running broker's Unix socket. `backup` and `restore` use native NATS connections with their respective client identities. They read or write snapshot files without starting another server or loading the callout issuer's private keys.

Change this package when an executable input or startup dependency changes. The longer-running behavior belongs in the internal packages. [Command composition](../../documentation/MODULES.md#command-composition) explains those dependencies, and [Configuration](../../documentation/CONFIGURATION.md) describes each command's files, mounts and credentials.
