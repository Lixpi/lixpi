# services/nex — NATS NEX execution-engine node

A Lixpi-owned [NATS NEX](https://github.com/synadia-io/nex) **node**: a process that connects to the existing NATS cluster as a client and runs Lixpi background workloads on the bus — no cloud-vendor function runtime (no Lambda/GCP/Azure).

- **Deployment & operation:** [`documentation/platform/deployment/NEX-EXECUTION-ENGINE.md`](../../documentation/platform/deployment/NEX-EXECUTION-ENGINE.md)
- **General NEX reference:** [`documentation/knowledge/NATS-NEX-EXECUTION-ENGINE-EXPLAINED.md`](../../documentation/knowledge/NATS-NEX-EXECUTION-ENGINE-EXPLAINED.md)

## What runs here

| Workload | Type / lifecycle | What it does |
|---|---|---|
| `file-conversion` | `native` / `service` | Active responder on `blob.processing.generateRenditions`. It runs heavy image/video/audio/document transcoding and probing (sharp/ffmpeg/libreoffice/poppler) off the API. Jobs read content-addressed originals from the organization Blob bucket and write immutable canonical, preview, thumbnail, poster, and representative-frame outputs without DynamoDB access. Connects as `svc:file-conversion` in AUTH using its own NKey seed to reach Object Store. ([`workloads/file-conversion`](./workloads/file-conversion)) |
| `character-fidelity` | `native` / `service` | Active responder for photographic Character Creator panel checks. It runs pinned OpenCV Zoo YuNet and SFace ONNX artifacts through single-threaded WASM, reads only validated organization-scoped transient objects, and returns detections plus scalar cosine similarity without embeddings. ([`workloads/character-fidelity`](./workloads/character-fidelity)) |
| `media-render` | `native` / `service` | Exports frozen media sequences to MP4 (H.264/AAC), WAV (PCM), or MP3. The Capability module compiles the graph; this workload verifies source Blob hashes, runs FFmpeg, probes and hashes the output, and returns an immutable Blob descriptor for API finalization. It connects as `svc:media-render` with its own NKey. ([`workloads/media-render`](./workloads/media-render)) |
| `system-reporter` | `native` / `service` | Trivial smoke-test workload (echoes uptime every 30 s). Deployed **manually** to prove the substrate. ([`workloads/system-reporter`](./workloads/system-reporter)) |

The model catalog is not here. [`services/ai-model-registry`](../ai-model-registry) owns it, including the per-model rule files, the provider fetch, the merge, and the DynamoDB write.

## How it works

The image uses an Alpine Node.js base and builds a static `nex` binary from the selected upstream release tag. [The version registry](../../dev-tools/versions-registry/README.md) supplies the base image, NATS Execution Engine, pnpm, and npm dependency versions. On start, [`entrypoint.sh`](./entrypoint.sh):

1. `pnpm install` — resolves the workload's `@lixpi/*` + provider-SDK deps from the pnpm workspace (mirrors `services/api`).
2. `nex node up` connects with the NEX nkey; the embedded broker's auth worker verifies the raw NKey challenge response and issues a NATS user JWT for the `NEX` account. The node starts the bundled **native nexlet** and mints the same NEX nkey for the nexlet/workloads (`--issuer-nkey`). Runs in the background.
3. Deploys service workloads via `nex workload start`, injecting the runtime env into each start-request. The native nexlet does not inherit the container env. Both workloads receive `NATS_SERVERS`, `HOME`, and `PATH`. File conversion receives `NATS_FILE_CONVERSION_NKEY_SEED`; character fidelity receives `NATS_CHARACTER_FIDELITY_NKEY_SEED`. Each workload receives only its own service seed.
4. Supervises the node in the foreground.

State is intentionally **not** persisted (`--state kv` omitted): the entrypoint re-deploys the workloads on every boot (idempotent), so there is exactly one instance of each per node and no orphaned KV buckets. See the proposal's "Re-evaluation notes" for the full rationale.

With `ACCOUNT_ADMISSION_ENABLED=true`, conversion and fidelity requests must carry the account context created by the API after authentication. The workers ask the private API policy to recheck the original identity, epoch and token expiry before starting work, accessing object storage, or starting a subprocess. Policy leases last at most 30 seconds and renew during work. Account changes and connection loss abort active jobs; subprocesses receive `SIGKILL`. Native image or ONNX calls can finish internally after cancellation, but their late results cannot proceed to storage or replies. Queued rendition retries retain the original epoch and expiry.

## Run it locally

The commands below assume `.env` is symlinked to your `.env.<stage>` file via `./set-env.sh` at the repo root (Docker Compose only auto-loads a file literally named `.env`) — run it once, or add `--env-file .env.<stage>` to each command instead.

```bash
docker compose --profile main up        # brings up NATS x3, then lixpi-nex-1
docker compose --profile main up -d --build lixpi-nex-1   # rebuild just this node
docker logs -f lixpi-nex-1              # node + workload startup output
```

Required env (supplied by [`docker-compose.nex.yml`](../../docker-compose.nex.yml) from `.env.<stage>`): `NATS_SERVERS`, `NATS_NEX_NODE_NKEY_PUBLIC`, `NATS_NEX_NODE_NKEY_SEED`, `NATS_FILE_CONVERSION_NKEY_SEED`, `NATS_CHARACTER_FIDELITY_NKEY_SEED`, `ORG_NAME`, `STAGE`, `AWS_REGION`, `AWS_PROFILE`, `DYNAMODB_ENDPOINT`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`. Optional: `LIXPI_SYNC_INTERVAL_MS` (default `3600000`), `LIXPI_NODE_TAGS` (default `app=lixpi`; `KEY=VALUE` pairs separated by `;`).

Credential ownership matters:

- `NATS_NEX_NODE_NKEY_SEED` is secret and belongs only in this NEX container.
- `NATS_NEX_NODE_NKEY_PUBLIC` is used here as the public half of the native NATS NKey credential and in `services/nats` as verification material for auth callout.
- The NATS server config also lists the NEX public key so the server advertises the nonce required by native NKey auth. That static entry is not the final authorization decision; the embedded worker verifies the raw NKey challenge response and NATS enforces the returned `NEX` account user JWT.

Each workload receives its own seed through the entrypoint's start-request environment. Character fidelity uses `svc:character-fidelity` in AUTH with object-read grants. Compose waits for embedded broker admission readiness, so node authentication does not depend on API health. The `nex` test domain includes opt-in application admission and workload checks; commands and required environment are in the [TypeScript testing guide](../../documentation/code-quality/testing/TYPESCRIPT.md).

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

## Media exports

The `media-sequence` module publishes its render compiler through the Capability catalog. The worker accepts a frozen sequence, preset, job ID and attempt number. It has no workspace or DynamoDB write authority; the API owns durable dispatch, retries and the output Asset commit. Repeated active requests share their result, and changed attempts or inputs are rejected. Cancellation matches the organization, job and attempt, kills the encoder process group, waits for process exit and removes temporary files. Account-policy cancellation uses the same path, and output publication checks the active account again.

Readiness checks the installed encoders, drawtext filter and bundled DejaVu fonts. MP4 requires libx264 and AAC; WAV requires PCM signed 16-bit; MP3 requires libmp3lame. The compiler uses validated numeric expressions, literal text files, fixed font paths and allowlisted media demuxers. Inputs are local, content-addressed Blob bytes; remote URLs, playlists and caller-provided filters or filesystem paths are rejected.

`MEDIA_RENDER_MAX_DURATION_SECONDS`, `MEDIA_RENDER_MAX_PIXELS`, `MEDIA_RENDER_MAX_FPS`, `MEDIA_RENDER_MAX_CONCURRENT_JOBS`, `MEDIA_RENDER_TEMP_LIMIT_BYTES` and `MEDIA_RENDER_TIMEOUT_SECONDS` bound admission and execution. Disk estimates are checked before source downloads, temporary usage is monitored during work, and the subprocess has address-space, CPU and output-file limits through `prlimit`. Progress reports decode, compose, encode and finalize phases; encoded duration comes from FFmpeg. The output must pass codec, duration, dimensions, sample-rate and channel checks before storage.

The API stores an immutable render manifest, pins source Blob references, and dispatches through a separate JetStream work queue. The manifest is limited to 512 KiB and 24 source entries. Readiness includes a 512 MiB buffer limit per source and output because the storage adapter transfers whole byte arrays; the compiler rejects outputs whose bitrate allowance exceeds it. Finalization checks the attempt and current source access, then commits one stable Asset ID with the completion receipt. Export provenance retains sequence revision, source hashes, preset and attempt. Asset deletion releases the retained sources and render payload with the job records.

The private source-probe request reads the same authorized, hash-verified Blob binding. It reports duration, dimensions and channel metadata and decodes audio into 512 peak bins. The worker applies the buffer, process and duration limits before returning peaks. Object Store reads enforce the frozen byte limit while receiving data and cancel their exact temporary consumer on job cancellation, account revocation, shutdown, or the probe's 90-second deadline. The API owns access checks and cache lifetime.

The API persists private render progress only while the matching attempt owns a live lease. It rechecks account and source access before each update and ignores regressive phases or processed durations. The editor reads the durable status and cancels its own export through the existing sequence render endpoint. Terminal job receipts remain available for idempotency; cancelling releases the frozen input references and fences late output publication. FFprobe verifies the requested rational frame rate as well as codecs, dimensions, duration and audio format. The API compares the completion receipt with the frozen export settings before finalization. Readiness rechecks temporary disk availability and disables presets when the filesystem cannot accept work.

The entrypoint passes `NATS_MEDIA_RENDER_NKEY_SEED` and the render limits into the native workload. Environment setup generates the dedicated key pair. Run the FFmpeg fixture tests through the documented test runner:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner shared capability-system src/capabilities/media-sequence/backend/render/sequence-render-compiler.runtime.test.ts
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner nex workloads/media-render/media-render-worker.runtime.test.ts
```

## Adding a workload

Add `workloads/<name>/` with a thin entrypoint wrapper + a `Nexfile`, declare any new deps in `package.json`, and point the entrypoint deploy at it (or deploy it manually). Heavy Node workloads run `native` (as `file-conversion` does); see the proposal for the `job`/`function` tradeoffs.

Private repos should not bake private binaries into this public image. For local Docker, put native executable artifacts in the shared Docker volume `lixpi-nex-workloads`, which this node mounts read-only at `/opt/nex/private-workloads`, then deploy a Nexfile with a `file://` URI pointing at that path. This avoids the NEX 0.4.1 `nats://` Object Store artifact fetch credential mismatch in the current `--issuer-nkey` + centralized auth-callout setup.

## On AWS

Provisioned by Pulumi as an internal-only Fargate service (no public IP / no Route53), `desiredCount: 1`, with a task role granting DynamoDB access to `AI_MODELS_LIST`. The node connects to the cluster over CloudMap; if `:4222` terminates TLS there, set `NATS_TLS_CA_FILE` (+ `NATS_TLS_FIRST=true`) and use `tls://` URLs in `NATS_SERVERS` (the entrypoint adds the CA flags).
