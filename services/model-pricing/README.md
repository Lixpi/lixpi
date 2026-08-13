# Model Pricing Service

The model pricing service owns provider-cost snapshots. It runs in the dedicated `PRICING` NATS account and uses four DynamoDB tables for immutable snapshots, records, audit events, and reconciliation evidence.

The Phase 2 process validates its NATS identity by connecting with the pricing service NKey. It exposes no RPC subjects and does not read or write any pricing data. Later phases add candidate imports, verification, activation, and read endpoints without changing the service identity or storage boundary.

## Configuration

| Variable | Purpose |
|---|---|
| `NATS_SERVERS` | Comma-separated NATS endpoints. |
| `NATS_PRICING_SERVICE_NKEY_SEED` | Service-owned NKey seed, injected from AWS Secrets Manager in ECS. |

The service does not accept operator or billing credentials. Their public keys are registered by the API auth callout so Phase 5 and Phase 6 clients can authenticate to the `PRICING` account with narrow permissions.
