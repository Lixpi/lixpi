#!/bin/sh
set -eu

target=${1:-}
action=${2:-fix}
case "$target" in
    ""|*[!a-z0-9-]*|-*|*-) echo 'Usage: go-quality-runner <mounted-target> [fix|validate|dependencies]' >&2; exit 2 ;;
esac
case "$action" in
    fix|validate|dependencies) ;;
    *) echo 'Usage: go-quality-runner <mounted-target> [fix|validate|dependencies]' >&2; exit 2 ;;
esac

manifest_dir="/usr/src/manifests/$target"
service_dir="/usr/src/service/$target"
[ -f "$manifest_dir/go.mod" ] || { echo "Unknown Go quality target: $target" >&2; exit 2; }
[ -f "$manifest_dir/go.sum" ] || { echo "Missing go.sum for Go quality target: $target" >&2; exit 2; }
[ -d "$service_dir" ] || { echo "Missing source mounts for Go quality target: $target" >&2; exit 2; }

cp "$manifest_dir/go.mod" "$service_dir/go.mod"
cp "$manifest_dir/go.sum" "$service_dir/go.sum"
cd "$service_dir"

if [ "$action" = dependencies ]; then
    go mod tidy
    # Only this explicit action updates the authored module manifests.
    cp go.mod "$manifest_dir/go.mod"
    cp go.sum "$manifest_dir/go.sum"
    exit
fi

export GOFLAGS=-mod=readonly
go mod download
config=/usr/src/runner/golangci.yml
if [ "$action" = fix ]; then
    check-go-source --fix .
    golangci-lint fmt --config "$config"
    exec golangci-lint run --fix --config "$config" ./...
fi
check-go-source .
golangci-lint fmt --diff --config "$config"
exec golangci-lint run --config "$config" ./...
