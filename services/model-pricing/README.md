# Model Pricing Service

The model pricing service owns provider-cost snapshots. It runs in the dedicated `PRICING` NATS account and uses four DynamoDB tables for immutable snapshots, records, audit events, and reconciliation evidence.

The service resolves one LiteLLM Git commit before downloading the rate feed from that exact commit, records its SHA-256 digest, scans catalog pricing references, and stages only complete manifests plus holds or verified records. It atomically activates a validated complete manifest, writes an immutable activation event, then publishes `pricing.changed`. Failed imports and failed activation conditions leave the existing active pointer unchanged.

LiteLLM is discovery only. A candidate without a reviewed route-specific official-evidence adapter is recorded as a hold and cannot become a price record. This intentionally fail-closed baseline means deployments cannot accidentally bill from an upstream community feed.

## Configuration

| Variable | Purpose |
|---|---|
| `STAGE` | Deployment stage used as the low-cardinality CloudWatch metric dimension. |
| `NATS_SERVERS` | Comma-separated NATS endpoints. |
| `NATS_PRICING_SERVICE_NKEY_SEED` | Service-owned NKey seed, injected from AWS Secrets Manager in ECS. |
| `NATS_PRICING_OPERATOR_NKEY_PUBLIC` | Comma-separated operator public keys permitted to sign admin commands. |
| `AWS_REGION` | AWS region for DynamoDB. |
| `DYNAMODB_ENDPOINT` | Optional DynamoDB Local endpoint. |
| `AI_MODELS_LIST_TABLE_NAME` | Catalog source scanned for pricing references. |
| `MODEL_PRICING_SNAPSHOTS_TABLE` | Manifests, current hold projections, the active pointer, and activation history. |
| `MODEL_PRICING_RECORDS_TABLE` | Immutable verified candidate records. |
| `MODEL_PRICING_AUDIT_TABLE` | Import-run audit entries and append-only signed override events. |
| `MODEL_PRICING_RECONCILIATION_TABLE` | Daily predictions, provider actuals, watermarks, and incidents. |
| `MODEL_PRICING_IMPORT_INTERVAL_MS` | Import interval; defaults to six hours and cannot be less than one minute. |
| `MODEL_PRICING_SNAPSHOT_RETENTION_MS` | Minimum age before a superseded, non-recent snapshot may be pruned; defaults to 30 days and cannot be less than the import interval. |
| `MODEL_PRICING_RETAINED_ACTIVATIONS` | Number of most-recent activation events whose snapshots are always kept regardless of age; defaults to 5. |
| `MODEL_PRICING_METRICS_INTERVAL_MS` | CloudWatch EMF health heartbeat interval; defaults to 60 seconds and cannot be less than one minute. |
| `MODEL_PRICING_RECONCILIATION_INTERVAL_MS` | Actual-cost reconciliation interval; defaults to six hours and cannot be less than one minute. |
| `MODEL_PRICING_RECONCILIATION_SETTLEMENT_LAG_DAYS` | Rolling number of UTC days revisited for late provider costs; defaults to 14. |
| `MODEL_PRICING_RECONCILIATION_MATERIAL_USD` | Absolute USD divergence that opens an activation-blocking incident; defaults to 1. |
| `MODEL_PRICING_RECONCILIATION_USAGE_TOLERANCE_BPS` | Relative tolerance for provider quantity divergence in basis points; defaults to 100 (1 percent). |
| `MODEL_PRICING_RECONCILIATION_RETENTION_MS` | Minimum age before a settled prediction, actual, or resolved incident may be pruned; defaults to 90 days and cannot be less than the reconciliation interval. |
| `OPENAI_RECONCILIATION_ACCOUNT_REF` | Opaque billing account reference for the configured OpenAI organization. Enables the OpenAI actuals adapter with `OPENAI_ADMIN_API_KEY`. |
| `OPENAI_ADMIN_API_KEY` | OpenAI organization admin key. Pulumi stores it in Secrets Manager instead of the task definition when supplied. |
| `OPENAI_RECONCILIATION_PROJECT_IDS` | Comma-separated project allowlist. Costs and usage outside it are excluded. Leaving it unset includes every project in the organization, so a shared organization can produce false divergence incidents. |
| `OPENAI_RECONCILIATION_API_KEY_IDS` | Optional comma-separated API-key allowlist for Usage reconciliation. The Costs endpoint does not support API-key filtering. |

## Serving and operator control

The service replies to `pricing.revision.get`, `pricing.model.get`, and `pricing.table.get` from the active immutable snapshot only. It validates the pointer, manifest, record count, and immutable record hash before serving a table. `pricing.changed` is emitted only after the pointer transaction commits. A table transfer does not count as a consumer refresh: billing sends `pricing.consumer.refresh.ack` only after it independently verifies, persists, and installs the snapshot. `pricing.admin.status.get` also returns, next to each held candidate, the record currently serving for that pricing key (if any) so an operator can compare the active hash/evidence/parser version against the new held candidate without a second lookup.

