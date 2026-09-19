---
title: Caddy Maintenance Coordination
description: Ordering state restore, issuance, persistence and publication within a public maintenance invocation.
---

# Caddy Maintenance Coordination

This package coordinates one public certificate maintenance job. [`manager.go`](manager.go) gives each invocation a fresh temporary directory, restores its Caddy state and checks every configured domain. Its `Backend` and `Issuer` interfaces let the command supply AWS and Caddy implementations while tests supply controlled failures.

If every certificate is ready, the manager skips issuance and proceeds to publication. Otherwise it starts the issuer with a bounded deadline. When the invocation has a nearer deadline, it reserves the final minute for persistence. A state-load error or invalid archive stops the job before Caddy starts; missing state is a separate backend result that permits initial issuance.

After the issuer returns, the manager snapshots the stopped runtime's storage and attempts to save it even if issuance failed. An account or renewal-metadata update can still help the next invocation. The save gets a separate one-minute context that survives cancellation of the issuance request. An issuance, snapshot or upload failure prevents publication.

The manager validates every domain again before publishing any pair. Publications then happen one domain at a time, so a later failure can leave earlier secrets updated. It emits success and remaining-validity metrics only after the publication loop succeeds. A metrics failure fails the invocation without rolling back certificates already published.

Change this package when job ordering, deadlines or failure handling changes. Archive rules belong in `state`, AWS calls in `awsstore`, and certificate acceptance in `certificates`. [`manager_test.go`](manager_test.go) exercises those boundaries with disposable state. [Architecture](../../documentation/ARCHITECTURE.md) follows the flow, and [Operations](../../documentation/OPERATIONS.md) explains retry and recovery behavior.
