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

The client validates authorization results and retains only the declared neutral fields. Transport errors are logged without responder error details. The API persists usage and completion messages in its file-backed `PROVIDER_USAGE_OUTBOX` JetStream workqueue before trying request/reply delivery. The durable consumer retries until the responder acknowledges the operation, with no age or delivery limit. Delivery is at least once, so the responder must deduplicate repeated records. Failure to persist a measurement surfaces as an error.

Authorization replies carry an opaque correlation ID. The responder must recover the same authorization for retries of the same organization and workflow. Completion names the provider request IDs belonging to that authorization and is acknowledged only after those measurements are recorded. Usage and completion may arrive in either order; an early completion stays queued for retry.

Graph adapters include the per-call workflow and modality in the usage idempotency key. A provider response containing both token and image usage produces separate records, and providers without a unique response ID cannot accidentally deduplicate later calls in the same chat. Each model-tool round receives a separate authorization.

An interrupted provider call with an unknown outcome remains unresolved. Process death before a measurement reaches JetStream also requires reconciliation against provider records. The client does not infer usage or report completion for an unknown outcome. Actual measured usage is recorded even when it exceeds the estimate. Authorization policy and reconciliation belong to the external responder.

## Changing the paired contract

The responder is maintained in another repository. Subject names and JSON shapes require explicit owner authorization to change. Update both implementations in the same change and release them together.

Protocol revision 2 adds completion without renaming the authorization or recording fields. Pause provider intake and drain in-flight calls before replacing either side. Refresh signed permissions, deploy compatible producer and responder revisions, then resume intake. The API publishes `provider-usage.outbox`; the responder subscribes to `metrics.provider.request.complete`. Rollback must preserve pending outbox records and restore a compatible pair.
