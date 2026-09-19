---
title: NATS Internal Packages
description: How the private Go packages divide server lifecycle, connection decisions and operational state.
---

# NATS Internal Packages

These packages implement the Go side of the broker service. Their separation follows the decisions made while accepting a connection: `broker` runs NATS, `admission` chooses a worker within the deadline, `auth` checks the credentials, and `policy` supplies the permissions. `maintenance` handles the identity, certificate files and native snapshots needed to operate and recover the broker.

The split keeps different failures from being treated as the same thing. A rejected token belongs to `auth`; a busy verifier belongs to `admission`; a broken responder connection belongs to `broker`. Only the last case calls for rebuilding that connection. Certificate or snapshot failures have their own recovery rules.

Go's `internal` directory rule keeps these packages private to this service tree. Application services use NATS client libraries rather than importing this implementation. [Modules and Code Responsibilities](../documentation/MODULES.md) explains where a change belongs; [Architecture](../documentation/ARCHITECTURE.md) follows the runtime flow.
