# Universal TypeScript test runner.
#
# Owns test execution for services/web-ui, services/api, services/nex, and the
# shared packages/lixpi packages. Each domain is bind-mounted (see
# docker-compose.typescript-test-runner.yml, included from the root
# docker-compose.yml) as its own isolated pnpm workspace root under
# /usr/src/service/<domain>, so this image ships no dependencies of its own —
# run-tests.sh installs each domain's deps on demand before running vitest.
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine

RUN npm install -g pnpm

WORKDIR /usr/src/service

# run-tests.sh is bind-mounted (docker-compose.typescript-test-runner.yml) so edits apply without a
# rebuild; bind mounts are attached before ENTRYPOINT runs, so this works
# without baking the script into the image. Bind mounts don't preserve the
# host exec bit, hence "sh <path>" rather than exec'ing it directly.
#
# One-shot per invocation: `docker compose run --rm lixpi-typescript-test-runner
# <domain> [args]` builds a fresh container per call (always reflects the
# current docker-compose.yml, unlike a long-lived container that can go stale
# after a compose file edit) and Compose auto-names each run uniquely, so
# concurrent invocations never collide.
ENTRYPOINT ["sh", "/usr/src/service/run-tests.sh"]
