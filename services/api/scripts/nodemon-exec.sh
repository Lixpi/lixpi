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

node ./src/server.ts
code=$?

if [ "$code" -eq 0 ]; then
    exit 0
fi

if [ "$boot_run" -eq 1 ]; then
    echo "[nodemon-exec] startup failed with exit $code on the container's first run; exiting so Docker restarts the service" >&2
    exit "$code"
fi

echo "[nodemon-exec] app exited with $code after a reload; keeping nodemon alive so the next edit reloads it" >&2
exit 0
