---
title: Model Pricing Operations
description: Metrics, alarms, incident runbooks, credential rotation, and least-privilege boundaries for the model-pricing service.
---

# Model Pricing Operations

The model-pricing service keeps the last verified provider-cost snapshot active while it imports provider evidence, serves billing, and reconciles predicted cost against provider actuals. An import, parser, or reconciliation failure does not rewrite the active snapshot. Operators repair the failed input or use the signed override workflow; they do not edit pricing tables or the active pointer directly.

For the data and request contract, see the [model-pricing service README](../../../services/model-pricing/README.md). For its AWS placement, see [Infrastructure Overview](./INFRASTRUCTURE-OVERVIEW.md).

## Metrics and alarm delivery

The service writes one CloudWatch Embedded Metric Format JSON event to stdout every `MODEL_PRICING_METRICS_INTERVAL_MS` (60 seconds by default). ECS sends stdout to `/aws/ecs/model-pricing`, and CloudWatch extracts the `Lixpi/ModelPricing` namespace. The only dimensions are `Service=model-pricing` and `Stage=<stack stage>`. Snapshot IDs, errors, and task names remain searchable log fields rather than dimensions.

This follows the [CloudWatch EMF specification](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html). The service does not call `PutMetricData`, so its task role needs no CloudWatch metric permission.

Set `MODEL_PRICING_ALARM_SNS_TOPIC_ARN` in the Pulumi environment to attach an existing SNS topic to every pricing alarm. Pulumi still creates the alarms when the variable is unset, but disables their actions. The topic policy and its subscribers are managed outside this service.

| Metric | Meaning |
|--------|---------|
| `ActiveSnapshotPresent` | `1` when an active pointer exists, otherwise `0`. Missing heartbeat data also drives the availability alarm. |
| `ActiveSnapshotAgeSeconds` | Time since the active pointer was committed. |
| `LastSuccessfulImportAgeSeconds` | Time since the last successful provider-evidence import. Before the first import after process start, it conservatively uses active snapshot age. |
| `ActiveRecordCount` / `CatalogRouteCount` / `PricingCoveragePercent` | Priceable active keys, current catalog pricing keys, and the percentage of catalog keys with active records. |
| `HeldRouteCount` / `MissingRouteCount` | Candidate keys held from activation, and held keys that have no last-known-good active record. |
| `ParserFailureHoldCount` | Holds caused by unavailable, challenged, oversized, invalid, contradictory, or structurally changed official provider evidence. |
| `ConsumerRefreshPending` / `ConsumerRefreshLagSeconds` | Whether an authorized consumer has acknowledged installing the active snapshot, and how long the current activation or post-restart acknowledgement wait has lasted. |
| `ConsumerRefreshSuccessCount` / `ConsumerRefreshDurationSeconds` | First accepted post-install `pricing.consumer.refresh.ack` and its pending-to-acknowledged duration, emitted once per snapshot activation or service restart. |
| `ImportSuccessCount` / `ImportDurationMilliseconds` | Successful immutable import and activation attempts. |
| `ReconciliationSuccessCount` / `ReconciliationDurationMilliseconds` | Successful provider-actuals reconciliation cycles. |
| `MaintenanceFailureCount` | Import, reconciliation, pruning, or health-collection failures. The log field `MaintenanceTask` names the failing operation. |
| `ReconciliationConfiguredRouteCount` | Actuals routes enabled by deployment configuration. |
| `ReconciliationOpenIncidentCount` / `ReconciliationMaterialIncidentCount` | Open provider-actuals mismatches and the subset that blocks a changed implicated pricing key from activation. |
| `ReconciliationWatermarkLagSeconds` | Age of the oldest recorded actuals watermark. It is `0` until a configured adapter has a watermark. |

Pulumi creates these alarms:

