---
title: Embedded Caddy Issuer
description: Running Caddy's TLS automation and stopping storage mutations before state is archived.
---

# Embedded Caddy Issuer

This package starts and stops Caddy inside the service process. Caddy handles certificate authority accounts, challenges, issuance and renewal. The caller supplies the storage directory, domains, deadline and a function that checks whether the resulting certificates are ready.

[`caddy.go`](caddy.go) builds native Caddy configuration. Local mode enables the PKI and TLS applications with the internal CA. Public mode enables TLS automation with Caddy's default public issuers and the compiled Route53 DNS module. HTTP and TLS-ALPN challenges are disabled, and neither mode starts an HTTP application or admin listener. Local CA trust installation is disabled too.

`Engine.Maintain` calls `caddy.Run`, checks readiness once per second and stops Caddy before returning. Cancellation or a deadline ends the wait with an error. Caddy's runtime is process-global, so callers must serialize maintenance invocations rather than run two engines concurrently in one process.

[`storage.go`](storage.go) registers `caddy.storage.lixpi_file_system`. It delegates filesystem layout and reads to CertMagic, serializes stores and deletes, and freezes those mutations during Caddy cleanup. A certificate task that finishes late then receives a closed-storage error instead of changing files while the caller archives them. This package doesn't know the S3 bucket or publish serving secrets.

Change this package when issuer configuration, compiled modules or Caddy lifecycle behavior changes. [`caddy_test.go`](caddy_test.go) checks the DNS-only configuration, issuer fallback and frozen storage. [Shutdown and persistence](../../documentation/ARCHITECTURE.md#shutdown-and-persistence) explains why stopping issuance and preserving its state are separate steps.
