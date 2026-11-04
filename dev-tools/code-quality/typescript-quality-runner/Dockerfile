ARG NODE_JS_ALPINE_IMAGE_REFERENCE=node:24.22.2-alpine
ARG PNPM_VERSION=12.16.1

FROM ${NODE_JS_ALPINE_IMAGE_REFERENCE}
ARG PNPM_VERSION

RUN npm install -g "pnpm@${PNPM_VERSION}"

WORKDIR /usr/src/quality-runner

RUN mkdir -p /usr/src/quality-runner/packages/debug-tools /usr/src/repository

ENTRYPOINT ["sh", "/usr/src/quality-runner/run-quality.sh"]