| Alarm | Condition | Missing-data policy |
|-------|-----------|---------------------|
| `active-snapshot-missing` | `ActiveSnapshotPresent < 1` for two 5-minute periods. | Breaching, because the heartbeat is continuous. |
| `active-snapshot-stale` | Time since the last successful import reaches 36 hours for three 5-minute periods. Stable rate content can be reverified without moving the active pointer. | Not breaching; the availability alarm covers a stopped heartbeat. |
| `consumer-refresh-stale` | Refresh remains pending for three 5-minute periods. | Not breaching. |
| `missing-route` | At least one catalog route has no active verified record. | Not breaching. |
| `held-route` | At least one candidate remains held, including a route that still serves its last-known-good active record. | Not breaching. |
| `parser-failure` | At least one live hold has a provider-evidence parser failure. | Not breaching. |
| `maintenance-failure` | At least one sparse failure event occurs in a 5-minute period. | Not breaching, as no event means no failure. |
| `reconciliation-incident` | At least one material reconciliation incident remains open. | Not breaching. |

## First response

1. Check the alarm metric and the matching EMF event in `/aws/ecs/model-pricing`. Filter on `Event`, `MaintenanceTask`, and `SnapshotId`; do not search for a pricing key as a metric dimension.
2. Run `pricingctl status`. It shows the active pointer, active record count, live holds with their active records, configured actuals routes, watermarks, and open incidents.
3. Run `pricingctl holds` when the incident concerns coverage or provider evidence.
4. Confirm whether billing is serving its persisted last-known-good cache. A healthy cache keeps existing priced routes usable while a new candidate is held.
5. Fix the source, configuration, credential, or parser. Do not write directly to `MODEL_PRICING_SNAPSHOTS`, `MODEL_PRICING_RECORDS`, `MODEL_PRICING_AUDIT`, or `MODEL_PRICING_RECONCILIATION`.

Local operator commands are documented in the [service README](../../../services/model-pricing/README.md). Production operators run the same `pricingctl` entry point from a trusted environment that can reach NATS and that receives one operator seed only for the duration of the command.

## Active snapshot is missing or stale

1. Check ECS deployment and task health, then inspect `pricing_maintenance_failed` and `pricing_import_succeeded` log events.
2. Use `pricingctl status` to distinguish no pointer from an old pointer. An old verified snapshot is safe to serve while repair proceeds; no pointer means billing must remain fail-closed.
3. If imports fail before staging, inspect the pinned LiteLLM fetch and provider-source error. If staging succeeds but activation fails, inspect the immutable manifest/hash validation and reconciliation incidents.
4. Confirm the task role can read the catalog, scan and batch-write pricing tables, and transact the active pointer. An IAM denial appears as a maintenance failure and must be fixed in Pulumi.
5. Re-run the catalog synchronization through its documented NEX operation or wait for the import interval after the cause is fixed. Its completion event wakes the pricing importer. Never construct or move the active pointer manually.

## Missing route or parser failure

1. Inspect the hold's `reason`, `detail`, `candidateHash`, and `activeRecord` through `pricingctl holds`.
2. A `missing-upstream-entry` or `unsupported-route` with no `activeRecord` is an unpriceable route. Stop the catalog route or add the reviewed resolver/adapter before provider traffic uses it.
3. For source and parser holds, fetch only the adapter's allowlisted official surface. Compare its structural locator and price evidence with the adapter contract. Do not execute provider JavaScript or follow an unreviewed URL.
4. Repair and deploy the parser when official evidence is machine-verifiable. The next import resolves the hold and activates a complete snapshot.
5. If automation cannot adjudicate the official evidence, use `override propose`, then have a different operator key approve the exact `proposalEventId` and `candidateHash`. The approval is append-only evidence for that candidate only.

Existing active records stay usable while a changed candidate is held. `MissingRouteCount` counts only keys that have no such record; `HeldRouteCount` still exposes the broader evidence problem.

## Consumer refresh is stale

`ConsumerRefreshPending` clears only after billing sends `pricing.consumer.refresh.ack` for the currently active snapshot. Billing sends that request after manifest/hash verification, owner-only cache persistence, and the in-memory swap. Merely serving `pricing.table.get` never clears the metric. On a model-pricing restart, the active snapshot starts pending again; billing re-acknowledges its already-verified installed cache during the next boot, reconnect, or periodic revision check. If billing remains unavailable, pending state is preserved and the alarm fires.

