#!/usr/bin/env bash
# Shared packaging for normal release builds and bounded compile validation.
set -euo pipefail
project_dir=/usr/src/desktop
source_dir="${project_dir}/src-tauri"
config="${source_dir}/tauri.conf.json"
signing_identity=/usr/src/signing/local-development.pem
[[ -s "${signing_identity}" ]] || { echo "The stable desktop signing identity is missing. Build through ./run.sh to initialize it." >&2; exit 2; }
binary="${1:?Pass the main executable}"
helper_binary="${2:?Pass the official CEF helper executable}"
framework="${3:?Pass the Chromium Embedded Framework.framework directory}"
product_name="$(jq -er '.productName' "${config}")"
identifier="$(jq -er '.identifier' "${config}")"
version="$(jq -er '.version' "${config}")"
minimum_system_version="$(jq -er '.bundle.macOS.minimumSystemVersion' "${config}")"
copyright="$(jq -er '.bundle.copyright' "${config}")"
[[ -f "${binary}" && -f "${helper_binary}" && -d "${framework}" ]] || { echo "The app, CEF helper or Chromium framework is missing." >&2; exit 2; }
cd "${source_dir}"
# macOS stops any program without App Management access, Docker's file
# sharing included, from changing an app bundle once it has been launched. The
# container therefore never touches dist/${product_name}.app: it assembles the
# bundle in a staging folder nobody opens, and the dev console's host action
# swaps it into place.
staging="${project_dir}/dist/staging"
app="${staging}/${product_name}.app"

rm -rf "${staging}"
mkdir -p "${app}/Contents/MacOS" "${app}/Contents/Resources"
cp "${binary}" "${app}/Contents/MacOS/${product_name}"
cp icons/icon.icns "${app}/Contents/Resources/${product_name}.icns"

# The keys match what the Tauri bundler writes for a macOS app.
# NSAllowsLocalNetworking lets the window open a plain-HTTP localhost web-ui.
tee "${app}/Contents/Info.plist" >/dev/null <<PLIST
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

frameworks="${app}/Contents/Frameworks"
mkdir -p "${frameworks}"
cp -a "${framework}" "${frameworks}/Chromium Embedded Framework.framework"
entitlements="${project_dir}/cef-entitlements.plist"
signing=(--entitlements-xml-file "${entitlements}" --code-signature-flags runtime)

# This list, helper layout and LSUIElement string match the pinned Tauri
# bundler. Explicit signing scopes preserve each helper's JIT entitlements
# when rcodesign traverses the outer bundle and signs nested code again.
for suffix in '' ' (GPU)' ' (Renderer)' ' (Plugin)' ' (Alerts)'; do
    helper_name="${product_name} Helper${suffix}"
    helper="${frameworks}/${helper_name}.app"
    mkdir -p "${helper}/Contents/MacOS" "${helper}/Contents/Resources"
    cp "${helper_binary}" "${helper}/Contents/MacOS/${helper_name}"
    chmod +x "${helper}/Contents/MacOS/${helper_name}"
    tee "${helper}/Contents/Info.plist" >/dev/null <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key><string>English</string>
    <key>CFBundleDisplayName</key><string>${helper_name}</string>
    <key>CFBundleExecutable</key><string>${helper_name}</string>
    <key>CFBundleIdentifier</key><string>${identifier}.helper</string>
    <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
    <key>CFBundleName</key><string>${helper_name}</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>${version}</string>
    <key>CFBundleVersion</key><string>${version}</string>
    <key>LSMinimumSystemVersion</key><string>${minimum_system_version}</string>
    <key>LSUIElement</key><string>1</string>
</dict>
</plist>
PLIST
    signing+=(--entitlements-xml-file "Contents/Frameworks/${helper_name}.app:${entitlements}" --code-signature-flags "Contents/Frameworks/${helper_name}.app:runtime")
done

# Reuse the same certificate for the app and every nested component so
# macOS can recognize later local builds by their signing identity.
# Distribution still requires Developer ID signing and notarization.
rcodesign sign --pem-file "${signing_identity}" "${signing[@]}" "${app}"
echo "Assembled gui/tauri/dist/staging/${product_name}.app"
