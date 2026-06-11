# Workloads

Lixpi's background work runs on the NATS bus via NEX (the NATS Execution Engine),
on the node at [`services/nex`](../../../nex) — no AWS Lambda / GCP / Azure
function runtimes.

NEX supports containers, VMs, and WASM through pluggable nexlets and ships an
official multi-arch Docker image. The bundled runtime is the `native` nexlet;
other runtimes are a Go-SDK extension point. See
[`documentation/knowledge/NATS-NEX-EXECUTION-ENGINE-EXPLAINED.md`](../../../../documentation/knowledge/NATS-NEX-EXECUTION-ENGINE-EXPLAINED.md).

## Workloads

- **`ai-models-synchronization`** — the hourly AI-models catalog sync, at
  [`services/nex/workloads/ai-models-synchronization`](../../../nex/workloads/ai-models-synchronization).

## Adding a workload

Put it under `services/nex/workloads/<name>/` with a thin wrapper + a Nexfile and
deploy it from the node entrypoint. See the deployment doc
[`documentation/platform/deployment/NEX-EXECUTION-ENGINE.md`](../../../../documentation/platform/deployment/NEX-EXECUTION-ENGINE.md)
and the operator guide at [`services/nex/README.md`](../../../nex/README.md).
