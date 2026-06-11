#!/bin/sh
# Entrypoint for the Lixpi NATS NEX execution-engine node.
#
# Brings up a `nex` node (NEX account, bundled native nexlet) connected to the
# existing NATS cluster, installs the workload's Node dependencies, then deploys
# the Lixpi workload and supervises the node in the foreground.
#
# Connection details and the node nkey are passed as flags so nothing secret is
# baked into the image or config.json.

set -e

echo "=== NEX Node Entrypoint ==="
echo "Current time: $(date)"
echo "Hostname: $(hostname)"
echo "nex version: $(nex --version 2>/dev/null || echo 'unknown')"

# Debug: show only the env we care about (the nkey SEED is intentionally excluded).
echo "=== Environment (filtered) ==="
env | grep -E "^(AWS_REGION|AWS_PROFILE|NATS_SERVERS|NATS_JS_DOMAIN|NATS_TLS_|NEX_|LIXPI_|ORG_NAME|STAGE|ENVIRONMENT|DYNAMODB_ENDPOINT)=" | sort || true

# --- Required configuration ---------------------------------------------------
: "${NATS_SERVERS:?NATS_SERVERS is required (e.g. nats://lixpi-nats-1:4222,nats://lixpi-nats-2:4222)}"
: "${NATS_NEX_NODE_NKEY_PUBLIC:?NATS_NEX_NODE_NKEY_PUBLIC is required}"
: "${NATS_NEX_NODE_NKEY_SEED:?NATS_NEX_NODE_NKEY_SEED is required}"

# --- Defaults -----------------------------------------------------------------
NEX_NAMESPACE="${NEX_NAMESPACE:-system}"                         # node admin namespace
LIXPI_WORKLOAD_NAMESPACE="${LIXPI_WORKLOAD_NAMESPACE:-lixpi}"    # workload namespace
NEX_NODE_NAME="${NEX_NODE_NAME:-lixpi-nex-$(hostname)}"
NATS_JS_DOMAIN="${NATS_JS_DOMAIN:-lixpi}"                        # nats-server.conf -> jetstream.domain
SERVICE_DIR="${SERVICE_DIR:-/usr/src/service}"
WORKLOAD_NAME="${LIXPI_WORKLOAD_NAME:-ai-models-sync}"
WORKLOAD_ENTRY="${LIXPI_WORKLOAD_ENTRY:-${SERVICE_DIR}/workloads/ai-models-synchronization/index.ts}"

# --- Optional TLS to the cluster ----------------------------------------------
# Locally the client port (4222) is PLAIN nats:// (no top-level tls block in
# nats-server.conf), so no CA is required and NATS_SERVERS uses nats:// URLs.
# On AWS the cluster terminates real TLS on 4222 — set NATS_TLS_CA_FILE (and
# optionally NATS_TLS_FIRST=true) and use tls:// URLs in NATS_SERVERS.
TLS_FLAGS=""
if [ -n "${NATS_TLS_CA_FILE:-}" ]; then
    TLS_FLAGS="${TLS_FLAGS} --nats.tlsca ${NATS_TLS_CA_FILE}"
fi
if [ "${NATS_TLS_FIRST:-false}" = "true" ]; then
    TLS_FLAGS="${TLS_FLAGS} --nats.tlsfirst"
fi

# --- Install the workload's Node dependencies ---------------------------------
# Mirrors lixpi-api: @lixpi/* packages are bind-mounted; resolve them with pnpm
# against the baked pnpm-workspace.yaml so the native nexlet can later launch the
# workload as `node ... index.ts` and have its imports resolve from node_modules.
if [ -f "${SERVICE_DIR}/package.json" ]; then
    echo "=== Installing workload dependencies (pnpm) ==="
    ( cd "${SERVICE_DIR}" && pnpm install --prefer-offline ) \
        || echo "WARN: pnpm install failed; falling back to baked node_modules"
fi

echo "=== Starting NEX node '${NEX_NODE_NAME}' (namespace=${NEX_NAMESPACE}, jsdomain=${NATS_JS_DOMAIN}) ==="
echo "Connecting to: ${NATS_SERVERS}"

