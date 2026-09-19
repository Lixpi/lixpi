---
title: Caddy State Archives
description: Preserving Caddy's account and certificate tree in a bounded tar.gz archive.
---

# Caddy State Archives

This package serializes Caddy's filesystem state for storage between public invocations. [`archive.go`](archive.go) preserves the directory layout containing authority accounts, keys, certificates and renewal metadata. `Snapshot` produces a tar.gz value; `Restore` unpacks it into the caller's directory. The AWS adapter stores it under `caddy-state.tar.gz`.

Restoration confines access to the supplied directory and rejects paths that escape it. It accepts regular files and directories, rejects links and special entries, and checks the gzip trailer so a damaged checksum fails the restore. Files are created with mode `0600` and directories with `0700`. Archives are limited to 64 MiB compressed and 256 MiB of expanded file content.

Transient `locks` entries are excluded from snapshots and ignored during restoration. A lock records an invocation's ownership; restoring it into a different invocation could make Caddy wait for a process that no longer owns this directory. Durable account and certificate data still travels with the archive.

The caller must stop Caddy and freeze storage writes before taking a snapshot. This package neither coordinates live writers nor calls AWS. The maintenance manager restores into a fresh temporary directory and removes it when the job finishes, so a partial failed restore cannot become the next invocation's starting state.

Change this package when archive compatibility, size limits or filesystem acceptance changes. [`archive_test.go`](archive_test.go) covers round trips, unsafe entries, corruption and transient locks. [Shutdown and persistence](../../documentation/ARCHITECTURE.md#shutdown-and-persistence) explains the surrounding lifecycle, and [Operations](../../documentation/OPERATIONS.md) covers recovery from stored state.
