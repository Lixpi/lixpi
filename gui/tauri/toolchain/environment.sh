#!/usr/bin/env bash
# Sourced by both the normal release build and bounded validation commands.
case "${LIXPI_DESKTOP_TARGET}" in
    aarch64-apple-darwin) export LIXPI_CEF_ARCH=arm64 LIXPI_CEF_ZIG_TARGET=aarch64-macos ;;
    x86_64-apple-darwin) export LIXPI_CEF_ARCH=x86_64 LIXPI_CEF_ZIG_TARGET=x86_64-macos ;;
    *) echo "Unsupported CEF target: ${LIXPI_DESKTOP_TARGET}" >&2; return 2 ;;
esac
export CMAKE_TOOLCHAIN_FILE=/usr/src/desktop/toolchain/macos.cmake
target_key="${LIXPI_DESKTOP_TARGET//-/_}"
export "CC_${target_key}=/usr/src/desktop/toolchain/zig-cc"
export "CXX_${target_key}=/usr/src/desktop/toolchain/zig-cxx"
export "AR_${target_key}=/usr/src/desktop/toolchain/zig-ar"
export "RANLIB_${target_key}=/usr/src/desktop/toolchain/zig-ranlib"
export CEF_PATH="${CEF_PATH:-/cef}"
