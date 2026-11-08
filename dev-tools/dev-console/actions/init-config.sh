#!/usr/bin/env bash
set -euo pipefail

HERE="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd -P)"
export LIXPI_REPOSITORY_PATH="${HERE}"
export LOCAL_UID="$(id -u)"
export LOCAL_GID="$(id -g)"

cd "${HERE}"
docker compose --progress quiet -f infrastructure/docker/utilities/setup/docker-compose.config-utils.yml --profile dev build lixpi-config-utils
if [ -t 0 ] && [ -t 1 ]; then
    exec docker compose -f infrastructure/docker/utilities/setup/docker-compose.config-utils.yml --profile dev run --rm --no-deps lixpi-config-utils "$@"
fi

exec docker compose -f infrastructure/docker/utilities/setup/docker-compose.config-utils.yml --profile dev run --rm --no-deps -T lixpi-config-utils "$@"
