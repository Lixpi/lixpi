---
title: Recorded Provider Usage
description: Measured dimensions, identity, and acknowledgements for completed provider calls.
---

# Recorded Provider Usage

`UsageReporter` captures the dimensions returned by a provider call. `usageRecordForTextCall()`, `usageRecordForImageCall()`, and `usageRecordForVideoCall()` map them into `ProviderUsageRecordRequest`.

| Measurement | Dimensions |
|-------------|------------|
| `measureTextUsage()` | Prompt, completion, cached, reasoning, and audio token counts |
| `measureImageUsage()` | Generated count, size, and quality |
| `measureVideoUsage()` | Duration, resolution, aspect ratio, vendor tokens, and source-video duration |

The wire carries the dimensions defined by `MeasuredUsage`. Cached tokens are included in prompt tokens, and reasoning tokens are included in completion tokens. They are subsets rather than additional totals. Video records retain resolution for both unit modes. Source-video duration is rounded up to whole seconds.

`model` is the canonical provider model version used by authorization. `providerRequestId` is the provider's request ID and the receiver's deduplication key. `authorizationId` is an optional opaque correlation with the pre-call decision. Workflow identity and sequence group the records.

`ProviderUsageClient.recordUsage()` awaits `{ recorded: true }` from `metrics.provider.usage.record`. Failure logs a neutral warning and returns no acknowledgement; it does not discard a completed provider response. The client does not automatically retry a failed record.

`logRecordedProviderUsage()` logs measured dimensions, acknowledgement state, and request correlation. Provider tariff amounts and private implementation results are absent from these reports.
