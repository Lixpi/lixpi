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
COPY ./services/api .
COPY ./packages ./packages
COPY ./pnpm-workspace.yaml ./pnpm-workspace.yaml

# Install dependencies, redundant when running locally because starting service each time will install deps, but needed for deployment
RUN pnpm install --force && pnpm store prune && rm -rf ~/.pnpm-store


# Stage two -----------------------------------------------------------------------


# Stage 2: Runtime
FROM node:${NODE_VERSION}-alpine

# Install necessary packages
# ffmpeg is used by services/api/src/services/video-storage.ts to extract a
# poster frame from generated VEO videos for the PIXI low-LoD texture path.
# Poster extraction is best-effort — if ffmpeg is unavailable for any reason,
# video generation still completes, the canvas just won't have a static poster.
RUN apk add --update --no-cache curl ffmpeg

# Install pnpm globally (in the runtime stage)
RUN npm install -g pnpm

# Set the working directory
WORKDIR /usr/src/service

# Copy from builder stage the necessary files
COPY --from=builder /usr/src/service .

# Expose the port the app runs on
EXPOSE 3000

# Run the application
CMD ["pnpm", "run", "start"]
