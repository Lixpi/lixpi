# Shared utility runner for skill scripts.
#
# Every skill under skills/ that needs to execute code executes it here, never on the host. See
# documentation/development-workflow/SKILL-EXECUTION-GUIDE.md. The whole skills/ tree is bind-mounted at /skills
# (docker-compose.lixpi-utils.yml), so a script edit applies on the next run with no rebuild.
#
# The image deliberately ships no skill dependencies of its own. Skill scripts stick to the Node
# standard library; a skill that genuinely needs a package installs it into its own directory rather
# than baking it into this image, which keeps one skill's dependencies out of every other skill's
# runtime.
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

WORKDIR /skills

ENV NODE_ENV=production

# run-skill.sh is bind-mounted rather than baked in, so edits apply without a rebuild. Bind mounts
# don't preserve the host exec bit, hence "sh <path>".
ENTRYPOINT ["/sbin/tini", "--", "sh", "/usr/local/bin/run-skill.sh"]
