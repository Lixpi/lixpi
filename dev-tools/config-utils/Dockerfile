ARG NODE_JS_ALPINE_IMAGE_REFERENCE=node:24.21.0-alpine
ARG PNPM_VERSION=12.5.1

FROM ${NODE_JS_ALPINE_IMAGE_REFERENCE}
ARG PNPM_VERSION

# Install pnpm
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate

WORKDIR /usr/src/config-utils

# Copy package files and install dependencies
COPY packages/lixpi/debug-tools/ts ./packages/lixpi/debug-tools/ts
COPY packages/lixpi/constants ./packages/lixpi/constants
COPY packages/lixpi/nats-subject-registry ./packages/lixpi/nats-subject-registry
COPY dev-tools/config-utils/pnpm-workspace.yaml ./
COPY dev-tools/config-utils/package.json ./
RUN pnpm install --prod

# Copy the shared runner. Repository-specific setup modules and templates are
# mounted by each repository's Compose adapter.
COPY dev-tools/config-utils/run-config.ts ./
RUN mkdir -p repository
COPY dev-tools/config-utils/environment-file.ts ./repository/environment-file.ts

# Set environment for colored output
ENV FORCE_COLOR=1

# Mount point for workspace
VOLUME /workspace

ENTRYPOINT ["node", "--experimental-transform-types", "run-config.ts"]
