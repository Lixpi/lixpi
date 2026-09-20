ARG NODE_JS_ALPINE_IMAGE_REFERENCE=node:24.21.0-alpine
ARG PNPM_VERSION=12.5.1

# Stage 1: Build
FROM ${NODE_JS_ALPINE_IMAGE_REFERENCE} AS builder
ARG PNPM_VERSION

# Install necessary build tools for building native dependencies
# RUN apk add --update --no-cache python3 make g++ cmake

# Install pnpm globally
RUN npm install -g "pnpm@${PNPM_VERSION}"

# Set the working directory
WORKDIR /usr/src/service

# Copy the rest of app's source code
COPY ./services/api .
COPY ./packages ./packages
COPY ./services/api/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Install dependencies, redundant when running locally because starting service each time will install deps, but needed for deployment
RUN pnpm install --force && pnpm store prune && rm -rf ~/.pnpm-store


# Stage two -----------------------------------------------------------------------


# Stage 2: Runtime
FROM ${NODE_JS_ALPINE_IMAGE_REFERENCE}
ARG PNPM_VERSION

# The API does NO heavy media processing. All transcode/poster/probe work
# (ffmpeg/libreoffice/poppler/sharp) runs on the NATS NEX node in the
# file-conversion workload (services/nex/workloads/file-conversion); the API only
# stores the original and hands the heavy work off over NATS. Keep this image
# lean — do not reintroduce media tooling here.
RUN apk add --update --no-cache curl rsync

# Install pnpm globally (in the runtime stage)
RUN npm install -g "pnpm@${PNPM_VERSION}"

# Set the working directory
WORKDIR /usr/src/service

# Copy from builder stage the necessary files
COPY --from=builder /usr/src/service .

# Dev-loop package sync (see scripts/docker/workspace-package-sync.sh). Inert in
# deployed images, where there is no host mount to sync from.
COPY scripts/docker/workspace-package-sync.sh /usr/local/bin/workspace-package-sync.sh
RUN chmod +x /usr/local/bin/workspace-package-sync.sh

# Expose the port the app runs on
EXPOSE 3000

# Run the application
CMD ["pnpm", "run", "start"]
