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

The request and result types live in [provider-usage-contract.ts](../src/provider-usage-contract.ts). Authorization carries request identity, model, modality, and estimated units. Recording carries measured dimensions, the provider request ID, optional authorization correlation, workflow sequence, and occurrence time.

## Configuration

| Variable | Default | Effect |
|----------|---------|--------|
| `METRICS_ENABLED` | `false` | Enables the NATS integration |
| `METRICS_REQUEST_TIMEOUT_MS` | `3000` | Bounds each request/reply |
| `METRICS_FAIL_OPEN` | unset | `true` permits execution when authorization is unavailable |

The default policy denies execution when authorization is unavailable. A valid negative decision always denies execution. Disabled integration returns authorization without contacting a responder and discards usage records.

The client validates authorization results and retains only the declared neutral fields. Transport errors are logged without responder error details. A recording failure returns no acknowledgement and does not fail a provider response that has already completed.

## Changing the paired contract

The responder is maintained in another repository. Subject names and JSON shapes require explicit owner authorization to change. Update both implementations in the same change and release them together.

Pause provider intake and drain in-flight calls before replacing either side. Deploy the compatible responder and producer revisions, verify the new subjects, and resume intake. Rollback follows the same drain procedure and restores a compatible revision pair. Do not retain obsolete subject aliases.