1. Confirm `pricing.changed` was published after the activation log event.
2. Inspect billing's pricing-client logs for NATS disconnects, revision/hash rejection, cache write failure, a failed `pricing.table.get`, or a rejected `pricing.consumer.refresh.ack`.
3. Confirm the `svc:pricing-billing` public key is registered in the API auth callout and its seed is present only in the billing runtime.
4. Restore connectivity or cache permissions. Billing refreshes on boot, reconnect, `pricing.changed`, and its periodic revision poll, so a healthy client repairs itself without a pricing-pointer change.
5. Verify billing has installed the active snapshot, then verify a `pricing_consumer_refreshed` event for that `SnapshotId` and confirm the alarm returns to `OK`.

## Reconciliation incident or lag

1. Use `pricingctl status` to inspect implicated pricing keys, route/account scope, day, cost or quantity basis, and watermarks.
2. Confirm billing is publishing closed UTC-day aggregates and that its reconciliation cache is writable and persistent. An open day is intentionally not published.
3. Confirm the provider account, project, and API-key allowlists match on both sides. A shared account without a project allowlist can include unrelated spend.
4. Check the actuals credential and the provider response. OpenAI actuals require `OPENAI_ADMIN_API_KEY`; its secret is injected by ECS and must never appear in logs or operator commands.
5. Repair attribution, late data, or provider parsing, then let the normal reconciliation loop write the next incident state. Do not delete or mark an incident directly. A material open incident blocks activation only for changed implicated pricing keys.

Only `openai-api` has an actuals adapter. Other routes report no watermark until a reviewed provider-specific adapter is configured.

## Rotate pricing NKeys

Rotate every NKey pair at least every 90 days and immediately after suspected exposure. Generate a user NKey with `nsc generate nkey --user` or `nk -gen user`. A seed (`SU...`) is secret; its public key (`U...`) is verification material.

All three pricing public-key variables accept comma-separated keys. Use that overlap for zero-downtime rotation:

1. Generate a new pair and store the new seed in the owning secret store.
2. Add the new public key beside the old key in the matching `NATS_PRICING_*_NKEY_PUBLIC` value and deploy the API first. For an operator key, deploy model-pricing with the same overlapped `NATS_PRICING_OPERATOR_NKEY_PUBLIC` list so command-signature verification also accepts both keys. Verify that both keys authenticate with the same identity and permissions.
3. Deploy the owning runtime with the new seed. For `svc:model-pricing`, update the Pulumi-managed Secrets Manager value. For `svc:pricing-billing`, update the billing deployment secret. For an operator, distribute the seed only to that operator's trusted execution environment.
4. Verify connection and one read-only operation. For the service, confirm health metrics and a revision request. For billing, confirm a revision/table refresh. For an operator, use `pricingctl status`.
5. Remove the old public key from the auth-callout environment, deploy the API, then revoke and destroy the old seed.

Operator rotation has an additional rule: keep at least two distinct operator pairs. Rotate one at a time, and never let the same actor key propose and approve an override. An approval references the exact proposal event, so an in-flight proposal must be approved by a still-registered key or reproposed after rotation.

## Least-privilege boundaries

The API auth callout maps every registered pricing public key to the `PRICING` account and these subject allowlists:

| Identity | Publish | Subscribe |
|----------|---------|-----------|
| `svc:model-pricing` | `_INBOX.>`, `pricing.changed` | `_INBOX.>`, `aiModels.syncCompleted`, pricing read/consumer-ack/admin/reconciliation request subjects |
| `svc:pricing-operator` | `_INBOX.>`, `pricing.admin.status.get`, `pricing.admin.override.command` | `_INBOX.>` |
| `svc:pricing-billing` | `_INBOX.>`, pricing read requests, `pricing.consumer.refresh.ack`, `pricing.reconciliation.predicted.daily` | `_INBOX.>`, `pricing.changed` |

The model-pricing ECS task role can read the catalog table. On the four pricing tables it can read, scan, write, batch-write, and transact the active pointer. It has no access to user, workspace, Asset, Blob, Capability, or billing-ledger data. The ECS execution role reads the service NKey secret and, when configured, the OpenAI admin-key secret; the task role does not receive Secrets Manager API permission. Logs flow through the ECS execution role.

CloudWatch metrics come from stdout EMF, so adding telemetry did not widen either role. Keep alarm notification permissions on the SNS topic and its subscribers rather than on the pricing task.
