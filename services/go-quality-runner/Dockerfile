FROM golangci/golangci-lint:v2.13.2@sha256:ba07dffad130794ae79ebaa0056809d18c0168f3f846480ffd3eb6c04578b83d AS lint
FROM golang:1.26.8-bookworm@sha256:9fdc884aacc3bec89b20ffc69f4bb369c78210e3e4f600387b5128b12c199f81

COPY --from=lint /usr/bin/golangci-lint /usr/local/bin/golangci-lint
COPY source-conventions.go /usr/src/runner/source-conventions.go
RUN go build -trimpath -o /usr/local/bin/check-go-source /usr/src/runner/source-conventions.go
ENV GOTOOLCHAIN=local CGO_ENABLED=1 GOCACHE=/go-build-cache GOMODCACHE=/go-module-cache GOLANGCI_LINT_CACHE=/go-lint-cache
WORKDIR /usr/src/service
ENTRYPOINT ["sh", "/usr/src/runner/run-quality.sh"]
