---
title: NATS Admission Coordination
description: Keeping connection verification bounded and asking a compatible peer when local verification cannot finish.
---

# NATS Admission Coordination

This package coordinates authentication while a client waits to connect. The `Dispatcher` keeps the request's deadline and returns its final answer to NATS. The `Worker` limits the number of credential checks running in this process. They are Go objects, not separate services.

If the local worker is full or an attempt cannot finish, the dispatcher can ask a compatible peer. The peer checks one attempt and replies; it never forwards the work again. An invalid credential is a final rejection, while an unreachable signing-key provider may justify trying another node with the key cached.

Before verification, the dispatcher reads and pins the authoritative registration snapshot. A peer must resolve that same revision before evaluating the request. A changed or unavailable registry prevents admission, even if a parsed snapshot is cached locally.

The limits matter because authentication shares CPU and memory with messaging and storage. A timed-out verifier retains its worker slot until it actually returns, preventing repeated timeouts from accumulating unlimited goroutines. Signed peer messages also identify the node instance and exact attempt so an old reply cannot finish another request.

[Admission coordination](../../documentation/MODULES.md#admission-coordination) explains the worker, dispatcher, membership and wire code. [Capacity and peer selection](../../documentation/ARCHITECTURE.md#capacity-and-peer-selection) shows the retry flow and timing limits.
