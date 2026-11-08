#!/usr/bin/env bash
#
# Builds the macOS desktop app for the console's "Build the macOS desktop app"
# action. Everything runs in the lixpi-tauri-macos-builder container. The console
# supplies:
#
#   LIXPI_CONSOLE_ENV_FILE          environment file whose web-ui the app opens
#   LIXPI_CONSOLE_OPTION_TARGET     aarch64-apple-darwin or x86_64-apple-darwin
#   LIXPI_CONSOLE_OPTION_REBUILD    true rebuilds the builder image without cache
#   LIXPI_CONSOLE_OPTION_DIAGNOSTICS  true builds the app with diagnostics logging

set -euo pipefail

[[ -n "${LIXPI_CONSOLE_ENV_FILE:-}" ]] || { echo "Choose an environment file in ./run.sh." >&2; exit 1; }

# The builder shares the application's Compose project, so the running stack isn't orphaned.
export COMPOSE_IGNORE_ORPHANS=true
COMPOSE=(docker compose -f infrastructure/docker/utilities/desktop/docker-compose.tauri.yml --env-file "${LIXPI_CONSOLE_ENV_FILE}")

if [[ "${LIXPI_CONSOLE_OPTION_REBUILD:-false}" == "true" ]]; then
    "${COMPOSE[@]}" --progress plain build --no-cache lixpi-tauri-macos-builder
fi

LIXPI_DESKTOP_TARGET="${LIXPI_CONSOLE_OPTION_TARGET:-aarch64-apple-darwin}" LIXPI_DESKTOP_DIAGNOSTICS="${LIXPI_CONSOLE_OPTION_DIAGNOSTICS:-false}" "${COMPOSE[@]}" run --rm lixpi-tauri-macos-builder

echo "Open it with: open gui/tauri/dist/Lixpi.app"
