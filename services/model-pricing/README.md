# Model Pricing Service

The model pricing service owns provider-cost snapshots. It runs in the dedicated `PRICING` NATS account and uses four DynamoDB tables for immutable snapshots, records, audit events, and reconciliation evidence.

The Phase 4 process validates its NATS identity and periodically stages non-serving candidate snapshots. It resolves one LiteLLM Git commit before downloading the rate feed from that exact commit, records its SHA-256 digest, scans catalog pricing references, and writes only complete manifests plus holds or verified records. It does not register pricing RPCs, write an active pointer, or publish `pricing.changed`; those remain Phase 5 work.

LiteLLM is discovery only. A candidate without a reviewed route-specific official-evidence adapter is recorded as a hold and cannot become a price record. This intentionally fail-closed baseline means deployments cannot accidentally bill from an upstream community feed.

## Configuration

| Variable | Purpose |
|---|---|
| `NATS_SERVERS` | Comma-separated NATS endpoints. |
| `NATS_PRICING_SERVICE_NKEY_SEED` | Service-owned NKey seed, injected from AWS Secrets Manager in ECS. |
| `AWS_REGION` | AWS region for DynamoDB. |
| `DYNAMODB_ENDPOINT` | Optional DynamoDB Local endpoint. |
| `AI_MODELS_LIST_TABLE_NAME` | Catalog source scanned for pricing references. |
| `MODEL_PRICING_SNAPSHOTS_TABLE` | Manifests and append-only holds. |
| `MODEL_PRICING_RECORDS_TABLE` | Immutable verified candidate records. |
| `MODEL_PRICING_AUDIT_TABLE` | Import-run audit entries. |
| `MODEL_PRICING_IMPORT_INTERVAL_MS` | Import interval; defaults to six hours and cannot be less than one minute. |

The service does not accept operator or billing credentials. Their public keys are registered by the API auth callout so Phase 5 and Phase 6 clients can authenticate to the `PRICING` account with narrow permissions.
