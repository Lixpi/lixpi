ARG RUST_ALPINE_IMAGE_REFERENCE=rust:1.99.1-alpine

# Builds the macOS desktop app on Linux. Rust compiles for the Apple targets,
# Zig links them against the macOS SDK, and rcodesign signs the bundle
# with the persistent local-development identity from the signing volume.
FROM ${RUST_ALPINE_IMAGE_REFERENCE}
ARG ZIG_VERSION=0.17.1
ARG CARGO_ZIGBUILD_VERSION=0.24.1
ARG TAURI_CLI_VERSION=3.0.0-alpha.6
ARG APPLE_CODESIGN_VERSION=0.29.0

# Zig's release signing key, published at https://ziglang.org/download/.
ARG ZIG_MINISIGN_PUBLIC_KEY=RWSGOq2NVecA2UPNdBUZykf1CCb147pkmdtYxgb3Ti+JO/wCYvhbAb/U

RUN apk add --no-cache bash curl jq minisign musl-dev perl make pkgconfig openssl-dev openssl-libs-static xz

RUN rustup target add aarch64-apple-darwin x86_64-apple-darwin

RUN set -eu; case "$(uname -m)" in aarch64) zig_arch=aarch64 ;; x86_64) zig_arch=x86_64 ;; *) echo "Unsupported build host $(uname -m)" >&2; exit 1 ;; esac; archive="zig-${zig_arch}-linux-${ZIG_VERSION}.tar.xz"; curl -fsSLo "/tmp/${archive}" "https://ziglang.org/download/${ZIG_VERSION}/${archive}"; curl -fsSLo "/tmp/${archive}.minisig" "https://ziglang.org/download/${ZIG_VERSION}/${archive}.minisig"; minisign -Vm "/tmp/${archive}" -P "${ZIG_MINISIGN_PUBLIC_KEY}"; mkdir -p /opt/zig; tar -xJf "/tmp/${archive}" -C /opt/zig --strip-components=1; ln -s /opt/zig/zig /usr/local/bin/zig; rm "/tmp/${archive}" "/tmp/${archive}.minisig"

RUN --mount=type=cache,target=/usr/local/cargo/registry cargo install --locked "cargo-zigbuild@${CARGO_ZIGBUILD_VERSION}"
RUN --mount=type=cache,target=/usr/local/cargo/registry cargo install --locked "tauri-cli@${TAURI_CLI_VERSION}"
RUN --mount=type=cache,target=/usr/local/cargo/registry cargo install --locked "apple-codesign@${APPLE_CODESIGN_VERSION}"

# The SDK comes from the developer's own Mac through the `macos-sdk` build
# context, so the image never downloads or redistributes it.
COPY --from=macos-sdk . /opt/macos-sdk

# CEF adds a native C++ wrapper, and patch applies the runtime patch. Keep this
# after the cached Rust tools and SDK.
RUN apk add --no-cache cmake ninja patch

# The official Tauri runtime and CEF helper sources, downloaded, verified and
# patched inside the image at /opt/tauri-upstream. Only Lixpi's patch and pins
# live in the checkout.
COPY upstream /usr/src/tauri-upstream
RUN sh /usr/src/tauri-upstream/prepare.sh

ENV SDKROOT=/opt/macos-sdk
ENV MACOSX_DEPLOYMENT_TARGET=13.0
ENV CARGO_TARGET_DIR=/cargo-target

WORKDIR /usr/src/desktop
ENTRYPOINT ["bash", "/usr/src/desktop/build-macos-app.sh"]
