ARG NODE_JS_ALPINE_IMAGE_REFERENCE=node:24.21.0-alpine
ARG PNPM_VERSION=12.5.1

FROM ${NODE_JS_ALPINE_IMAGE_REFERENCE} AS builder
ARG PNPM_VERSION

RUN npm install -g "pnpm@${PNPM_VERSION}"

WORKDIR /usr/src/service

COPY ./services/design-system/ .
COPY ./packages/lixpi/canvas-components ./packages/lixpi/canvas-components
COPY ./packages/lixpi/canvas-components-lixpi-specific ./packages/lixpi/canvas-components-lixpi-specific
COPY ./packages/lixpi/canvas-engine ./packages/lixpi/canvas-engine
COPY ./packages/lixpi/capability-system ./packages/lixpi/capability-system
COPY ./packages/lixpi/prosemirror ./packages/lixpi/prosemirror
COPY ./packages/lixpi/constants ./packages/lixpi/constants
COPY ./packages/lixpi/debug-tools ./packages/lixpi/debug-tools
COPY ./packages/lixpi/ui-kit-gentelella ./packages/lixpi/ui-kit-gentelella
COPY ./packages/lixpi/ui-kit ./packages/lixpi/ui-kit
COPY ./packages/lixpi/test-utils ./packages/lixpi/test-utils
COPY ./packages/lixpi/ui-primitives ./packages/lixpi/ui-primitives
COPY ./packages/lixpi/web-client-service-factory ./packages/lixpi/web-client-service-factory
COPY ./services/design-system/pnpm-workspace.yaml ./pnpm-workspace.yaml

RUN pnpm install --force && pnpm store prune && rm -rf ~/.pnpm-store

FROM ${NODE_JS_ALPINE_IMAGE_REFERENCE}
ARG PNPM_VERSION

RUN apk add --update --no-cache curl rsync
RUN npm install -g "pnpm@${PNPM_VERSION}"

WORKDIR /usr/src/service

COPY --from=builder /usr/src/service .
COPY scripts/docker/workspace-package-sync.sh /usr/local/bin/workspace-package-sync.sh
RUN chmod +x /usr/local/bin/workspace-package-sync.sh

EXPOSE 5173

CMD ["pnpm", "run", "build-and-serve"]
