#!/bin/bash

# Run from the repo root: ./start.sh

source ./scripts/partials/select-env-file.sh

if ! lixpi_select_env_file; then
    exit 1
fi

echo ""
echo "Using: $selected_env"
echo ""

# Start the application
echo "Starting application..."
docker compose --env-file "$selected_env" --profile main up
