#!/bin/bash
# Wipes all cached state for lixpi-typescript-test-runner: the shared pnpm
# content store and every per-workspace node_modules volume (see
# docker compose.typescript-test-runner.yml, included from the root
# docker compose.yml, for how these are wired into the container).
#
# Use this when the cache itself is suspected to be the problem — e.g. a
# corrupted store, a stale node_modules link surviving a dependency
# rename/removal, or just wanting a clean-slate install to confirm a test
# failure isn't cache-related. Routine dependency changes don't need this:
# pnpm install already reconciles node_modules against the lockfile on every
# run, cache and all.
#
# How to use:
#   ./services/typescript-test-runner/nuke-cache.sh

set -e

volumes=$(docker volume ls -q --filter "name=lixpi_typescript-test-runner-")

if [ -z "$volumes" ]; then
    echo "No lixpi_typescript-test-runner-* volumes found — nothing to remove."
    exit 0
fi

echo "Removing volumes:"
echo "$volumes"
echo "$volumes" | xargs docker volume rm

echo "Done. Next lixpi-typescript-test-runner run will do a full pnpm install."
