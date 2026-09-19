---
title: Caddy Service Manuals
description: Understanding certificate issuance, durable authority state, serving-secret publication and operational recovery.
---

# Caddy Service Manuals

These manuals explain how Caddy's certificate automation and Lixpi's maintenance code work together. Caddy talks to certificate authorities and solves DNS challenges. The Go service bounds each invocation, preserves account state and decides when a validated serving pair can be published. NATS installs that pair through its separate delivery and rotation path.

That separation helps locate a failure. A DNS challenge failure belongs to issuance; an unreadable archive stops state restoration; a broker still serving an older certificate may have a delivery or installation problem. A successful maintenance metric confirms publication, not what a broker is serving.

[Architecture](ARCHITECTURE.md) follows issuance, shutdown, persistence and delivery, including what happens when a job fails. [Modules and Responsibilities](MODULES.md) connects that flow to the packages and their local READMEs.

For a container or an incident, use [Configuration](CONFIGURATION.md) to identify its inputs, storage formats and metrics, then [Operations](OPERATIONS.md) for local CA trust, public maintenance and recovery. The [service README](../README.md) explains the service boundary. The [Pulumi resource manual](../../../infrastructure/pulumi/src/resources/certificate-manager/README.md) covers scheduling, IAM and alarms; [NATS operations](../../nats/documentation/OPERATIONS.md) covers certificate installation and rollback.
