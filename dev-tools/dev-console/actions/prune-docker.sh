#!/usr/bin/env bash
#
# Reclaims Docker disk space. The dev console calls it with the targets chosen in
# its menu, after asking for confirmation. Pruning covers the whole Docker host, so
# it also affects other projects on this machine:
#
#   prune-docker.sh <target...>

set -uo pipefail

FAILED=0

for selected in "$@"; do
    case "${selected}" in
        containers|images-dangling|images-unused|networks|volumes-anonymous|volumes-all|build-cache-dangling|build-cache-all|system|system-all|system-all-volumes) ;;
        *) echo "Unknown prune target: ${selected}" >&2; exit 2 ;;
    esac
done

prune() {
    printf '\nPruning %s...\n' "$1"
    shift
    "$@" || FAILED=1
}

# Containers go first, because a stopped container keeps its images, networks and
# volumes in use until it's removed.
for target in containers images-dangling images-unused networks volumes-anonymous volumes-all build-cache-dangling build-cache-all system system-all system-all-volumes; do
    for selected in "$@"; do
        [[ "${selected}" == "${target}" ]] || continue

        case "${target}" in
            containers) prune "stopped containers" docker container prune --force ;;
            images-dangling) prune "dangling images" docker image prune --force ;;
            images-unused) prune "all unused images" docker image prune --all --force ;;
            networks) prune "unused networks" docker network prune --force ;;
            volumes-anonymous) prune "unused anonymous volumes" docker volume prune --force ;;
            volumes-all) prune "all unused volumes" docker volume prune --all --force ;;
            build-cache-dangling) prune "dangling build cache" docker builder prune --force ;;
            build-cache-all) prune "all build cache" docker builder prune --all --force ;;
            system) prune "the system" docker system prune --force ;;
            system-all) prune "the system, all" docker system prune --all --force ;;
            system-all-volumes) prune "the system, all with volumes" docker system prune --all --volumes --force ;;
        esac
    done
done

printf '\n'
docker system df

exit "${FAILED}"
