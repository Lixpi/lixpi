ARG ALPINE_IMAGE_REFERENCE=alpine:3.24.2
ARG LOCAL_AUTH0_IMAGE_REFERENCE=public.ecr.aws/primaassicurazioni/localauth0:0.9.1
ARG RUST_ALPINE_IMAGE_REFERENCE=rust:1.88.0-alpine

# Build the server and browser frontend from the same pinned release.
FROM ${RUST_ALPINE_IMAGE_REFERENCE} AS mock-source
RUN apk add --no-cache curl musl-dev perl make pkgconfig openssl-dev openssl-libs-static patch
WORKDIR /source
ADD https://github.com/primait/localauth0/archive/c3cfecce94b614136ed4b7c7590f48973f67ef56.tar.gz /tmp/localauth0.tar.gz
RUN tar -xzf /tmp/localauth0.tar.gz --strip-components=1
COPY structured-claims.patch /tmp/structured-claims.patch
RUN patch -p1 < /tmp/structured-claims.patch

FROM mock-source AS mock-build
RUN --mount=type=tmpfs,target=/source/target \
    --mount=type=tmpfs,target=/usr/local/cargo/registry \
    cargo build --locked --release --jobs 2 --features vendor-openssl \
    && cp target/release/localauth0 /localauth0

FROM mock-source AS web-build
ARG TRUNK_VERSION=0.21.14
RUN apk add --no-cache gcompat libstdc++ \
    && rustup target add wasm32-unknown-unknown
RUN set -eu; \
    case "$(uname -m)" in \
        aarch64) target=aarch64-unknown-linux-musl ;; \
        x86_64) target=x86_64-unknown-linux-musl ;; \
        *) exit 1 ;; \
    esac; \
    archive="trunk-${target}.tar.gz"; \
    curl -fsSL "https://github.com/trunk-rs/trunk/releases/download/v${TRUNK_VERSION}/${archive}" -o "/tmp/${archive}"; \
    curl -fsSL "https://github.com/trunk-rs/trunk/releases/download/v${TRUNK_VERSION}/${archive}.sha256" -o "/tmp/${archive}.sha256"; \
    cd /tmp; \
    printf '%s  %s\n' "$(tr -d '\r\n' < "${archive}.sha256")" "$archive" | sha256sum -c -; \
    tar -xzf "${archive}" -C /usr/local/bin; \
    rm "${archive}" "${archive}.sha256"
COPY frontend.patch /tmp/frontend.patch
RUN patch -p1 < /tmp/frontend.patch
WORKDIR /source/web
ENV RUSTFLAGS='--cfg getrandom_backend="wasm_js"'
ENV CARGO_BUILD_JOBS=2
RUN --mount=type=tmpfs,target=/source/web/target \
    --mount=type=tmpfs,target=/usr/local/cargo/registry \
    trunk build --locked --release --dist /frontend \
    && grep -q 'type="module"' /frontend/index.html \
    && find /frontend -maxdepth 1 -name '*.wasm' | grep -q .

# Stage 1: Prepare scripts with Alpine
FROM ${ALPINE_IMAGE_REFERENCE} AS builder

# Copy and prepare scripts
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Stage 2: Final image
FROM ${LOCAL_AUTH0_IMAGE_REFERENCE}
COPY --from=mock-build /localauth0 /localauth0
COPY --from=web-build /frontend /web/dist

# Copy minimal shell utilities from Alpine
COPY --from=builder /bin/sh /bin/sh
COPY --from=builder /bin/busybox /bin/busybox
COPY --from=builder /lib/ld-musl-*.so.1 /lib/

# Create busybox symlinks for wget
RUN /bin/busybox --install -s /bin

# Copy scripts and config
COPY --from=builder /entrypoint.sh /entrypoint.sh
COPY localauth0.toml /localauth0.toml

# Set config file location
ENV LOCALAUTH0_CONFIG_PATH=/localauth0.toml

ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
