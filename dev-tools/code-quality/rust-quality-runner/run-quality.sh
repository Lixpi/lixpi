#!/bin/sh
set -eu

usage='Usage: rust-quality-runner <mounted-target> [fix|validate|dependencies]'
target=${1:-}
action=${2:-fix}
case "$target" in
    ""|*[!a-z0-9-]*|-*|*-) echo "$usage" >&2; exit 2 ;;
esac
case "$action" in
    fix|validate|dependencies) ;;
    *) echo "$usage" >&2; exit 2 ;;
esac

manifest_dir="/usr/src/manifests/$target"
service_dir="/usr/src/service/$target"
[ -f "$manifest_dir/Cargo.toml" ] || { echo "Unknown Rust quality target: $target" >&2; exit 2; }
[ -f "$manifest_dir/Cargo.lock" ] || { echo "Missing Cargo.lock for Rust quality target: $target" >&2; exit 2; }
[ -d "$service_dir" ] || { echo "Missing source mounts for Rust quality target: $target" >&2; exit 2; }

# The crate root belongs to the container. Cargo never rewrites host manifests
# outside the dependencies action.
cp "$manifest_dir/Cargo.toml" "$service_dir/Cargo.toml"
cp "$manifest_dir/Cargo.lock" "$service_dir/Cargo.lock"
cd "$service_dir"
export CARGO_TARGET_DIR="/cargo-target/$target"

if [ "$action" = dependencies ]; then
    cargo update --workspace
    # Only this explicit action updates the authored lockfile. It is a single
    # bind-mounted file, so it is rewritten in place rather than replaced.
    cat Cargo.lock > "$manifest_dir/Cargo.lock"
    exit
fi

runner=/usr/src/runner
# One lint flag per line; the unquoted expansion splits each into its words.
lints=$(grep -v -e '^#' -e '^$' "$runner/clippy-lints")
status=0
if [ "$action" = fix ]; then
    # shellcheck disable=SC2086
    cargo clippy --locked --all-targets --all-features --fix --allow-dirty --allow-no-vcs -- $lints || true
    check-rust-source --fix . || true
    cargo "+nightly-$RUST_NIGHTLY_VERSION" fmt --all -- --config-path "$runner/rustfmt.toml" || status=1
else
    cargo "+nightly-$RUST_NIGHTLY_VERSION" fmt --all --check -- --config-path "$runner/rustfmt.toml" || status=1
fi
check-rust-source . || status=1
# shellcheck disable=SC2086
cargo clippy --locked --all-targets --all-features -- $lints || status=1
exit "$status"
