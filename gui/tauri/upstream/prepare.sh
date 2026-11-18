#!/bin/sh
# Prepares the official Tauri sources the desktop app builds from, inside the
# container that runs this script. It downloads the published tauri-runtime-cef
# crate and the official CEF helper entry point, checks both against pinned
# SHA-256 digests, and applies Lixpi's runtime patch. Everything is written to
# /opt/tauri-upstream, never to the checkout or the host.
#
# The desktop builder image runs it while the image builds. The Rust test and
# quality runners run it as the desktop target's prepare hook, because Cargo
# resolves the macOS-only runtime dependency even on Linux.
#
# The pins stay here rather than in the version registry, because the patch
# applies to this exact release and an automatic bump would break it.
set -eu

runtime_version=3.0.0-alpha.7
runtime_sha256=c17121b17ba1bc49b9346ece93a42da70a43abdd0d793493838c4f0d8620ec36
# The Tauri commit the runtime release was published from; the helper comes from the same commit.
tauri_commit=81bfb7ca8f1a17be1e48c9b0d167c77b2137f9d3
helper_sha256=477f7a45877be834bdd43e0b5368212c7bd96ed7655fa6905d8302d7c3e129aa

recipe_dir=$(cd "$(dirname "$0")" && pwd)
destination=/opt/tauri-upstream
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

download() {
    wget -q -O "$2" "$1" || { echo "Could not download $1" >&2; exit 1; }
}

verify() {
    echo "$2  $1" | sha256sum -c -s - || { echo "$1 does not match its pinned SHA-256 digest" >&2; exit 1; }
}

download "https://static.crates.io/crates/tauri-runtime-cef/tauri-runtime-cef-${runtime_version}.crate" "$work/runtime.crate"
verify "$work/runtime.crate" "$runtime_sha256"
download "https://raw.githubusercontent.com/tauri-apps/tauri/${tauri_commit}/crates/tauri-bundler/cef-helper/main.rs" "$work/main.rs"
verify "$work/main.rs" "$helper_sha256"

tar -xzf "$work/runtime.crate" -C "$work"
runtime_dir="$work/tauri-runtime-cef-${runtime_version}"
patch -s -p1 -d "$runtime_dir" < "$recipe_dir/tauri-runtime-cef.patch"

rm -rf "$destination"
mkdir -p "$destination/cef-helper"
mv "$runtime_dir" "$destination/tauri-runtime-cef"
mv "$work/main.rs" "$destination/cef-helper/main.rs"
