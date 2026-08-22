# services/nex — NATS NEX execution-engine node

A Lixpi-owned [NATS NEX](https://github.com/synadia-io/nex) **node**: a process that connects to the existing NATS cluster as a client and runs Lixpi background workloads on the bus — no cloud-vendor function runtime (no Lambda/GCP/Azure).

- **Deployment & operation:** [`documentation/platform/deployment/NEX-EXECUTION-ENGINE.md`](../../documentation/platform/deployment/NEX-EXECUTION-ENGINE.md)
- **General NEX reference:** [`documentation/knowledge/NATS-NEX-EXECUTION-ENGINE-EXPLAINED.md`](../../documentation/knowledge/NATS-NEX-EXECUTION-ENGINE-EXPLAINED.md)

## What runs here

| Workload | Type / lifecycle | What it does |
|---|---|---|
| `ai-models-sync` | `native` / `service` | Runs `AiModelsSync.synchronizeModels()` at boot and **every hour**, writing the `AI_MODELS_LIST` DynamoDB table. ([`workloads/ai-models-synchronization`](./workloads/ai-models-synchronization)) |
| `file-conversion` | `native` / `service` | Active responder on `blob.processing.generateRenditions`. It runs heavy image/video/audio/document transcoding and probing (sharp/ffmpeg/libreoffice/poppler) off the API. Jobs read content-addressed originals from the organization Blob bucket and write immutable canonical, preview, thumbnail, poster, and representative-frame outputs without DynamoDB access. Connects as the AUTH-account `regular_user` to reach Object Store. ([`workloads/file-conversion`](./workloads/file-conversion)) |
| `character-fidelity` | `native` / `service` | Active responder for photographic Character Creator panel checks. It runs pinned OpenCV Zoo YuNet and SFace ONNX artifacts through single-threaded WASM, reads only validated organization-scoped transient objects, and returns detections plus scalar cosine similarity without embeddings. ([`workloads/character-fidelity`](./workloads/character-fidelity)) |
| `system-reporter` | `native` / `service` | Trivial smoke-test workload (echoes uptime every 30 s). Deployed **manually** to prove the substrate. ([`workloads/system-reporter`](./workloads/system-reporter)) |

`ai-models-sync` defines model-specific inference and media behavior. Every model record carries `inferenceCapabilities`, including temperature support, provider-native thinking mode, system-prompt support, structured-schema requirements, and accepted input kinds. Image-generation records also declare `imageReferenceCapabilities`: total and identity-reference limits, conditioning modes, fidelity behavior, iterative-edit and control support, maximum output pixels, and aspect ratios. Video-generation records publish only user-configurable model controls; negative prompting, moderation policy, output count, output format, and audio defaults remain in the generation pipeline. Synchronization rejects missing or inconsistent profiles. API routing and provider adapters consume these fields without matching model names. Anthropic models sourced from Bedrock retain dated vendor snapshot IDs and accept pinned, dateless catalog IDs such as `claude-sonnet-5`, so synchronized selections use the exact model identifiers Bedrock exposes.

## How it works

The image (`Dockerfile`) is a `node:23-alpine` base + the pinned static `nex` binary. On start, [`entrypoint.sh`](./entrypoint.sh):

1. `pnpm install` — resolves the workload's `@lixpi/*` + provider-SDK deps from the pnpm workspace (mirrors `services/api`).
2. `nex node up` — connects with the NEX nkey; the API auth callout verifies the raw NKey challenge response and issues a NATS user JWT for the `NEX` account. The node starts the bundled **native nexlet** and mints the same NEX nkey for the nexlet/workloads (`--issuer-nkey`). Runs in the background.
3. Deploys service workloads via `nex workload start`, **injecting** the runtime env into each start-request — the native nexlet does **not** inherit the container env. `ai-models-sync` receives `ORG_NAME`, `STAGE`, `AWS_*`, `DYNAMODB_ENDPOINT`, and provider keys. `file-conversion` and `character-fidelity` receive `NATS_SERVERS`, `NATS_REGULAR_USER_PASSWORD`, `HOME`, and `PATH`.
4. Supervises the node in the foreground.

State is intentionally **not** persisted (`--state kv` omitted): the entrypoint re-deploys the workload on every boot (idempotent), so there is exactly one workload instance per node and no orphaned KV buckets. See the proposal's "Re-evaluation notes" for the full rationale.

## Run it locally

The commands below assume `.env` is symlinked to your `.env.<stage>` file via `./set-env.sh` at the repo root (Docker Compose only auto-loads a file literally named `.env`) — run it once, or add `--env-file .env.<stage>` to each command instead.

```bash
docker compose --profile main up        # brings up NATS x3, then lixpi-nex-1
docker compose --profile main up -d --build lixpi-nex-1   # rebuild just this node
docker logs -f lixpi-nex-1              # node + workload startup output
```

Required env (supplied by `docker-compose.yml` from `.env.<stage>`): `NATS_SERVERS`, `NATS_NEX_NODE_NKEY_PUBLIC`, `NATS_NEX_NODE_NKEY_SEED`, `NATS_REGULAR_USER_PASSWORD`, `ORG_NAME`, `STAGE`, `AWS_REGION`, `AWS_PROFILE`, `DYNAMODB_ENDPOINT`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`. Optional: `LIXPI_SYNC_INTERVAL_MS` (default `3600000`).

Credential ownership matters:

- `NATS_NEX_NODE_NKEY_SEED` is secret and belongs only in this NEX container.
- `NATS_NEX_NODE_NKEY_PUBLIC` is used here as the public half of the native NATS NKey credential and in `services/api` as verification material for auth callout.
- The NATS server config also lists the NEX public key so the server advertises the nonce required by native NKey auth. That static entry is not the final authorization decision; the API auth callout verifies the raw NKey challenge response and NATS enforces the returned `NEX` account user JWT.

## Operate

The `nex` CLI needs the connection flags; the container already has them in env, so wrap calls in `sh -c` to expand them:

```bash
# list nodes / inspect the node + its agents
docker exec lixpi-nex-1 sh -c 'nex -s "$NATS_SERVERS" --nats.nkey "$NATS_NEX_NODE_NKEY_PUBLIC" --nats.seed "$NATS_NEX_NODE_NKEY_SEED" --namespace system node list'

# list deployed workloads (workloads run in the `lixpi` namespace)
docker exec lixpi-nex-1 sh -c 'nex -s "$NATS_SERVERS" --nats.nkey "$NATS_NEX_NODE_NKEY_PUBLIC" --nats.seed "$NATS_NEX_NODE_NKEY_SEED" --namespace lixpi workload list'

# deploy the smoke-test workload manually
docker exec lixpi-nex-1 sh -c 'nex -s "$NATS_SERVERS" --nats.nkey "$NATS_NEX_NODE_NKEY_PUBLIC" --nats.seed "$NATS_NEX_NODE_NKEY_SEED" --namespace lixpi workload start -f /usr/src/service/workloads/system-reporter/Nexfile'
```

Workload stdout/stderr stream on `$NEX.FEED.lixpi.logs.>` and lifecycle events on `$NEX.FEED.lixpi.event.>` **within the NEX account** (observe with any NATS subscriber holding the NEX nkey). The fastest local check that the real workload ran is the DynamoDB `AI_MODELS_LIST` table being (re)populated. To watch it run quickly, set `LIXPI_SYNC_INTERVAL_MS` to a small value and rebuild.

For the active rendition path, upload a file that needs conversion or probing. The API creates a processing Asset and requests `blob.processing.generateRenditions`; the workload reads the original Blob, validates tenant/hash coordinates, writes hash-addressed outputs, and returns the result through the requester's NATS reply inbox. The API validates returned objects before updating Asset renditions. The browser replaces its upload placeholder after Asset creation/attach and observes rendition state through Asset reload/events.

For Character fidelity, the API writes source crops and panel candidates to the organization transient-media bucket and sends only scoped coordinates. The workload validates organization, bucket, content length, MIME type, dimensions, and object-key shape before model execution. Artifacts are pinned by version, source URL, license, and SHA-256. Non-photographic, missing-face, and ambiguous-face cases return typed unavailable reasons. When several authorized source images are staged, sources with no detected face are excluded from embedding as long as at least one unambiguous source face remains; a missing face in one source cannot crash an otherwise usable comparison. Each request logs correlation IDs, source-medium and face-visibility admission, coordinate metadata, Object Store read timing and byte counts, model artifact verification and session I/O metadata, model readiness, per-source and candidate detection summaries, the source indexes used for embeddings, embedding count and vector dimensions, scalar similarity, terminal unavailable reasons, and bounded failures. Pixels and embedding values are never logged. The API enforces a request timeout, logs dispatch/result/failure diagnostics, and removes all transient objects at terminal cleanup.

## Adding a workload

Add `workloads/<name>/` with a thin entrypoint wrapper + a `Nexfile`, declare any new deps in `package.json`, and point the entrypoint deploy at it (or deploy it manually). Heavy Node workloads run `native` (as `ai-models-sync` does); see the proposal for the `job`/`function` tradeoffs.

Private repos should not bake private binaries into this public image. For local Docker, put native executable artifacts in the shared Docker volume `lixpi-nex-workloads`, which this node mounts read-only at `/opt/nex/private-workloads`, then deploy a Nexfile with a `file://` URI pointing at that path. This avoids the NEX 0.4.1 `nats://` Object Store artifact fetch credential mismatch in the current `--issuer-nkey` + centralized auth-callout setup.

## On AWS

Provisioned by Pulumi as an internal-only Fargate service (no public IP / no Route53), `desiredCount: 1`, with a task role granting DynamoDB access to `AI_MODELS_LIST`. The node connects to the cluster over CloudMap; if `:4222` terminates TLS there, set `NATS_TLS_CA_FILE` (+ `NATS_TLS_FIRST=true`) and use `tls://` URLs in `NATS_SERVERS` (the entrypoint adds the CA flags).
