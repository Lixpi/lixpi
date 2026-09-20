# NATS NEX execution-engine node image.
#
# Mirrors services/api: the shared Alpine Node base so the workload can run TypeScript
# via `node --experimental-transform-types` (exactly how the API container runs
# TS), plus a `nex` binary built from the selected upstream release. The binary
# turns this container into a NEX node running the bundled native nexlet. The
# workload's @lixpi/* + provider-SDK deps
# are installed from the pnpm workspace, just like the API.

ARG GO_BOOKWORM_IMAGE_REFERENCE=golang:1.27.1-bookworm
ARG NODE_JS_ALPINE_IMAGE_REFERENCE=node:24.21.0-alpine
ARG NEX_VERSION=0.5.0
ARG PNPM_VERSION=12.5.1

FROM --platform=$BUILDPLATFORM ${GO_BOOKWORM_IMAGE_REFERENCE} AS nex-build
ARG NEX_VERSION
ARG TARGETOS
ARG TARGETARCH
RUN git clone --branch "${NEX_VERSION}" --depth 1 https://github.com/synadia-io/nex.git /usr/src/nex && \
    cd /usr/src/nex/cmd/nex && \
    CGO_ENABLED=0 GOOS="${TARGETOS:-linux}" GOARCH="${TARGETARCH:-amd64}" go build -trimpath -o /out/nex .

FROM ${NODE_JS_ALPINE_IMAGE_REFERENCE}
ARG PNPM_VERSION

# curl supports healthchecks. ca-certificates provides TLS roots for AWS.
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
RUN apk add --update --no-cache curl ca-certificates ffmpeg libreoffice poppler-utils libheif-tools rsync

# pnpm installs the workload's node_modules (mirrors services/api).
RUN npm install -g "pnpm@${PNPM_VERSION}"

COPY --from=nex-build /out/nex /usr/local/bin/nex

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
