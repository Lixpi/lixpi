# services/nex — NATS NEX execution-engine node

A Lixpi-owned [NATS NEX](https://github.com/synadia-io/nex) **node**: a process
that connects to the existing NATS cluster as a client and runs Lixpi background
workloads on the bus — no cloud-vendor function runtime (no Lambda/GCP/Azure).

- **Deployment & operation:** [`documentation/platform/deployment/NEX-EXECUTION-ENGINE.md`](../../documentation/platform/deployment/NEX-EXECUTION-ENGINE.md)
- **General NEX reference:** [`documentation/knowledge/NATS-NEX-EXECUTION-ENGINE-EXPLAINED.md`](../../documentation/knowledge/NATS-NEX-EXECUTION-ENGINE-EXPLAINED.md)

## What runs here

| Workload | Type / lifecycle | What it does |
|---|---|---|
| `ai-models-sync` | `native` / `service` | Runs `AiModelsSync.synchronizeModels()` at boot and **every hour**, writing the `AI_MODELS_LIST` DynamoDB table. ([`workloads/ai-models-synchronization`](./workloads/ai-models-synchronization)) |
| `system-reporter` | `native` / `service` | Trivial smoke-test workload (echoes uptime every 30 s). Deployed **manually** to prove the substrate. ([`workloads/system-reporter`](./workloads/system-reporter)) |

## How it works

The image (`Dockerfile`) is a `node:23-alpine` base + the pinned static `nex`
binary. On start, [`entrypoint.sh`](./entrypoint.sh):

1. `pnpm install` — resolves the workload's `@lixpi/*` + provider-SDK deps from
   the pnpm workspace (mirrors `services/api`).
2. `nex node up` — connects to the NATS `NEX` account (nkey auth), starts the
   bundled **native nexlet**, and mints the NEX nkey for the nexlet/workloads
   (`--issuer-nkey`). Runs in the background.
3. Deploys `ai-models-sync` via `nex workload start`, **injecting** the runtime
   env (`ORG_NAME`, `STAGE`, `AWS_*`, `DYNAMODB_ENDPOINT`, provider keys, …) into
   the start-request — the native nexlet does **not** inherit the container env.
4. Supervises the node in the foreground.

State is intentionally **not** persisted (`--state kv` omitted): the entrypoint
re-deploys the workload on every boot (idempotent), so there is exactly one
workload instance per node and no orphaned KV buckets. See the proposal's
"Re-evaluation notes" for the full rationale.

## Run it locally

```bash
docker compose --profile main up        # brings up NATS x3, then lixpi-nex-1
docker compose --profile main up -d --build lixpi-nex-1   # rebuild just this node
docker logs -f lixpi-nex-1              # node + workload startup output
```

Required env (supplied by `docker-compose.yml` from `.env.<stage>`):
`NATS_SERVERS`, `NATS_NEX_NODE_NKEY_PUBLIC`, `NATS_NEX_NODE_NKEY_SEED`,
`ORG_NAME`, `STAGE`, `AWS_REGION`, `AWS_PROFILE`, `DYNAMODB_ENDPOINT`,
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`. Optional:
`LIXPI_SYNC_INTERVAL_MS` (default `3600000`).

## Operate

The `nex` CLI needs the connection flags; the container already has them in env,
so wrap calls in `sh -c` to expand them:

```bash
# list nodes / inspect the node + its agents
docker exec lixpi-nex-1 sh -c 'nex -s "$NATS_SERVERS" --nats.nkey "$NATS_NEX_NODE_NKEY_PUBLIC" --nats.seed "$NATS_NEX_NODE_NKEY_SEED" --namespace system node list'

# list deployed workloads (workloads run in the `lixpi` namespace)
docker exec lixpi-nex-1 sh -c 'nex -s "$NATS_SERVERS" --nats.nkey "$NATS_NEX_NODE_NKEY_PUBLIC" --nats.seed "$NATS_NEX_NODE_NKEY_SEED" --namespace lixpi workload list'

# deploy the smoke-test workload manually
docker exec lixpi-nex-1 sh -c 'nex -s "$NATS_SERVERS" --nats.nkey "$NATS_NEX_NODE_NKEY_PUBLIC" --nats.seed "$NATS_NEX_NODE_NKEY_SEED" --namespace lixpi workload start -f /usr/src/service/workloads/system-reporter/Nexfile'
```

Workload stdout/stderr stream on `$NEX.FEED.lixpi.logs.>` and lifecycle events on
`$NEX.FEED.lixpi.event.>` **within the NEX account** (observe with any NATS
subscriber holding the NEX nkey). The fastest local check that the real workload
ran is the DynamoDB `AI_MODELS_LIST` table being (re)populated. To watch it run
quickly, set `LIXPI_SYNC_INTERVAL_MS` to a small value and rebuild.

## Adding a workload

Add `workloads/<name>/` with a thin entrypoint wrapper + a `Nexfile`, declare any
new deps in `package.json`, and point the entrypoint deploy at it (or deploy it
manually). Heavy Node workloads run `native` (as `ai-models-sync` does); see the
proposal for the `job`/`function` and Object-Store-artifact escalation paths.

## On AWS

Provisioned by Pulumi as an internal-only Fargate service (no public IP / no
Route53), `desiredCount: 1`, with a task role granting DynamoDB access to
`AI_MODELS_LIST`. The node connects to the cluster over CloudMap; if `:4222`
terminates TLS there, set `NATS_TLS_CA_FILE` (+ `NATS_TLS_FIRST=true`) and use
`tls://` URLs in `NATS_SERVERS` (the entrypoint adds the CA flags).
