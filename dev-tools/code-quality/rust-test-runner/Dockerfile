ARG RUST_ALPINE_IMAGE_REFERENCE=rust:1.99.1-alpine

FROM ${RUST_ALPINE_IMAGE_REFERENCE}

# Crates that bind the system web view link GTK and WebKitGTK on Linux.
RUN apk add --no-cache musl-dev pkgconf gtk+3.0-dev webkit2gtk-4.1-dev libsoup3-dev

# GTK and WebKitGTK are shared libraries, which a statically linked musl
# binary cannot load.
ENV RUSTFLAGS="-C target-feature=-crt-static" CARGO_TARGET_DIR=/cargo-target

WORKDIR /usr/src/service
ENTRYPOINT ["sh", "/usr/src/runner/run-tests.sh"]
