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
COPY ./services/api/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Install dependencies, redundant when running locally because starting service each time will install deps, but needed for deployment
RUN pnpm install --force && pnpm store prune && rm -rf ~/.pnpm-store


# Stage two -----------------------------------------------------------------------


# Stage 2: Runtime
FROM node:${NODE_VERSION}-alpine

# Install necessary packages for the unified file-upload transcode pipeline
# (services/api/src/services/transcoders/):
#   - ffmpeg     : audio/video transcode + poster/representative frame extraction
#                  and ffprobe for duration/dimension probing.
#   - libreoffice: headless office-document → PDF conversion (DOC/DOCX/PPT/PPTX/
#                  ODT/RTF). Heavy (~400MB) but only runs at ingest time.
#   - poppler-utils: pdftoppm renders a PDF's first page to a poster PNG, and
#                  pdfinfo reports its page count.
# Transcode/poster/probe steps are best-effort — if a tool is unavailable, the
# original is still stored and the upload still succeeds.
RUN apk add --update --no-cache curl ffmpeg libreoffice poppler-utils

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
