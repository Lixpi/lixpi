#!/bin/sh
set -eu

: "${NATS_BACKUP_BUCKET:?NATS_BACKUP_BUCKET is required}"
: "${NATS_BACKUP_PREFIX:=jetstream}"
: "${NATS_URL:?NATS_URL is required}"
: "${NATS_SYS_USER:?NATS_SYS_USER is required}"
: "${NATS_SYS_PASSWORD:?NATS_SYS_PASSWORD is required}"

snapshot_id="${1:-}"
if [ -z "${snapshot_id}" ]; then
    snapshot_id="$(aws s3 cp "s3://${NATS_BACKUP_BUCKET}/${NATS_BACKUP_PREFIX}/LATEST" - --only-show-errors)"
fi
[ -n "${snapshot_id}" ] || { printf '%s\n' 'No NATS snapshot selected' >&2; exit 1; }

restore_dir="/tmp/nats-restore-${snapshot_id}"
mkdir -p "${restore_dir}"
aws s3 sync "s3://${NATS_BACKUP_BUCKET}/${NATS_BACKUP_PREFIX}/${snapshot_id}/" "${restore_dir}" --only-show-errors

find "${restore_dir}" -mindepth 1 -maxdepth 1 -type d -print \
    | sort \
    | while IFS= read -r stream_dir; do
        nats --server "${NATS_URL}" --user "${NATS_SYS_USER}" --password "${NATS_SYS_PASSWORD}" stream restore "${stream_dir}"
    done

inventory_file="${restore_dir}/inventory.jsonl"
if [ -f "${inventory_file}" ]; then
    jq -r '.config.name' "${inventory_file}" \
        | while IFS= read -r stream_name; do
            [ -n "${stream_name}" ] || continue
            expected_messages="$(jq -r --arg name "${stream_name}" 'select(.config.name == $name) | .state.messages' "${inventory_file}")"
            expected_last_sequence="$(jq -r --arg name "${stream_name}" 'select(.config.name == $name) | .state.last_seq' "${inventory_file}")"
            restored_info="$(nats --server "${NATS_URL}" --user "${NATS_SYS_USER}" --password "${NATS_SYS_PASSWORD}" request "\$JS.API.STREAM.INFO.${stream_name}" '{}' --raw)"
            restored_messages="$(printf '%s' "${restored_info}" | jq -r '.state.messages')"
            restored_last_sequence="$(printf '%s' "${restored_info}" | jq -r '.state.last_seq')"
            if [ "${restored_messages}" != "${expected_messages}" ] \
                || [ "${restored_last_sequence}" != "${expected_last_sequence}" ]; then
                printf '%s\n' "Restored stream ${stream_name} does not match its backup inventory" >&2
                exit 1
            fi
        done
fi
