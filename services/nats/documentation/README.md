---
title: NATS Service Manuals
description: Understanding connections, messages, stored data and the code that operates the broker.
---

# NATS Service Manuals

These manuals explain two parts of the same service: NATS carries messages and stores JetStream data, while Lixpi's Go code authenticates connections and operates the embedded server. Keeping that distinction clear helps locate a failure. A message rejected by subject permissions, an API resource-access denial and an unavailable authentication worker need different investigations.

[Architecture](ARCHITECTURE.md) follows a connection from credentials to installed permissions, including why a peer may verify it. [Modules and Code Responsibilities](MODULES.md) connects that flow to the packages and explains why their jobs are separate.

For a container or an incident, use [Configuration](CONFIGURATION.md) to identify the required credentials, files and volumes, then [Operations](OPERATIONS.md) for health, certificate rotation and native backup/restore. The [service README](../README.md) explains the application message and storage paths. Deployment-specific host, discovery and off-host recovery work is covered in [NATS Cluster deployment](../../../documentation/platform/deployment/NATS-CLUSTER.md).
