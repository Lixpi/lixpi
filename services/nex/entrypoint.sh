#!/bin/sh
# Entrypoint for the Lixpi NATS NEX execution-engine node.
#
# Brings up a `nex` node that connects to the existing NATS cluster as a client
# in the dedicated NEX account and starts the bundled native nexlet. Later phases
# extend this script to deploy Lixpi workloads (the AI-models sync) after the
# node is up. Connection details and the node nkey are passed as flags so nothing
# secret is baked into the image or config.json.

set -e

echo "=== NEX Node Entrypoint ==="
echo "Current time: $(date)"
echo "Hostname: $(hostname)"
echo "nex version: $(nex --version 2>/dev/null || echo 'unknown')"

# Debug: show only the env we care about (the nkey SEED is intentionally excluded).
echo "=== Environment (filtered) ==="
env | grep -E "^(AWS_|NATS_SERVERS|NATS_JS_DOMAIN|NATS_TLS_|NEX_|LIXPI_|ORG_NAME|STAGE|ENVIRONMENT)=" | sort || true

# --- Required configuration ---------------------------------------------------
: "${NATS_SERVERS:?NATS_SERVERS is required (e.g. nats://lixpi-nats-1:4222,nats://lixpi-nats-2:4222)}"
: "${NATS_NEX_NODE_NKEY_PUBLIC:?NATS_NEX_NODE_NKEY_PUBLIC is required}"
: "${NATS_NEX_NODE_NKEY_SEED:?NATS_NEX_NODE_NKEY_SEED is required}"

# --- Defaults -----------------------------------------------------------------
NEX_NAMESPACE="${NEX_NAMESPACE:-system}"
NEX_NODE_NAME="${NEX_NODE_NAME:-lixpi-nex-$(hostname)}"
# JetStream domain the cluster runs under (nats-server.conf -> jetstream.domain).
NATS_JS_DOMAIN="${NATS_JS_DOMAIN:-lixpi}"

# --- Optional TLS to the cluster ----------------------------------------------
# Locally the client port (4222) is PLAIN nats:// (no TLS), so no CA is required
# and NATS_SERVERS uses nats:// URLs. On AWS the cluster terminates real TLS on
# 4222 — set NATS_TLS_CA_FILE (and optionally NATS_TLS_FIRST=true) and use tls://
# URLs in NATS_SERVERS.
TLS_FLAGS=""
if [ -n "${NATS_TLS_CA_FILE:-}" ]; then
    TLS_FLAGS="${TLS_FLAGS} --nats.tlsca ${NATS_TLS_CA_FILE}"
fi
if [ "${NATS_TLS_FIRST:-false}" = "true" ]; then
    TLS_FLAGS="${TLS_FLAGS} --nats.tlsfirst"
fi

echo "=== Starting NEX node '${NEX_NODE_NAME}' (namespace=${NEX_NAMESPACE}, jsdomain=${NATS_JS_DOMAIN}) ==="
echo "Connecting to: ${NATS_SERVERS}"

# `nex node up` runs the node + bundled native nexlet in the foreground.
# NKey auth requires BOTH the public nkey and its seed (see synadia-io/nex
# cmd/nex/nats.go: nats.Nkey(NatsUserNkey, sign-with(NatsUserSeed))).
# --state kv persists workload assignments in the per-node KV bucket so they
# survive a node restart; --events nats emits lifecycle events on $NEX.FEED.
exec nex \
    --namespace "${NEX_NAMESPACE}" \
    node up \
    --nats.servers "${NATS_SERVERS}" \
    --nats.nkey "${NATS_NEX_NODE_NKEY_PUBLIC}" \
    --nats.seed "${NATS_NEX_NODE_NKEY_SEED}" \
    --nats.jsdomain "${NATS_JS_DOMAIN}" \
    --node-name "${NEX_NODE_NAME}" \
    --state kv \
    --events nats \
    --tags app=lixpi \
    ${TLS_FLAGS}
