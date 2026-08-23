# NATS NEX execution-engine node image.
#
# Mirrors services/api: a node:23-alpine base so the workload can run TypeScript
# via `node --experimental-transform-types` (exactly how the API container runs
# TS), plus the pinned `nex` binary that turns this container into a NEX node
# running the bundled native nexlet. The workload's @lixpi/* + provider-SDK deps
# are installed from the pnpm workspace, just like the API.
#
# `nex` is a static Go binary published per-arch on GitHub releases. libc6-compat
# is installed as a safety net in case a release links against glibc on musl.

ARG NODE_VERSION=23
ARG NEX_VERSION=0.4.1

FROM node:${NODE_VERSION}-alpine

# ARGs are reset after FROM — re-declare the ones used in this stage.
ARG NEX_VERSION
# BuildKit injects TARGETARCH (amd64 | arm64); it matches the nex release asset
# suffixes (nex_<ver>_linux_amd64 / _arm64). Defaults to amd64 when unset.
ARG TARGETARCH

# curl: release download + healthchecks. ca-certificates: TLS to GitHub/AWS.
# libc6-compat: lets the prebuilt Go binary run on musl Alpine.
#
# Heavy media tooling for the file-conversion workload (moved off services/api,
# which must do NO heavy processing):
#   - ffmpeg       : audio/video transcode + poster/representative frame extraction
#   - libreoffice  : headless office-document → PDF conversion (DOC/DOCX/PPT/RTF/ODT)
#   - poppler-utils: pdftoppm renders a PDF's first page to a poster PNG; pdfinfo
#                    reports page count
#   - libheif-tools: heif-convert decodes HEIC/HEIF via the system libheif. sharp's
#                    BUNDLED libheif fails on common Apple HEIC variants (MiHB/MiHA
#                    branded iPhone files) with "bad seek … Decoder plugin error",
#                    so HEIC/HEIF decoding is delegated to heif-convert.
# (sharp, used for non-HEIC images, is an npm dependency installed below.)
# Character fidelity uses onnxruntime-web's WASM backend rather than a native
# musl binding. Its pinned YuNet/SFace artifacts are copied with workloads and
# verified by SHA-256 before a session is created.
RUN apk add --update --no-cache curl ca-certificates libc6-compat ffmpeg libreoffice poppler-utils libheif-tools rsync

# pnpm installs the workload's node_modules (mirrors services/api).
RUN npm install -g pnpm

# Install the pinned nex binary for the build's target architecture.
RUN set -eux; \
    arch="${TARGETARCH:-amd64}"; \
    curl -fsSL -o /usr/local/bin/nex \
        "https://github.com/synadia-io/nex/releases/download/${NEX_VERSION}/nex_${NEX_VERSION}_linux_${arch}"; \
    chmod +x /usr/local/bin/nex

WORKDIR /usr/src/service

# Workspace setup (mirrors services/api): the nex package.json is the in-container
# workspace root; @lixpi/* resolve as workspace members via the baked
# pnpm-workspace.yaml. Locally the @lixpi packages are bind-mounted over
# ./packages and the entrypoint re-installs; for AWS/Pulumi (no mounts) the baked
# install below is what ships.
COPY services/nex/package.json ./package.json
COPY services/nex/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY packages ./packages
COPY services/nex/workloads ./workloads
RUN pnpm install --force && pnpm store prune && rm -rf ~/.pnpm-store

# Static, non-secret node defaults. kong auto-loads /etc/nex/config.json; the
# entrypoint still passes connection details + the node nkey as flags (flags
# override config), so nothing secret is ever baked into the image.
COPY services/nex/config.json /etc/nex/config.json

# Dev-loop package sync (see scripts/docker/workspace-package-sync.sh). Inert in
# deployed images, where there is no host mount to sync from.
COPY scripts/docker/workspace-package-sync.sh /usr/local/bin/workspace-package-sync.sh
RUN chmod +x /usr/local/bin/workspace-package-sync.sh

COPY services/nex/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