Billing publishes `pricing.reconciliation.predicted.daily` after a UTC day closes. Each route/account/day/snapshot aggregate carries every implicated pricing key plus provider-model usage groups. Billing deduplicates source operations by `providerRequestId`, derives the day from `occurredAt`, and persists both running totals and deduplication records before publication retries.

The service compares the monetary total with OpenAI Costs evidence at project and line-item scope. It separately compares input, cached-input, output, request, and image quantities with the OpenAI organization [Completions Usage](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/completions/) and [Images Usage](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/images/) endpoints at the finest common model, API-key, and selector grouping. Reconciliation and imports run through one serialized maintenance queue, so an import cannot activate before a queued actuals pass finishes. A material unresolved cost or quantity incident blocks activation only when the served pricing content changed for an implicated key. The active snapshot is never rewritten by reconciliation.

Only the OpenAI route has an actuals adapter. Anthropic, Gemini, Vertex AI, Stability, AWS Bedrock, and BytePlus reconciliation remains disabled until each route has provider evidence support. `pricing.admin.status.get` (`pricingctl status`) reports configured actuals routes, per-route/account watermarks, and open incidents.

## Metrics, alarms, and operations

The service emits low-cardinality CloudWatch Embedded Metric Format events for active snapshot age, pricing coverage, live holds, missing routes, provider-parser failures, consumer refresh lag, import/reconciliation outcomes, watermarks, and open incidents. Pulumi creates availability, stale-snapshot, stale-consumer, held-route, missing-route, parser, maintenance, and material-reconciliation alarms. Set `MODEL_PRICING_ALARM_SNS_TOPIC_ARN` in the Pulumi environment to attach their actions to an existing SNS topic.

See [Model Pricing Operations](../../documentation/platform/deployment/MODEL-PRICING-OPERATIONS.md) for metric definitions, alarm thresholds, incident runbooks, NKey rotation, and the service's NATS/IAM boundaries.

After each import, the service prunes complete, superseded snapshot manifests and their records once they are both older than `MODEL_PRICING_SNAPSHOT_RETENTION_MS` and outside the `MODEL_PRICING_RETAINED_ACTIVATIONS` most recent activations; the current active snapshot is never pruned. Pruning cannot see whether a separate repository (billing) still references an older snapshot, so both settings should stay comfortably longer than any in-flight billing operation. A crash mid-import that writes records/holds but never commits a manifest leaves an orphaned, unpruned partial snapshot; detecting that case is a separate, not-yet-built gap.

After each reconciliation pass, the service prunes settled predictions, actuals, and resolved incidents older than `MODEL_PRICING_RECONCILIATION_RETENTION_MS`; open incidents and anything inside the settlement lag window are never pruned.

`pricingctl` is the operator surface. It signs requests with `NATS_PRICING_OPERATOR_NKEY_SEED` and sends them under the operator NATS identity:

```
docker exec -e NATS_PRICING_OPERATOR_NKEY_SEED lixpi-model-pricing pnpm pricingctl status
docker exec -e NATS_PRICING_OPERATOR_NKEY_SEED lixpi-model-pricing pnpm pricingctl holds
docker exec -e NATS_PRICING_OPERATOR_NKEY_SEED lixpi-model-pricing pnpm pricingctl override propose '<command-json>'
docker exec -e NATS_PRICING_OPERATOR_NKEY_SEED lixpi-model-pricing pnpm pricingctl override approve '<command-json>'
docker exec -e NATS_PRICING_OPERATOR_NKEY_SEED lixpi-model-pricing pnpm pricingctl override reject '<command-json>'
```

The command JSON supplies the immutable target fields such as `commandId`, `pricingKey`, `expectedActiveSnapshotId`, `candidateHash`, `reason`, `changeReference`, `nonce`, and a `patch` for proposals; `approve`/`reject` instead supply `proposalEventId`, the exact proposal event (returned as `eventId` from the `propose` call) being resolved. The CLI adds timestamps, actor key id, action, and signature. The service accepts only fresh commands, verifies the configured public key and signature, requires approvals to use a different operator key than the proposal, binds `approve`/`reject` to that specific proposal event (not merely to any proposal sharing the same candidate hash, so a later unapproved re-proposal can never inherit an earlier approval), binds all events to the current held candidate hash, and records an idempotency index plus append-only event in `MODEL_PRICING_AUDIT`.

## Tests

`docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner model-pricing` — its own domain in the shared TypeScript test runner (see `documentation/testing/TypeScript/TESTING-GUIDE.md`), never run on the host. Coverage today includes the `reconciliation/` module (decimal parsing, the OpenAI actuals adapter, and `PricingReconciliationService`'s materiality/incident logic) plus `PricingStorage`'s activation/reconciliation guard. Provider evidence adapters and the admin, serving, and telemetry layers do not yet have direct test coverage.
