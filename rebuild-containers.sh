#!/bin/bash

# How to use:
# ./rebuild-containers.sh lixpi-nats-1 lixpi-nats-2 lixpi-nats-3

# Check if at least one container name is provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 <container1> [container2] [container3] ..."
    echo "Example: $0 lixpi-nats-1 lixpi-nats-2 lixpi-nats-3"
    exit 1
fi

# Extract the base image name from the first container (assuming pattern like 'lixpi-service-number')
FIRST_CONTAINER=$1
BASE_IMAGE=$(echo "$FIRST_CONTAINER" | sed 's/-[0-9]*$//' | sed 's/^lixpi-/lixpi\//')

echo "Processing containers: $@"
echo "Base image: $BASE_IMAGE"

# Step 1: Stop and remove all specified containers
echo "Stopping and removing containers..."
for container in "$@"; do
    echo "Processing container: $container"
    docker compose down "$container"
done

# Step 2: Remove the base image
echo "Removing image: $BASE_IMAGE"
docker images -q "$BASE_IMAGE" | xargs -r docker rmi

# Step 3: Remove dangling images
echo "Removing dangling images..."
docker images -q -f dangling=true | xargs -r docker rmi

# Step 4: Rebuild all containers with no cache
echo "Rebuilding containers..."
for container in "$@"; do
    echo "Building container: $container"
    docker compose build "$container" --no-cache --progress plain
done

echo "Process completed for all containers!"