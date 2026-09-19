---
title: Caddy Modules and Responsibilities
description: How the command, embedded issuer, validation, durable state and AWS adapter divide certificate maintenance.
---

# Caddy Modules and Responsibilities

The service separates certificate protocol work from storage and deployment concerns. This lets tests exercise persistence failures without AWS, and lets local development run the actual Caddy issuer without cloud credentials.

## Command and invocation lifecycle

[`cmd/lixpi-caddy`](../cmd/lixpi-caddy/README.md) chooses local or public maintenance, builds the AWS clients, connects the internal packages and handles signals. Its configuration reader validates required settings and public DNS names before issuance. In Lambda, the official AWS runtime owns the invocation loop, request IDs, deadline contexts and error responses. An invocation's event body cannot override the deployment's domain list.

## Embedded certificate issuer

[`internal/issuer`](../internal/issuer/README.md) owns native Caddy configuration and its start/stop lifecycle. Local configuration loads the PKI and TLS applications. Public configuration loads TLS with Route53 DNS challenges. It configures no HTTP application or admin listener.

The [storage module](../internal/issuer/storage.go) wraps CertMagic's filesystem implementation. Its cleanup prevents later mutation after Caddy stops, which gives the archive writer a stable tree. It preserves CertMagic's account and certificate paths. The package does not publish secrets or know the S3 bucket.

Change this package when changing issuer configuration or embedded-runtime lifecycle. Tests verify the DNS-only configuration, issuer fallback, compiled Route53 module and frozen-write behavior. The command tests run a real internal CA and reuse the same storage for a second invocation.

## Certificate validation

[`internal/certificates`](../internal/certificates/README.md) reads certificate material across issuer directories and checks it with Go's TLS and X.509 libraries. It also evaluates the lifetime and persisted ARI deadlines used by the maintenance loop. A candidate carries its validated leaf and serving-secret pair together, so publication uses the material that was checked.

This package owns local CA loading and the exported Compose filenames. It has no AWS dependency. Changes to certificate acceptance belong here; changes to the broker's acceptance policy belong to the NATS service instead.

## Maintenance ordering

[`internal/maintenance`](../internal/maintenance/README.md) enforces restore, issue, persist, validate, publish and report ordering. Its small `Backend` and `Issuer` interfaces describe the operations it needs without binding tests to a network provider. The deadline reserve and persistence after failed issuance belong here.

The manager validates all domains before the publication loop. It fails on missing domain configuration rather than emitting a false success measurement. Tests exercise skipped issuance, renewal, durable accounts and failures before publication.

## Archives and AWS calls

[`internal/state`](../internal/state/README.md) owns tar.gz compatibility, size limits, private-file permissions and safe restoration. It excludes transient locks while retaining durable Caddy data. It does not call AWS.

[`internal/awsstore`](../internal/awsstore/README.md) implements the maintenance backend with AWS SDK v2 clients. It owns the state-object key, secret-name conversion, `AWSCURRENT` lookup, unchanged-pair comparison, idempotent writes and CloudWatch metric contract. Tests supply SDK-compatible clients and check errors and requests without contacting AWS.

[`internal/testcert`](../internal/testcert/README.md) creates disposable test authorities and certificate fixtures. Production code does not import it, so it is absent from the service binary. Tests never load application private keys or trust roots.

Pulumi resource creation remains in [infrastructure](../../../infrastructure/pulumi/src/resources/certificate-manager/README.md). Changes to scheduling, IAM, resource retention, alarms or broker dependencies belong there.
