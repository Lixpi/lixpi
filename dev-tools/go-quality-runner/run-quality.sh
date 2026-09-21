#!/bin/sh
set -eu

domain=${1:-}
action=${2:-fix}
case "$domain:$action" in
    nats:fix|nats:validate|nats:dependencies|caddy:fix|caddy:validate|caddy:dependencies) ;;
    *) echo 'Usage: go-quality-runner <nats|caddy> [fix|validate|dependencies]' >&2; exit 2 ;;
esac
mkdir -p "/usr/src/service/$domain"
cp "/usr/src/manifests/$domain/go.mod" "/usr/src/service/$domain/go.mod"
cp "/usr/src/manifests/$domain/go.sum" "/usr/src/service/$domain/go.sum"
cd "/usr/src/service/$domain"

if [ "$action" = dependencies ]; then
    go mod tidy
    # Only this explicit action updates the authored module manifests.
    cp go.mod "/usr/src/manifests/$domain/go.mod"
    cp go.sum "/usr/src/manifests/$domain/go.sum"
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
