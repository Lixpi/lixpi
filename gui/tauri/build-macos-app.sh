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
#   LIXPI_DESKTOP_HOT_RELOAD   true lets the page follow web-ui's rebuilds; false for a release
#
# Every input comes from the environment file; none has a default here.

set -euo pipefail

project_dir=/usr/src/desktop
source_dir="${project_dir}/src-tauri"
icon_source="${project_dir}/app-icon.svg"
for name in LIXPI_DESKTOP_TARGET LIXPI_DESKTOP_DIAGNOSTICS LIXPI_DESKTOP_HOT_RELOAD; do
    [[ -n "${!name:-}" ]] || { echo "${name} is not set. Pass the environment file to docker compose with --env-file." >&2; exit 2; }
done

target="${LIXPI_DESKTOP_TARGET}"

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
minimum_system_version="$(jq -er '.bundle.macOS.minimumSystemVersion' "${config}")"
copyright="$(jq -er '.bundle.copyright' "${config}")"

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
case "${LIXPI_WEB_UI_URL}" in
    https://localhost|https://localhost[:/]*|https://127.0.0.1|https://127.0.0.1[:/]*)
        [[ -f "${local_ca}" ]] || { echo "The local stack's certificate authority is missing. Run Initialize infrastructure first." >&2; exit 2; }
        sed '/-----/d' "${local_ca}" | base64 -d > /tmp/lixpi-local-ca.der
        export LIXPI_LOCAL_CA_DER=/tmp/lixpi-local-ca.der
        echo "Trusting the local stack's certificate authority inside the app."
        ;;
esac

features=()
case "${LIXPI_DESKTOP_DIAGNOSTICS}" in
    true)
        features=(--features diagnostics)
        echo "Including diagnostics: the app logs the page's console, errors and page loads to ~/Library/Logs/${identifier}/diagnostics.log."
        ;;
    false) ;;
    *) echo "LIXPI_DESKTOP_DIAGNOSTICS must be true or false, found ${LIXPI_DESKTOP_DIAGNOSTICS}." >&2; exit 2 ;;
esac

case "${LIXPI_DESKTOP_HOT_RELOAD}" in
    true)
        features+=(--features hot-reload)
        echo "Including hot reload: the page updates as soon as web-ui rebuilds a change."
        ;;
    false) echo "Leaving out hot reload: the page changes only when it is reloaded with Cmd+R." ;;
    *) echo "LIXPI_DESKTOP_HOT_RELOAD must be true or false, found ${LIXPI_DESKTOP_HOT_RELOAD}." >&2; exit 2 ;;
esac

echo "Building ${product_name} ${version} for ${target}, opening ${LIXPI_WEB_UI_URL}..."
cargo tauri build --ci --no-bundle --target "${target}" --runner cargo-zigbuild "${features[@]}" -- --locked

binary="${CARGO_TARGET_DIR}/${target}/release/lixpi-desktop"
app="${project_dir}/dist/${product_name}.app"

rm -rf "${app}"
mkdir -p "${app}/Contents/MacOS" "${app}/Contents/Resources"
cp "${binary}" "${app}/Contents/MacOS/${product_name}"
cp icons/icon.icns "${app}/Contents/Resources/${product_name}.icns"

# The keys match what the Tauri bundler writes for a macOS app.
# NSAllowsLocalNetworking lets the window open a plain-HTTP localhost web-ui.
cat > "${app}/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>English</string>
    <key>CFBundleDisplayName</key>
    <string>${product_name}</string>
    <key>CFBundleExecutable</key>
    <string>${product_name}</string>
    <key>CFBundleIconFile</key>
    <string>${product_name}.icns</string>
    <key>CFBundleIdentifier</key>
    <string>${identifier}</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>${product_name}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${version}</string>
    <key>CFBundleVersion</key>
    <string>${version}</string>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.productivity</string>
    <key>LSMinimumSystemVersion</key>
    <string>${minimum_system_version}</string>
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsLocalNetworking</key>
        <true/>
    </dict>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSHumanReadableCopyright</key>
    <string>${copyright}</string>
</dict>
</plist>
PLIST

# Without a signing certificate rcodesign signs ad hoc, which is enough to run
# the app on the Mac that built it.
rcodesign sign "${app}"

echo "Built gui/tauri/dist/${product_name}.app"
