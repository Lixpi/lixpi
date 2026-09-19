---
title: Caddy Command Entry Points
description: How container arguments and Lambda invocations select local issuance or public certificate maintenance.
---

# Caddy Command Entry Points

This directory contains the [`lixpi-caddy` executable](lixpi-caddy/README.md). It turns a container invocation into local certificate issuance, public certificate maintenance, or a version query. AWS Lambda invokes the same public maintenance code through the official Go runtime.

The paths share a binary and embedded Caddy modules, but use different storage and credentials. Local mode keeps its CA and certificates in a mounted directory. Public mode restores Caddy's state from S3 and publishes serving material to Secrets Manager with the deployment's AWS identity.

Command selection, environment binding, process signals and Lambda handling belong here. The internal packages receive settings and clients assembled by the command. [Command and invocation lifecycle](../documentation/MODULES.md#command-and-invocation-lifecycle) explains that composition; [Configuration](../documentation/CONFIGURATION.md) lists the arguments and required inputs.
