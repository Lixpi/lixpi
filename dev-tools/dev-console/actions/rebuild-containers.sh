#!/usr/bin/env bash
#
# Clean rebuild behind the console's "Rebuild" choice. start-services.sh calls it with
# the same LIXPI_CONSOLE_* values before starting the services:
#
#   rebuild-containers.sh <service...>

set -euo pipefail

COMPOSE=(docker compose -f "${LIXPI_CONSOLE_OPTION_COMPOSE_FILE:?The console config must set compose-file}")
if [[ -n "${LIXPI_CONSOLE_ENV_FILE:-}" ]]; then
    COMPOSE+=(--env-file "${LIXPI_CONSOLE_ENV_FILE}")
fi
if [[ -n "${LIXPI_CONSOLE_OPTION_PROFILE:-}" ]]; then
    COMPOSE+=(--profile "${LIXPI_CONSOLE_OPTION_PROFILE}")
fi

echo "Stopping and removing containers: $*"
"${COMPOSE[@]}" down "$@"

echo "Rebuilding without cache: $*"
"${COMPOSE[@]}" --progress plain build --no-cache "$@"

# The new build takes over each image's tag, which leaves the previous image
# dangling. Another project's container can still hold one, so a failed removal
# isn't fatal.
echo "Removing dangling images..."
DANGLING_IMAGES="$(docker images -q -f dangling=true)"
if [[ -n "${DANGLING_IMAGES}" ]]; then
    # shellcheck disable=SC2086 # One argument per image ID.
    docker rmi ${DANGLING_IMAGES} >/dev/null 2>&1 || true
fi
