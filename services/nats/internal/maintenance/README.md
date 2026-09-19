---
title: NATS Maintenance Components
description: Keeping broker identity stable, replacing TLS certificates safely and recovering native stream data.
---

# NATS Maintenance Components

This package contains the operations needed to keep a broker usable across restarts, certificate renewals and data recovery. It works with explicit settings, PEM files, filesystem directories and native NATS APIs. Application bytes and messages remain in JetStream.

[`identity.go`](identity.go) saves the broker name with its data and maintains placement tags and the retirement fence. This prevents a replacement container from silently becoming a differently named broker or undoing a fence partway through evacuation.

[`certificates.go`](certificates.go) validates a delivered certificate/key pair, installs it as a complete version and asks the runtime to check what the TLS listener actually serves. Invalid delivery leaves the installed pair available; failed replacement triggers a rollback attempt. Certificate issuance and delivery happen outside this package.

[`snapshot.go`](snapshot.go) transfers native stream/consumer snapshots over NATS. [`backup.go`](backup.go) adds the account inventory, checksums and completion markers so a partially written set cannot be mistaken for a finished backup. [`files.go`](files.go) reads source certificates and confines snapshot access to the selected directory, replacing files atomically.

Serving uses identity and certificate maintenance. Backup and restore are separate command invocations with their own client credentials; there is no snapshot scheduler hidden in the broker. The package has no cloud SDK or provider API calls. [The module guide](../../documentation/MODULES.md#maintenance-and-storage-adapters) explains the implementation split, and [Operations](../../documentation/OPERATIONS.md) shows certificate and recovery flows.
