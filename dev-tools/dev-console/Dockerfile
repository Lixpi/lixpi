ARG NODE_JS_ALPINE_IMAGE_REFERENCE=node:24.22.2-alpine
ARG PNPM_VERSION=12.16.1

FROM ${NODE_JS_ALPINE_IMAGE_REFERENCE}
ARG PNPM_VERSION

RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate

WORKDIR /opt/dev-console

# Only dependencies live in the image. Compose bind-mounts both source trees, so
# edits apply on the next run while dependency changes rebuild this layer.
COPY packages/lixpi/cli-ui ./packages/lixpi/cli-ui
COPY dev-tools/dev-console/pnpm-workspace.yaml ./
COPY dev-tools/dev-console/package.json ./
RUN pnpm install --prod

ENTRYPOINT ["node", "--experimental-transform-types", "src/main.ts"]
