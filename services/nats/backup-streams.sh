#!/bin/sh
set -eu

: "${NATS_BACKUP_BUCKET:?NATS_BACKUP_BUCKET is required}"
: "${NATS_BACKUP_PREFIX:=jetstream}"
: "${NATS_URL:?NATS_URL is required}"
: "${NATS_SYS_USER:?NATS_SYS_USER is required}"
: "${NATS_SYS_PASSWORD:?NATS_SYS_PASSWORD is required}"

snapshot_id="$(date -u +%Y%m%dT%H%M%SZ)"
snapshot_dir="/tmp/nats-backup-${snapshot_id}"
mkdir -p "${snapshot_dir}"
inventory_file="${snapshot_dir}/inventory.jsonl"
: > "${inventory_file}"

nats --server "${NATS_URL}" --user "${NATS_SYS_USER}" --password "${NATS_SYS_PASSWORD}" request '$JS.API.STREAM.LIST' '{}' --raw \
    | jq -r '.streams[]?.config.name' \
    | while IFS= read -r stream_name; do
        [ -n "${stream_name}" ] || continue
        nats --server "${NATS_URL}" --user "${NATS_SYS_USER}" --password "${NATS_SYS_PASSWORD}" request "\$JS.API.STREAM.INFO.${stream_name}" '{}' --raw \
            | jq -c --arg snapshotId "${snapshot_id}" '{ snapshotId: $snapshotId, config: .config, state: .state }' \
            >> "${inventory_file}"
        mkdir -p "${snapshot_dir}/${stream_name}"
        nats --server "${NATS_URL}" --user "${NATS_SYS_USER}" --password "${NATS_SYS_PASSWORD}" stream backup --force "${stream_name}" "${snapshot_dir}/${stream_name}"
    done

aws s3 sync "${snapshot_dir}" "s3://${NATS_BACKUP_BUCKET}/${NATS_BACKUP_PREFIX}/${snapshot_id}/" --only-show-errors
printf '%s\n' "${snapshot_id}" \
    | aws s3 cp - "s3://${NATS_BACKUP_BUCKET}/${NATS_BACKUP_PREFIX}/LATEST" --only-show-errors
