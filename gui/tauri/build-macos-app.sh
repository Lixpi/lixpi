#!/usr/bin/env bash
#
# Builds Lixpi.app inside the lixpi-tauri-macos-builder container. The Tauri
# bundler only creates macOS bundles on a Mac, so the script compiles with the
# Tauri CLI, then assembles and signs the bundle the same way the bundler would.
#
# Compose sets the inputs:
#   LIXPI_WEB_UI_URL      the web-ui origin the window opens
#   LIXPI_API_URL         the API origin that serves downloads
#   LIXPI_DESKTOP_TARGET  aarch64-apple-darwin or x86_64-apple-darwin
#   LIXPI_DESKTOP_DIAGNOSTICS  true builds the diagnostics feature into the app
#   LIXPI_DESKTOP_PROFILING    true adds performance probes and enables diagnostics
#   LIXPI_DESKTOP_HOT_RELOAD   true lets the page follow web-ui's rebuilds; false for a release
#
# Profiling defaults to off. Compose supplies the other settings.

set -euo pipefail

for tool in cmake ninja; do
    command -v "${tool}" >/dev/null || { echo "The desktop builder image is missing ${tool}. Build through ./run.sh to refresh its Dockerfile layers." >&2; exit 2; }
done

project_dir=/usr/src/desktop
source_dir="${project_dir}/src-tauri"
icon_source="${project_dir}/app-icon.svg"
for name in LIXPI_DESKTOP_TARGET LIXPI_DESKTOP_DIAGNOSTICS LIXPI_DESKTOP_HOT_RELOAD; do
    [[ -n "${!name:-}" ]] || { echo "${name} is not set. Pass the environment file to docker compose with --env-file." >&2; exit 2; }
done

target="${LIXPI_DESKTOP_TARGET}"
source "${project_dir}/toolchain/environment.sh"

case "${target}" in
    aarch64-apple-darwin|x86_64-apple-darwin) ;;
    *) echo "LIXPI_DESKTOP_TARGET must be aarch64-apple-darwin or x86_64-apple-darwin, found ${target}." >&2; exit 2 ;;
esac

[[ -n "${LIXPI_WEB_UI_URL:-}" ]] || { echo "LIXPI_WEB_UI_URL is not set. Pass the environment file to docker compose with --env-file." >&2; exit 2; }
[[ -n "${LIXPI_API_URL:-}" ]] || { echo "LIXPI_API_URL is not set. Pass the environment file to docker compose with --env-file." >&2; exit 2; }

config="${source_dir}/tauri.conf.json"
product_name="$(jq -er '.productName' "${config}")"
identifier="$(jq -er '.identifier' "${config}")"
version="$(jq -er '.version' "${config}")"

cd "${source_dir}"

# Every icon size is rendered from app-icon.svg. The Tauri CLI writes icons
# for every platform; the app keeps the ones tauri.conf.json lists, which are
# committed so the Rust runners can compile the crate. They are rebuilt only
# when the source changes.
if [[ ! -f icons/icon.icns || "${icon_source}" -nt icons/icon.icns ]]; then
    echo "Generating app icons from app-icon.svg..."
    generated="$(mktemp -d)"
    cargo tauri icon "${icon_source}" --output "${generated}"
    mkdir -p icons
    jq -r '.bundle.icon[]' "${config}" | while read -r icon; do cp "${generated}/${icon#icons/}" "${icon}"; done
    rm -rf "${generated}"
fi

# A build for the local stack embeds the stack's certificate authority, so the
# app trusts the local certificates without the authority in the keychain.
# The authority is PEM in the caddy-certs volume; the app embeds it as DER.
local_ca=/usr/src/caddy-certs/ca.crt
unset LIXPI_LOCAL_CA_DER
if [[ "${LIXPI_WEB_UI_URL}" == https://* ]]; then
    authority="${LIXPI_WEB_UI_URL#https://}"
    authority="${authority%%[/?#]*}"
    authority="${authority##*@}"
    if [[ "${authority}" == \[* ]]; then
        local_host="${authority%%]*}]"
    else
        local_host="${authority%%:*}"
    fi
    case "${local_host,,}" in
        localhost|*.localhost|127.0.0.1|'[::1]')
            [[ -f "${local_ca}" ]] || { echo "The local stack's certificate authority is missing. Run Initialize infrastructure first." >&2; exit 2; }
            sed '/-----/d' "${local_ca}" | base64 -d > /tmp/lixpi-local-ca.der
            export LIXPI_LOCAL_CA_DER=/tmp/lixpi-local-ca.der
            echo "Trusting the local stack's certificate authority inside the app."
            ;;
    esac
fi

features=()
case "${LIXPI_DESKTOP_DIAGNOSTICS}" in
    true) features+=(--features diagnostics) ;;
    false) ;;
    *) echo "LIXPI_DESKTOP_DIAGNOSTICS must be true or false, found ${LIXPI_DESKTOP_DIAGNOSTICS}." >&2; exit 2 ;;
esac

profiling="${LIXPI_DESKTOP_PROFILING:-false}"
case "${profiling}" in
    true)
        features+=(--features profiling)
        echo "Including profiling for startup frames, the native event loop and webview round trips."
        ;;
    false) ;;
    *) echo "LIXPI_DESKTOP_PROFILING must be true or false, found ${profiling}." >&2; exit 2 ;;
esac

if [[ "${LIXPI_DESKTOP_DIAGNOSTICS}" == "true" || "${profiling}" == "true" ]]; then
    echo "Including diagnostics: the app logs the page's console, errors and page loads to ~/Library/Logs/${identifier}/diagnostics.log."
fi

case "${LIXPI_DESKTOP_HOT_RELOAD}" in
    true)
        features+=(--features hot-reload)
        echo "Including hot reload: the page updates as soon as web-ui rebuilds a change."
        ;;
    false) echo "Leaving out hot reload: the page changes only when it is reloaded with Cmd+R." ;;
    *) echo "LIXPI_DESKTOP_HOT_RELOAD must be true or false, found ${LIXPI_DESKTOP_HOT_RELOAD}." >&2; exit 2 ;;
esac

bash "${project_dir}/prepare-signing-identity.sh"

echo "Building ${product_name} ${version} for ${target}, opening ${LIXPI_WEB_UI_URL}..."
cargo tauri build --ci --no-bundle --target "${target}" --runner cargo-zigbuild "${features[@]}" -- --locked

# Build the upstream CEF-only helper with the same pinned CEF crates. The
# full application executable must never be copied into the helper bundles.
cargo zigbuild --locked --release --target "${target}" --manifest-path "${project_dir}/cef-helper/Cargo.toml"
metadata="$(cargo metadata --locked --format-version 1)"
cef_version="$(jq -er '.packages[] | select(.name == "cef") | .version | split("+")[1]' <<<"${metadata}")"
cef_arch="${target%%-*}"
framework="${CEF_PATH}/${cef_version}/cef_macos_${cef_arch}/Chromium Embedded Framework.framework"
bash "${project_dir}/bundle-macos-app.sh" "${CARGO_TARGET_DIR}/${target}/release/lixpi-desktop" "${CARGO_TARGET_DIR}/${target}/release/tauri-cef-helper" "${framework}"
