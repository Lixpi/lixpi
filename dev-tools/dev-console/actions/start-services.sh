#!/usr/bin/env bash
#
# Starts the services a repository's console selected. The console supplies:
#
#   LIXPI_CONSOLE_OPTION_COMPOSE_FILE   Compose file, relative to the repository
#   LIXPI_CONSOLE_OPTION_PROFILE        optional profile to activate
#   LIXPI_CONSOLE_ENV_FILE              optional environment file
#   LIXPI_CONSOLE_OPTION_REBUILD        true rebuilds the services first
#   LIXPI_CONSOLE_OPTION_UP_FLAGS       optional comma-separated flags for `up`
#   LIXPI_CONSOLE_OPTION_DETACH         true starts in the background, otherwise the
#                                       console stays attached to the logs
#   LIXPI_CONSOLE_OPTION_STARTED_URL    optional address to print once started
#
#   start-services.sh <service...>

set -euo pipefail

HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
[[ "$#" -gt 0 ]] || { echo "No services were selected." >&2; exit 1; }

COMPOSE=(docker compose -f "${LIXPI_CONSOLE_OPTION_COMPOSE_FILE:?The console config must set compose-file}")
if [[ -n "${LIXPI_CONSOLE_ENV_FILE:-}" ]]; then
    COMPOSE+=(--env-file "${LIXPI_CONSOLE_ENV_FILE}")
fi
if [[ -n "${LIXPI_CONSOLE_OPTION_PROFILE:-}" ]]; then
    COMPOSE+=(--profile "${LIXPI_CONSOLE_OPTION_PROFILE}")
fi

UP_FLAGS=()
if [[ -n "${LIXPI_CONSOLE_OPTION_UP_FLAGS:-}" ]]; then
    IFS=',' read -r -a UP_FLAGS <<< "${LIXPI_CONSOLE_OPTION_UP_FLAGS}"
fi

if [[ "${LIXPI_CONSOLE_OPTION_REBUILD:-false}" == "true" ]]; then
    bash "${HERE}/rebuild-containers.sh" "$@"
fi

# Compose's interactive menu would compete with the console for the terminal.
if [[ "${LIXPI_CONSOLE_OPTION_DETACH:-false}" != "true" ]]; then
    if [[ -n "${LIXPI_CONSOLE_OPTION_STARTED_URL:-}" ]]; then
        printf 'Starting at %s\n' "${LIXPI_CONSOLE_OPTION_STARTED_URL}"
    fi
    COMPOSE_MENU=false exec "${COMPOSE[@]}" up ${UP_FLAGS[@]+"${UP_FLAGS[@]}"} "$@"
fi

# With an address to print, wait until the services are ready so it works when shown.
DETACH_FLAGS=(-d)
if [[ -n "${LIXPI_CONSOLE_OPTION_STARTED_URL:-}" ]]; then
    DETACH_FLAGS=(--wait)
fi
COMPOSE_MENU=false "${COMPOSE[@]}" up "${DETACH_FLAGS[@]}" ${UP_FLAGS[@]+"${UP_FLAGS[@]}"} "$@"

if [[ -n "${LIXPI_CONSOLE_OPTION_STARTED_URL:-}" ]]; then
    printf 'Running at %s\n' "${LIXPI_CONSOLE_OPTION_STARTED_URL}"
fi
