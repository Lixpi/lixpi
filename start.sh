#!/bin/bash

# Find all .env files in the current directory
env_files=($(ls -1 .env.* 2>/dev/null))

if [ ${#env_files[@]} -eq 0 ]; then
    echo "No .env files found in the current directory."
    echo "Run the setup wizard first to create one."
    exit 1
fi

echo "Available environment files:"
for i in "${!env_files[@]}"; do
    echo "  $((i+1)). ${env_files[$i]}"
done
echo ""

# Ask user to select an env file
while true; do
    read -p "Select environment file [1-${#env_files[@]}]: " selection
    if [[ "$selection" =~ ^[0-9]+$ ]] && [ "$selection" -ge 1 ] && [ "$selection" -le ${#env_files[@]} ]; then
        break
    fi
    echo "Invalid selection. Please enter a number between 1 and ${#env_files[@]}."
done

selected_env="${env_files[$((selection-1))]}"
echo ""
echo "Using: $selected_env"
echo ""

# Start the application
echo "Starting application..."
docker-compose --env-file "$selected_env" --profile main up
