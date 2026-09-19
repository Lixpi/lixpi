#!/bin/sh
set -eu

domain=${1:-}
[ "$#" -eq 0 ] || shift
case "$domain" in
    nats|caddy) ;;
    *) echo 'Usage: go-test-runner <nats|caddy> [go test arguments]' >&2; exit 2 ;;
esac

# The module root belongs to the container. Go never rewrites host manifests.
mkdir -p "/usr/src/service/$domain"
cp "/usr/src/manifests/$domain/go.mod" "/usr/src/service/$domain/go.mod"
cp "/usr/src/manifests/$domain/go.sum" "/usr/src/service/$domain/go.sum"
cd "/usr/src/service/$domain"
export GOFLAGS=-mod=readonly
go mod download
if [ "$#" -eq 0 ]; then
    set -- ./...
fi
exec go test -race -count=1 -timeout=120s "$@"
