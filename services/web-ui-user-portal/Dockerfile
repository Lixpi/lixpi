ARG NODE_JS_ALPINE_IMAGE_REFERENCE=node:24.21.0-alpine
ARG PNPM_VERSION=12.5.1

FROM ${NODE_JS_ALPINE_IMAGE_REFERENCE} AS builder
ARG PNPM_VERSION

RUN npm install -g "pnpm@${PNPM_VERSION}"

WORKDIR /usr/src/service

COPY ./services/web-ui-user-portal/ .
COPY ./packages/lixpi/constants ./packages/lixpi/constants
COPY ./packages/lixpi/debug-tools ./packages/lixpi/debug-tools
COPY ./packages/lixpi/nats-service ./packages/lixpi/nats-service
COPY ./packages/lixpi/ui-kit-gentelella ./packages/lixpi/ui-kit-gentelella
COPY ./packages/lixpi/ui-primitives ./packages/lixpi/ui-primitives
COPY ./packages/lixpi/auth-client ./packages/lixpi/auth-client
COPY ./packages/lixpi/user-portal ./packages/lixpi/user-portal
COPY ./packages/lixpi/web-client-service-factory ./packages/lixpi/web-client-service-factory
COPY ./services/web-ui-user-portal/pnpm-workspace.yaml ./pnpm-workspace.yaml

RUN pnpm install --force && pnpm store prune && rm -rf ~/.pnpm-store

FROM ${NODE_JS_ALPINE_IMAGE_REFERENCE}
ARG PNPM_VERSION

RUN apk add --update --no-cache curl rsync
RUN npm install -g "pnpm@${PNPM_VERSION}"

WORKDIR /usr/src/service

COPY --from=builder /usr/src/service .
COPY scripts/docker/workspace-package-sync.sh /usr/local/bin/workspace-package-sync.sh
RUN chmod +x /usr/local/bin/workspace-package-sync.sh

EXPOSE 3000

CMD ["pnpm", "run", "serve"]
