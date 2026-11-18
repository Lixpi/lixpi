#!/usr/bin/env bash
# Creates one signing identity for local builds and reuses it across rebuilds.
# This runs only inside the desktop builder; it does not install a trusted CA.
set -euo pipefail
umask 077

identity_dir=/usr/src/signing
identity="${identity_dir}/local-development.pem"
mkdir -p "${identity_dir}"

if [[ -e "${identity}" ]]; then
    [[ -s "${identity}" ]] || { echo "The stored desktop signing identity is empty: ${identity}" >&2; exit 2; }
    exit 0
fi

temporary="$(mktemp -d "${identity_dir}/.identity.XXXXXX")"
trap 'rm -rf "${temporary}"' EXIT

echo "Creating a persistent local desktop signing identity in the Docker signing volume."
rcodesign generate-self-signed-certificate --person-name "Lixpi Local Development" --profile apple-development --validity-days 3650 --pem-unified-file "${temporary}/identity.pem" >/dev/null
[[ -s "${temporary}/identity.pem" ]] || { echo "The signing tool did not create the desktop identity." >&2; exit 2; }

# Linking is atomic and never replaces an identity another builder just created.
# Both files are in the same Docker volume, so the losing builder discards only
# its temporary identity and uses the one already installed.
if ! ln "${temporary}/identity.pem" "${identity}" 2>/dev/null; then
    [[ -s "${identity}" ]] || { echo "Could not store the desktop signing identity." >&2; exit 2; }
fi
