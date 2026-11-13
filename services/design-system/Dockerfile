ARG NODE_JS_ALPINE_IMAGE_REFERENCE=node:24.22.2-alpine
ARG PNPM_VERSION=12.16.1

FROM ${NODE_JS_ALPINE_IMAGE_REFERENCE}
ARG PNPM_VERSION

RUN apk add --no-cache rsync && npm install -g "pnpm@${PNPM_VERSION}"
WORKDIR /usr/src/service

COPY services/design-system/ ./
COPY packages/lixpi/canvas-engine ./packages/lixpi/canvas-engine
COPY packages/lixpi/canvas-components ./packages/lixpi/canvas-components
COPY packages/lixpi/capability-system ./packages/lixpi/capability-system
COPY packages/lixpi/constants ./packages/lixpi/constants
COPY packages/lixpi/debug-tools ./packages/lixpi/debug-tools
COPY packages/lixpi/prosemirror ./packages/lixpi/prosemirror
COPY packages/lixpi/prosemirror-themes ./packages/lixpi/prosemirror-themes
COPY packages/lixpi/test-utils ./packages/lixpi/test-utils
COPY packages/lixpi/ui-kit ./packages/lixpi/ui-kit
COPY packages/lixpi/themes ./packages/lixpi/themes
COPY packages/lixpi/ui-primitives ./packages/lixpi/ui-primitives
COPY packages/lixpi/web-client-service-factory ./packages/lixpi/web-client-service-factory
COPY scripts/docker/workspace-package-sync.sh /usr/local/bin/workspace-package-sync.sh

RUN chmod +x /usr/local/bin/workspace-package-sync.sh && pnpm install --no-frozen-lockfile
EXPOSE 3003
CMD ["/usr/local/bin/workspace-package-sync.sh", "run", "pnpm", "run", "dev"]
