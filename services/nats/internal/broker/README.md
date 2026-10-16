---
title: NATS Broker Runtime
description: Starting the upstream server and keeping its authentication connection, TLS listener and shutdown in order.
---

# NATS Broker Runtime

This package runs the upstream NATS server inside the Go process. NATS does the message routing and JetStream storage. This package attaches Lixpi's in-process authentication responder and manages the resources that must live and stop with the server.

[`auth.go`](auth.go) restricts the responder's bootstrap user to in-process connections and keeps the original auth callout on the accepting broker. [`runtime.go`](runtime.go) starts that connection, rebuilds it after repeated structural failures and drains the broker on shutdown. It keeps worker capacity intact across a rebuild so stalled checks cannot escape their limits.

The runtime also swaps the certificate used by future TLS handshakes. It avoids a full server reload for renewal because that reload can disconnect authenticated clients. [`health.go`](health.go) distinguishes a stopped broker from unavailable admission capacity; busy verification should not restart a server still carrying healthy application traffic.

[`registration.go`](registration.go) creates application accounts from trusted authority scopes and the isolated REGISTRATION account. Its network bootstrap user can submit signed manifests; its in-process store connection writes JetStream KV and supplies the authoritative admission resolver. Broker startup does not require an application manifest. If the internal store connection dies, readiness fails and the supervisor replaces the process.

Read [Broker lifecycle](../../documentation/MODULES.md#broker-lifecycle) for the code relationships and [Operations](../../documentation/OPERATIONS.md) for health, rotation and shutdown behavior.

Signed browser profiles may require an application admission check and name a durable account-change stream. The broker's in-process application connection requests the decision after signature verification; the reply can shorten a browser lease but cannot expand its permissions. Each accepting broker independently replays the stream before admitting those browsers. It indexes approved client IDs and epochs before releasing an auth response, disconnects invalidated clients through the upstream server API, and refuses stale in-flight approvals. Losing the stream or its connection closes affected browser sessions. Service identities do not enter this index. The private connection can read stream state, create filtered consumers, fetch and acknowledge events; it cannot publish application messages or modify stream configuration.

With account admission enabled, each broker records its Docker container ID or ECS task and container identity on its account-control consumers. A feed reuses its consumer after reconnecting. Consumers remain stored after a process disappears so a missing acknowledgement cannot be mistaken for a completed disconnect.

The scale-in test starts four disposable brokers and waits for their metadata replicas to catch up before creating streams. It checks that evacuating a broker preserves a single-replica stream, its consumer and concurrent writes to a replicated stream. Management requests and peer removal use bounded waits because removal can trigger a metadata leader election.
