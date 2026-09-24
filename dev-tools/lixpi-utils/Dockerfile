# Shared utility runner for skill scripts.
#
# Every skill under ${LIXPI_REPOSITORY_PATH}/skills/ that needs to execute code executes it here, never on the host. See
# ${LIXPI_REPOSITORY_PATH}/documentation/development-workflow/SKILL-EXECUTION-GUIDE.md. The canonical skills tree is bind-mounted at /skills
# (docker-compose.lixpi-utils.yml), so a script edit applies on the next run with no rebuild.
#
# The shared setup UI reuses the dependency manifest from dev-tools/config-utils so it renders
# with the same Clack and Chalk components as init-config. Skill scripts still ship their own
# dependencies instead of adding them to this image.
#
# Node 24 runs TypeScript directly through native type stripping, so skill scripts are .ts files with
# no tsconfig, no tsc, and no build step. Type annotations are erased at load; they are never checked.
ARG NODE_JS_ALPINE_IMAGE_REFERENCE=node:24.21.0-alpine
ARG PNPM_VERSION=12.5.1

FROM ${NODE_JS_ALPINE_IMAGE_REFERENCE}
ARG PNPM_VERSION

# ca-certificates: skill scripts fetch over HTTPS (BytePlus docs and similar). tini: reaps zombies
# and forwards signals so a Ctrl-C on a long fetch actually stops the script instead of detaching it.
RUN apk add --no-cache ca-certificates tini \
    && npm install -g "pnpm@${PNPM_VERSION}"

WORKDIR /opt/lixpi-utils

# Reuse the environment setup package as the shared terminal-UI runtime. The skill installer source
# is bind-mounted by Compose, so UI edits apply immediately while dependency changes require a rebuild.
COPY packages/lixpi/debug-tools/ts ./packages/lixpi/debug-tools/ts
COPY packages/lixpi/constants ./packages/lixpi/constants
COPY packages/lixpi/nats-subject-registry ./packages/lixpi/nats-subject-registry
COPY dev-tools/config-utils/pnpm-workspace.yaml ./
COPY dev-tools/config-utils/package.json ./
RUN pnpm install --prod

WORKDIR /skills

ENV NODE_ENV=production

# run-skill.sh is bind-mounted rather than baked in, so edits apply without a rebuild. Bind mounts
# don't preserve the host exec bit, hence "sh <path>".
ENTRYPOINT ["/sbin/tini", "--", "sh", "/usr/local/bin/run-skill.sh"]
