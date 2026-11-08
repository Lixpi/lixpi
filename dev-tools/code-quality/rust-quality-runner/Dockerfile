ARG RUST_ALPINE_IMAGE_REFERENCE=rust:1.99.1-alpine

FROM ${RUST_ALPINE_IMAGE_REFERENCE}
ARG RUST_NIGHTLY_VERSION=2026-11-01

# Crates that bind the system web view link GTK and WebKitGTK on Linux.
RUN apk add --no-cache musl-dev pkgconf gtk+3.0-dev webkit2gtk-4.1-dev libsoup3-dev

# Clippy runs on the stable toolchain. rustfmt comes from a pinned nightly,
# because the layout rules in rustfmt.toml use unstable options.
RUN rustup component add clippy && rustup toolchain install "nightly-${RUST_NIGHTLY_VERSION}" --profile minimal --component rustfmt

# GTK and WebKitGTK are shared libraries, which a statically linked musl
# binary cannot load.
ENV RUSTFLAGS="-C target-feature=-crt-static" RUST_NIGHTLY_VERSION=${RUST_NIGHTLY_VERSION} CLIPPY_CONF_DIR=/usr/src/runner

WORKDIR /usr/src/runner
COPY Cargo.toml Cargo.lock rustfmt.toml clippy.toml clippy-lints ./
COPY src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/usr/src/runner/target \
    cargo "+nightly-${RUST_NIGHTLY_VERSION}" fmt --check -- --config-path rustfmt.toml \
    && cargo test --locked \
    && cargo build --locked --release \
    && install target/release/check-rust-source /usr/local/bin/check-rust-source \
    && check-rust-source src \
    && cargo clippy --locked --all-targets -- $(grep -v -e '^#' -e '^$' clippy-lints)

ENV CARGO_TARGET_DIR=/cargo-target
WORKDIR /usr/src/service
ENTRYPOINT ["sh", "/usr/src/runner/run-quality.sh"]
