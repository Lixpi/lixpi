#!/bin/sh
# Mirrors the read-only host bind mount of packages/lixpi into the container's own
# writable copy, so edits on the host reach a running service without a restart.
#
# Why the copy exists at all: the service's pnpm workspace needs to write a
# node_modules directory inside every workspace package. Bind-mounting the host
# tree directly over packages/lixpi would either make pnpm write node_modules back
# onto the host (unacceptable), or, mounted read-only, stop pnpm from installing at
# all. So the host tree is mounted read-only somewhere else and rsynced inward.
# node_modules is excluded from the sync, and rsync protects excluded paths from
# --delete, so the container's node_modules survives every pass.
#
# Modes:
#   sync            one pass, then exit
#   watch           re-sync every PACKAGE_SYNC_INTERVAL seconds, forever
#   run <cmd...>    one pass, start a watcher in the background, then exec <cmd>
#
# When HOST_PACKAGES_DIR is absent the script is a no-op (run still execs the
# command). That is the deployed image, where the packages are baked in and there
# is no host to sync from.

set -eu

HOST_PACKAGES_DIR="${HOST_PACKAGES_DIR:-/usr/src/host-packages/lixpi}"
SERVICE_PACKAGES_DIR="${SERVICE_PACKAGES_DIR:-/usr/src/service/packages/lixpi}"
PACKAGE_SYNC_INTERVAL="${PACKAGE_SYNC_INTERVAL:-1}"

log() {
    echo "[workspace-package-sync] $*" >&2
}

host_mount_present() {
    [ -d "$HOST_PACKAGES_DIR" ]
}

# -rlptD rather than -a: ownership is meaningless here (everything runs as root in
# the container) and copying it from the host mount only produces churn.
sync_once() {
    rsync -rlptD --delete \
        --exclude 'node_modules/' \
        --exclude '.DS_Store' \
        "$HOST_PACKAGES_DIR/" "$SERVICE_PACKAGES_DIR/"
}

# inotify does not fire across bind mounts on macOS or Windows, which is the whole
# reason vite and nodemon already poll here, so this polls too.
watch_forever() {
    while sleep "$PACKAGE_SYNC_INTERVAL"; do
        if ! sync_once; then
            log "sync failed"
            return 1
        fi
    done
}

# run mode supervises both children rather than letting a child signal PID 1.
# Killing the watcher directly does not run any code inside it, so the watcher
# cannot be relied on to report its own death.
supervise() {
    cmd_pid="$1"
    watch_pid="$2"

    trap 'kill -TERM "$cmd_pid" "$watch_pid" 2>/dev/null || true; exit 143' TERM INT

    while true; do
        if ! kill -0 "$cmd_pid" 2>/dev/null; then
            wait "$cmd_pid" || true
            code=$?
            kill -TERM "$watch_pid" 2>/dev/null || true
            log "service command exited with $code, stopping"
            return "$code"
        fi

        if ! kill -0 "$watch_pid" 2>/dev/null; then
            log "watcher died, stopping the container so hot reload does not fail silently"
            kill -TERM "$cmd_pid" 2>/dev/null || true
            wait "$cmd_pid" 2>/dev/null || true
            return 1
        fi

        sleep 1
    done
}

mode="${1:-run}"
[ $# -gt 0 ] && shift

case "$mode" in
    sync)
        if ! host_mount_present; then
            log "no host mount at $HOST_PACKAGES_DIR, nothing to sync"
            exit 0
        fi
        mkdir -p "$SERVICE_PACKAGES_DIR"
        sync_once
        log "synced $HOST_PACKAGES_DIR into $SERVICE_PACKAGES_DIR"
        ;;

    watch)
        if ! host_mount_present; then
            log "no host mount at $HOST_PACKAGES_DIR, not watching"
            exit 0
        fi
        log "watching $HOST_PACKAGES_DIR every ${PACKAGE_SYNC_INTERVAL}s"
        watch_forever
        log "watch loop exited"
        exit 1
        ;;

    run)
        if [ $# -eq 0 ]; then
            log "run needs a command to execute"
            exit 1
        fi

        if ! host_mount_present; then
            log "no host mount at $HOST_PACKAGES_DIR, running without sync"
            exec "$@"
        fi

        mkdir -p "$SERVICE_PACKAGES_DIR"
        sync_once
        log "synced $HOST_PACKAGES_DIR into $SERVICE_PACKAGES_DIR"

        "$0" watch &
        watch_pid=$!
        log "watcher started (pid $watch_pid)"

        "$@" &
        cmd_pid=$!

        supervise "$cmd_pid" "$watch_pid"
        exit $?
        ;;

    *)
        log "unknown mode '$mode', expected sync, watch or run"
        exit 1
        ;;
esac
