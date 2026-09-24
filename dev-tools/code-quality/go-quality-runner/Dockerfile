ARG GOLANGCI_LINT_IMAGE_REFERENCE=golangci/golangci-lint:v2.13.2
ARG GO_BOOKWORM_IMAGE_REFERENCE=golang:1.27.1-bookworm

FROM ${GOLANGCI_LINT_IMAGE_REFERENCE} AS lint
FROM ${GO_BOOKWORM_IMAGE_REFERENCE}

COPY --from=lint /usr/bin/golangci-lint /usr/local/bin/golangci-lint
WORKDIR /usr/src/runner
COPY go.mod go.sum ./
RUN go mod download
COPY golangci.yml /usr/src/runner/golangci.yml
COPY source-conventions*.go ./
COPY cmd ./cmd
COPY internal ./internal
RUN golangci-lint fmt --diff --config /usr/src/runner/golangci.yml \
    && golangci-lint run --config /usr/src/runner/golangci.yml ./... \
    && go test -race ./... \
    && go build -trimpath -o /usr/local/bin/check-go-source . \
    && go build -trimpath -o /usr/local/bin/check-go-semantics ./cmd/check-go-semantics \
    && go vet -vettool=/usr/local/bin/check-go-semantics ./...
ENV GOTOOLCHAIN=local CGO_ENABLED=1 GOCACHE=/go-build-cache GOMODCACHE=/go-module-cache GOLANGCI_LINT_CACHE=/go-lint-cache
WORKDIR /usr/src/service
ENTRYPOINT ["sh", "/usr/src/runner/run-quality.sh"]
