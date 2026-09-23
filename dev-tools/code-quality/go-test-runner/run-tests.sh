#!/bin/sh
set -eu

target=${1:-}
[ "$#" -eq 0 ] || shift
case "$target" in
    ""|*[!a-z0-9-]*|-*|*-) echo 'Usage: go-test-runner <mounted-target> [go test arguments]' >&2; exit 2 ;;
esac

manifest_dir="/usr/src/manifests/$target"
service_dir="/usr/src/service/$target"
[ -f "$manifest_dir/go.mod" ] || { echo "Unknown Go test target: $target" >&2; exit 2; }
[ -f "$manifest_dir/go.sum" ] || { echo "Missing go.sum for Go test target: $target" >&2; exit 2; }
[ -d "$service_dir" ] || { echo "Missing source mounts for Go test target: $target" >&2; exit 2; }

# The module root belongs to the container. Go never rewrites host manifests.
cp "$manifest_dir/go.mod" "$service_dir/go.mod"
cp "$manifest_dir/go.sum" "$service_dir/go.sum"
cd "$service_dir"
export GOFLAGS=-mod=readonly
go mod download
if [ "$#" -eq 0 ]; then
    set -- ./...
fi
exec go test -race -count=1 -timeout=120s "$@"