# Start the node + bundled native nexlet in the BACKGROUND so the entrypoint can
# deploy the workload once the node is accepting auctions, then supervise it.
#
# NKey auth needs BOTH the public nkey and its seed (cmd/nex/nats.go:
#   nats.Nkey(NatsUserNkey, sign-with(NatsUserSeed))).
#
# --issuer-nkey/--issuer-nkey-seed make the node mint the NEX-account nkey for
# the native nexlet and for workloads (NkeyMinter). This is REQUIRED here: our
# NEX account requires nkey auth, so the default FullAccessMinter (which hands
# out empty creds) would fail the native nexlet's registration connection.
#
# State is intentionally NOT persisted (--state kv omitted): the entrypoint
# re-deploys the workload on every boot (idempotent), which would double-run the
# workload if KV also replayed it — and a random per-boot node id would leak a
# new KV bucket each restart.
nex \
    --namespace "${NEX_NAMESPACE}" \
    node up \
    --nats.servers "${NATS_SERVERS}" \
    --nats.nkey "${NATS_NEX_NODE_NKEY_PUBLIC}" \
    --nats.seed "${NATS_NEX_NODE_NKEY_SEED}" \
    --nats.jsdomain "${NATS_JS_DOMAIN}" \
    --node-name "${NEX_NODE_NAME}" \
    --events nats \
    --tags app=lixpi \
    --issuer-nkey "${NATS_NEX_NODE_NKEY_PUBLIC}" \
    --issuer-nkey-seed "${NATS_NEX_NODE_NKEY_SEED}" \
    ${TLS_FLAGS} &
NODE_PID=$!

# Forward termination to the node for a clean shutdown (compose stop_signal=SIGTERM).
trap 'echo "Stopping NEX node..."; kill -TERM "$NODE_PID" 2>/dev/null' TERM INT

# Build the workload start-request, injecting the env the child needs. The native
# nexlet does NOT inherit the container env (agents/native/state.go sets cmd.Env
# to ONLY start_request.environment + NEX_WORKLOAD_* creds), so the workload's
# ORG_NAME/STAGE/AWS/DynamoDB/provider config MUST be passed in here. Node builds
# the JSON so values are escaped safely.
build_start_request() {
    node -e '
        const e = process.env
        const entry = process.argv[1]
        const keys = [
            "ORG_NAME", "STAGE", "ENVIRONMENT",
            "AWS_REGION", "AWS_PROFILE",
            "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
            "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_CREDENTIALS_FULL_URI",
            "DYNAMODB_ENDPOINT",
            "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY",
            "STABLE_DIFFUSION_API_KEY", "ARK_API_KEY",
            "LIXPI_SYNC_INTERVAL_MS",
        ]
        const environment = {
            HOME: e.HOME || "/root",
            PATH: e.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        }
        for (const k of keys) if (e[k]) environment[k] = e[k]
        if (!environment.LIXPI_SYNC_INTERVAL_MS) environment.LIXPI_SYNC_INTERVAL_MS = "3600000"
        process.stdout.write(JSON.stringify({
            uri: "file:///usr/local/bin/node",
            argv: ["--experimental-transform-types", "--disable-warning=ExperimentalWarning", entry],
            environment,
        }))
    ' "${WORKLOAD_ENTRY}"
}

if [ -f "${WORKLOAD_ENTRY}" ]; then
    echo "=== Deploying workload '${WORKLOAD_NAME}' (namespace=${LIXPI_WORKLOAD_NAMESPACE}) ==="
    START_REQUEST="$(build_start_request)"
    i=0
    deployed=0
    while [ "$i" -lt 30 ]; do
        i=$((i + 1))
        if nex --namespace "${LIXPI_WORKLOAD_NAMESPACE}" workload start \
            --type native --lifecycle service --name "${WORKLOAD_NAME}" \
            --start-request "${START_REQUEST}"; then
            echo "✅ Workload '${WORKLOAD_NAME}' deployed"
            deployed=1
            break
        fi
        echo "... node not ready yet (attempt ${i}); retrying in 2s"
        sleep 2
    done
    [ "$deployed" = "1" ] || echo "WARN: workload deploy did not succeed after retries; node stays up"
else
    echo "No workload entry at ${WORKLOAD_ENTRY}; starting node only (no workload deploy)"
fi

# Supervise the node in the foreground; exits when the node exits or on signal.
wait "$NODE_PID"
