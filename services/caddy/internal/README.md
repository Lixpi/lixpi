---
title: Caddy Internal Packages
description: How the private Go packages divide certificate issuance, validation, persistence and AWS publication.
---

# Caddy Internal Packages

These packages implement certificate maintenance inside the Go service. [`issuer`](issuer/README.md) runs Caddy, [`certificates`](certificates/README.md) checks the resulting material, and [`maintenance`](maintenance/README.md) decides when state is ready to persist and publish. [`state`](state/README.md) reads and writes the archive; [`awsstore`](awsstore/README.md) transfers it and publishes serving secrets and metrics.

The separation matters when part of a job fails. Caddy may create an ACME account before a DNS challenge fails, so maintenance still saves that progress. A failed S3 read must stop the job rather than turn into first issuance. A valid certificate must not reach Secrets Manager until its Caddy state has been saved. The manager controls that order while each adapter reports its own errors.

[`testcert`](testcert/README.md) creates disposable authorities and certificate fixtures for tests. Tests can exercise validation, archive recovery and publication failures without public issuers or AWS. The command tests separately run Caddy's actual local CA.

Go's `internal` directory rule keeps these packages private to this service tree. NATS receives certificate files through its deployment adapter rather than importing this implementation. [Modules and Responsibilities](../documentation/MODULES.md) explains where a change belongs; [Architecture](../documentation/ARCHITECTURE.md) follows the runtime flow.
