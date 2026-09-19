---
title: Caddy Certificate Service
description: Embedded Caddy certificate issuance for local development and scheduled public TLS maintenance.
---

# Caddy Certificate Service

`lixpi-caddy` obtains and renews the certificates used by Lixpi's NATS WebSocket listeners. It embeds Caddy's TLS and PKI modules in a Go executable. Caddy handles certificate authorities, ACME accounts, DNS challenges and renewal. The service handles invocation deadlines, durable state, certificate validation, local file exports and publication to AWS Secrets Manager.

The executable has two operating modes. Local Compose runs Caddy's internal CA, exports `ca.crt`, `localhost.crt` and `localhost.key` into the shared certificate volume, then exits. AWS Lambda restores public-certificate state from S3, performs any maintenance that is due, publishes validated certificate/key pairs and reports CloudWatch metrics. The Lambda runs at deployment and every six hours.

## Why Caddy runs inside Go

The process calls `caddy.Run` with a native configuration and calls `caddy.Stop` when issuance finishes or its deadline expires. It imports the Route53 DNS module at build time. There is no subprocess to supervise and no shell, Caddy CLI, AWS CLI, OpenSSL or JSON command-line tool in the runtime image. Go's TLS, archive and AWS libraries perform those operations directly.

This follows the same service boundary as [the embedded NATS broker](../nats/README.md): the service directory contains its Go module, runtime, image and manuals. [The certificate-manager Pulumi resource](../../infrastructure/pulumi/src/resources/certificate-manager/README.md) creates AWS resources and supplies configuration. It does not contain certificate-runtime source.

Certificate issuance needs Caddy's TLS application, but it doesn't need a web server. The native configuration names the certificates to automate and disables the admin listener. Public issuance uses Route53 DNS-01, so no incoming HTTP or TLS connection to the Lambda is needed. Local issuance uses the internal CA without installing trust into the container or host.

## State and delivery

The private S3 object `caddy-state.tar.gz` holds ACME accounts, certificates, private keys, issuer metadata and renewal information. Each public invocation restores that state into a fresh temporary directory. Missing state permits initial issuance; a failed or corrupt state read fails the invocation. Transient lock files do not travel between invocations.

Secrets Manager holds the serving material as one JSON value with `certificate` and `private_key` fields. The deployment adapter delivers it to the broker's certificate volume. NATS validates and installs the pair independently, so certificate issuance and broker availability have separate lifecycles. See [NATS operations](../nats/documentation/OPERATIONS.md) for live rotation and rollback.

## Manuals

The [service manuals](documentation/README.md) follow issuance through persistence and delivery. The [command README](cmd/README.md) explains invocation paths, and the [internal package README](internal/README.md) explains how the runtime responsibilities fit together. Each package's README describes its behavior beside the code.

| Concern | Read |
|---|---|
| Issuance, renewal decisions, state persistence and failures | [Architecture](documentation/ARCHITECTURE.md) |
| Package responsibilities and where to make changes | [Modules](documentation/MODULES.md) |
| Commands, environment variables and storage formats | [Configuration](documentation/CONFIGURATION.md) |
| Local trust, deployment, alarms and recovery | [Operations](documentation/OPERATIONS.md) |

Builds, dependency maintenance, formatting and tests run through Docker. The shared [Go Testing and Tooling guide](../../documentation/testing/Go/TESTING-GUIDE.md) documents the `caddy` runner domain. [go.mod](go.mod) pins Caddy, Route53 and AWS dependencies; [go.sum](go.sum) records their checksums. The [Dockerfile](Dockerfile) uses the repository root as its build context and ships a static executable with CA roots.
