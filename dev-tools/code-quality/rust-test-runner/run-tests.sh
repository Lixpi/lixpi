#!/bin/sh
set -eu

target=${1:-}
[ "$#" -eq 0 ] || shift
case "$target" in
    ""|*[!a-z0-9-]*|-*|*-) echo 'Usage: rust-test-runner <mounted-target> [cargo test arguments]' >&2; exit 2 ;;
esac

manifest_dir="/usr/src/manifests/$target"
service_dir="/usr/src/service/$target"
[ -f "$manifest_dir/Cargo.toml" ] || { echo "Unknown Rust test target: $target" >&2; exit 2; }
[ -f "$manifest_dir/Cargo.lock" ] || { echo "Missing Cargo.lock for Rust test target: $target" >&2; exit 2; }
[ -d "$service_dir" ] || { echo "Missing source mounts for Rust test target: $target" >&2; exit 2; }

# The crate root belongs to the container. Cargo never rewrites host manifests.
cp "$manifest_dir/Cargo.toml" "$service_dir/Cargo.toml"
cp "$manifest_dir/Cargo.lock" "$service_dir/Cargo.lock"
cd "$service_dir"
export CARGO_TARGET_DIR="/cargo-target/$target"
# Every feature is tested, so code behind an optional feature can't rot.
exec cargo test --locked --all-features "$@"
