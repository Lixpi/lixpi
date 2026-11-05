#!/usr/bin/env bash
#
# Runs Lixpi's Pulumi service for the console. The service reports its own commands and
# deployment target through `catalog`, so this script names no command.
#
#   LIXPI_CONSOLE_QUERY=catalog pulumi.sh
#   pulumi.sh <command> [argument...]

set -euo pipefail

[[ -n "${LIXPI_CONSOLE_ENV_FILE:-}" ]] || { echo "Choose an environment file in ./run.sh." >&2; exit 1; }

COMPOSE=(docker compose -f infrastructure/docker/docker-compose.yml --env-file "${LIXPI_CONSOLE_ENV_FILE}" --profile deploy --progress quiet)
RUN=("${COMPOSE[@]}" run --rm --no-deps -w /usr/src/service/infrastructure/pulumi)

if [[ "${LIXPI_CONSOLE_QUERY:-}" == "catalog" ]]; then
    exec "${RUN[@]}" -T lixpi-pulumi -lc 'pnpm --silent run cli catalog'
fi

[[ "${1:-}" =~ ^[a-z][a-z0-9-]*$ ]] || { echo "Unknown Pulumi command." >&2; exit 2; }

exec "${RUN[@]}" lixpi-pulumi -lc 'pnpm run cli "$@"' pulumi "$@"
