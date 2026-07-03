#!/bin/bash

# Points the .env symlink at a chosen .env.* file, so Docker Compose (which
# only auto-loads a file literally named .env) picks it up without needing
# --env-file passed explicitly. Run from the repo root: ./set-env.sh
#
# Safe to run repeatedly: if .env already exists as a symlink (created by
# a previous run of this script), it's replaced with no conflict. If .env
# exists as a real file (not a symlink), this refuses to touch it — that's
# not something this script created, so it won't silently clobber it.

source ./scripts/partials/select-env-file.sh

if ! lixpi_select_env_file; then
    exit 1
fi

echo ""
echo "Using: $selected_env"
echo ""

if [ -e ".env" ] && [ ! -L ".env" ]; then
    echo ".env already exists and is not a symlink created by this script."
    echo "Remove or rename it manually, then re-run this script."
    exit 1
fi

ln -sf "$selected_env" .env

echo ".env -> $selected_env"
