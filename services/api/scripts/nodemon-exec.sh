#!/bin/sh
# nodemon's `exec` command for the API dev container (services/api/nodemon.json).
#
# It exists to answer one question: when `node ./src/server.ts` exits non-zero,
# should the container die so Docker's `restart: always` can restart it, or
# should nodemon stay alive and wait for the next edit?
#
# Both answers are right, just for different failures:
#
#   Boot run     The container has just started and nothing has been edited yet,
#                so a crash is a genuine startup failure: NATS unreachable, a bad
#                env var, a broken migration. Nobody is going to save a file to
#                fix it. Propagate the exit code. nodemon.json sets `exitcrash`,
#                so nodemon exits, the `sh -c` chain and workspace-package-sync.sh
#                (PID 1) exit after it, and Docker restarts the service.
#
#   After a
#   reload       nodemon restarted the app because a watched file changed, so a
#                crash is almost always the edit that was just saved. Exit 0
#                instead. nodemon reads that as a clean exit, prints "waiting for
#                changes before restart" and keeps watching, so saving the fix
#                reloads the app. Killing the container here would take the file
#                watcher down with it and put the dev in Docker's restart backoff,
#                which grows to a minute, for every typo.
#
# The marker file lives in /dev/shm because that is a tmpfs the container runtime
# recreates on every container start, including `docker restart`. /tmp would not
# work: it is part of the writable layer and survives a restart, so the marker
# would still be there on the next boot run and every startup failure would look
# like a post-reload crash.
#
# This is dev-only. The deployed image runs `pnpm run start` (plain node) and
# never loads nodemon or this script.

set -u

MARKER=/dev/shm/lixpi-api-nodemon-boot-run

if [ -f "$MARKER" ]; then
    boot_run=0
else
    boot_run=1
fi

touch "$MARKER"

# nodemon watches only the API's own sources and the restart file. Shared
# packages restart the API only when it actually loaded the edited file:
# record-loaded-modules.mjs lists every package file the API loads, and
# watch-loaded-modules.mjs touches the restart file when one of them changes.
# An edit to a file only the browser uses therefore never takes the API down.
node ./scripts/watch-loaded-modules.mjs &
watcher=$!
trap 'kill "$watcher" 2>/dev/null' EXIT

# Reserve argv space for the full admission consumer name in process.title.
# Docker inventory uses that immutable title to distinguish watched processes.
node --import ./scripts/record-loaded-modules.mjs ./src/server.ts --account-enforcement-process
code=$?

if [ "$code" -eq 0 ]; then
    exit 0
fi

if [ "$boot_run" -eq 1 ]; then
    echo "[nodemon-exec] startup failed with exit $code on the container's first run; exiting so Docker restarts the service" >&2
    exit "$code"
fi

# Keep watching the files the crashed run loaded, so fixing a shared package
# file reloads the API just like fixing one of its own sources does.
echo "[nodemon-exec] app exited with $code after a reload; keeping nodemon alive so the next edit reloads it" >&2
wait "$watcher"
exit 0
