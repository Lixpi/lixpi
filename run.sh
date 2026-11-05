#!/usr/bin/env bash
#
# The one entry point for this repository's developer workflows. It opens the shared
# dev console from dev-tools/dev-console, with this repository's console.config.json.

set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

[[ "$#" -eq 0 ]] || { echo "This console is interactive and does not accept arguments." >&2; exit 1; }

exec bash "${ROOT}/dev-tools/dev-console/run-console.sh" "${ROOT}"
