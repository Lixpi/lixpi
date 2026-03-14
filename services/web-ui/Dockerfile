# Set Node.js version
ARG NODE_VERSION=23

# Stage 1: Build
FROM node:${NODE_VERSION}-alpine AS builder

# Install necessary build tools for building native dependencies
# RUN apk add --update --no-cache python3 make g++ cmake

# Install pnpm globally
RUN npm install -g pnpm

# Set the working directory
WORKDIR /usr/src/service

# Copy the rest of app's source code
COPY ./services/web-ui/ .
COPY ./packages/lixpi/constants ./packages/lixpi/constants
COPY ./packages/lixpi/nats-service ./packages/lixpi/nats-service
COPY ./packages/lixpi/debug-tools ./packages/lixpi/debug-tools
COPY ./packages-vendor/shadcn-svelte/docs/src/lib ./packages/shadcn-svelte/lib
COPY ./pnpm-workspace.yaml ./pnpm-workspace.yaml

# Install dependencies, redundant when running locally because starting service each time will install deps, but needed for deployment
RUN pnpm install --force && pnpm store prune && rm -rf ~/.pnpm-store


# Stage two -----------------------------------------------------------------------


# Stage 2: Runtime
FROM node:${NODE_VERSION}-alpine

# Install necessary packages
RUN apk add --update --no-cache curl

# Install pnpm globally (in the runtime stage)
RUN npm install -g pnpm

# Set the working directory
WORKDIR /usr/src/service

# Copy from builder stage the necessary files
COPY --from=builder /usr/src/service .

# Expose the port the app runs on
EXPOSE 3000

# Run the application
CMD ["pnpm", "run", "serve"]
