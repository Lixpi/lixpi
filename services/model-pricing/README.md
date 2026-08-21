# Model Pricing Service

The model pricing service owns provider-cost snapshots. It runs in the dedicated `PRICING` NATS account and uses four DynamoDB tables for immutable snapshots, records, audit events, and reconciliation evidence.

The service resolves one LiteLLM Git commit before downloading the rate feed from that exact commit, records its SHA-256 digest, scans catalog pricing references, and stages only complete manifests plus holds or verified records. Phase 5 atomically activates a validated complete manifest, writes an immutable activation event, then publishes `pricing.changed`. Failed imports and failed activation conditions leave the existing active pointer unchanged.

LiteLLM is discovery only. A candidate without a reviewed route-specific official-evidence adapter is recorded as a hold and cannot become a price record. This intentionally fail-closed baseline means deployments cannot accidentally bill from an upstream community feed.

## Configuration

| Variable | Purpose |
|---|---|
| `NATS_SERVERS` | Comma-separated NATS endpoints. |
| `NATS_PRICING_SERVICE_NKEY_SEED` | Service-owned NKey seed, injected from AWS Secrets Manager in ECS. |
| `NATS_PRICING_OPERATOR_NKEY_PUBLIC` | Comma-separated operator public keys permitted to sign admin commands. |
| `AWS_REGION` | AWS region for DynamoDB. |
| `DYNAMODB_ENDPOINT` | Optional DynamoDB Local endpoint. |
| `AI_MODELS_LIST_TABLE_NAME` | Catalog source scanned for pricing references. |
| `MODEL_PRICING_SNAPSHOTS_TABLE` | Manifests and append-only holds. |
| `MODEL_PRICING_RECORDS_TABLE` | Immutable verified candidate records. |
| `MODEL_PRICING_AUDIT_TABLE` | Import-run audit entries. |
| `MODEL_PRICING_IMPORT_INTERVAL_MS` | Import interval; defaults to six hours and cannot be less than one minute. |
| `MODEL_PRICING_SNAPSHOT_RETENTION_MS` | Minimum age before a superseded, non-recent snapshot may be pruned; defaults to 30 days and cannot be less than the import interval. |
| `MODEL_PRICING_RETAINED_ACTIVATIONS` | Number of most-recent activation events whose snapshots are always kept regardless of age; defaults to 5. |

## Serving and operator control

The service replies to `pricing.revision.get`, `pricing.model.get`, and `pricing.table.get` from the active immutable snapshot only. It validates the pointer, manifest, record count, and immutable record hash before serving a table. `pricing.changed` is emitted only after the pointer transaction commits. `pricing.admin.status.get` also returns, next to each held candidate, the record currently serving for that pricing key (if any) so an operator can compare the active hash/evidence/parser version against the new held candidate without a second lookup.

After each import, the service prunes complete, superseded snapshot manifests and their records once they are both older than `MODEL_PRICING_SNAPSHOT_RETENTION_MS` and outside the `MODEL_PRICING_RETAINED_ACTIVATIONS` most recent activations; the current active snapshot is never pruned. Pruning cannot see whether a separate repository (billing) still references an older snapshot, so both settings should stay comfortably longer than any in-flight billing operation. A crash mid-import that writes records/holds but never commits a manifest leaves an orphaned, unpruned partial snapshot; detecting that case is a separate, not-yet-built gap.

`pricingctl` is the operator surface. It signs requests with `NATS_PRICING_OPERATOR_NKEY_SEED` and sends them under the operator NATS identity:

```
docker exec -e NATS_PRICING_OPERATOR_NKEY_SEED lixpi-model-pricing pnpm pricingctl status
docker exec -e NATS_PRICING_OPERATOR_NKEY_SEED lixpi-model-pricing pnpm pricingctl holds
docker exec -e NATS_PRICING_OPERATOR_NKEY_SEED lixpi-model-pricing pnpm pricingctl override propose '<command-json>'
docker exec -e NATS_PRICING_OPERATOR_NKEY_SEED lixpi-model-pricing pnpm pricingctl override approve '<command-json>'
docker exec -e NATS_PRICING_OPERATOR_NKEY_SEED lixpi-model-pricing pnpm pricingctl override reject '<command-json>'
```

The command JSON supplies the immutable target fields such as `commandId`, `pricingKey`, `expectedActiveSnapshotId`, `candidateHash`, `reason`, `changeReference`, `nonce`, and a `patch` for proposals; `approve`/`reject` instead supply `proposalEventId`, the exact proposal event (returned as `eventId` from the `propose` call) being resolved. The CLI adds timestamps, actor key id, action, and signature. The service accepts only fresh commands, verifies the configured public key and signature, requires approvals to use a different operator key than the proposal, binds `approve`/`reject` to that specific proposal event (not merely to any proposal sharing the same candidate hash, so a later unapproved re-proposal can never inherit an earlier approval), binds all events to the current held candidate hash, and records an idempotency index plus append-only event in `MODEL_PRICING_AUDIT`.
