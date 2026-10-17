---
title: Provider Usage Port
description: The cross-repository NATS authorization and measured-usage contract.
---

# Provider Usage Port

`ProviderUsageClient` accepts a transport with one NATS request/reply method and explicit integration options.

| Operation | Subject | Result |
|-----------|---------|--------|
| `authorizeRequest()` | `metrics.provider.request.authorize` | `authorized`, optional opaque `authorizationId`, optional neutral `reason` |
| `recordUsage()` | `metrics.provider.usage.record` | `recorded` acknowledgement |
| `completeRequest()` | `metrics.provider.request.complete` | `completed` acknowledgement |

The request and result types live in [provider-usage-contract.ts](../src/provider-usage-contract.ts). Authorization carries request identity, model, modality, and estimated units. Recording carries measured dimensions, the provider request ID, optional authorization correlation, workflow sequence, and occurrence time.

## Configuration

| Variable | Default | Effect |
|----------|---------|--------|
| `METRICS_ENABLED` | `false` | Enables the NATS integration |
| `METRICS_REQUEST_TIMEOUT_MS` | `3000` | Bounds each request/reply |
| `METRICS_FAIL_OPEN` | unset | `true` permits execution when authorization is unavailable |

The default policy denies execution when authorization is unavailable. A valid negative decision always denies execution. Disabled integration returns authorization without contacting a responder and discards usage records.

The client validates authorization results and retains only the declared neutral fields. Transport errors are logged without responder error details. The API persists usage and completion messages in its file-backed `PROVIDER_USAGE_OUTBOX` JetStream workqueue before trying request/reply delivery. The durable consumer retries until billing acknowledges the operation, with no age or delivery limit. A lost acknowledgement can repeat delivery but cannot repeat a charge. Failure to persist a measurement surfaces as an error; it is not treated as successful recording.

Billing reserves the estimated cost under the organization's account lock. The same organization and workflow ID recover the same authorization after a lost reply. Usage consumes the reservation in the same transaction as the ledger charge. Completion names every provider request ID from that authorization and releases unused funds only after those receipts exist. This permits usage and completion messages to arrive in either order.

Graph adapters include the per-call workflow and modality in the usage idempotency key. A provider response containing both token and image usage produces separate records, and providers without a unique response ID cannot accidentally deduplicate later calls in the same chat. Each model-tool round receives a separate authorization.

An interrupted provider call with an unknown cost retains its reservation. Process death before a measurement reaches JetStream also leaves the reservation for reconciliation. Holds have no automatic expiration: releasing them while a provider could still charge would reopen the concurrent spending gap. An operator must reconcile unresolved calls against provider records before completing them. Actual usage is always recorded even if it exceeds the estimate; the next authorization fails when available funds are insufficient.

## Changing the paired contract

The responder is maintained in another repository. Subject names and JSON shapes require explicit owner authorization to change. Update both implementations in the same change and release them together.

Protocol revision 2 adds completion without renaming the authorization or recording fields. Pause provider intake and drain in-flight calls before replacing either side. Apply billing migration `00005_provider_reservations`, refresh the signed API and billing permissions, deploy both revisions, then resume intake. The API publishes the private `provider-usage.outbox` subject; billing subscribes to the completion subject. Rollback must drain the outbox and reconcile active reservations before restoring a compatible pair. Never drop pending outbox messages or reservation rows to make a rollback succeed.
