ARG GOLANGCI_LINT_IMAGE_REFERENCE=golangci/golangci-lint:v2.13.2
ARG GO_BOOKWORM_IMAGE_REFERENCE=golang:1.27.1-bookworm

FROM ${GOLANGCI_LINT_IMAGE_REFERENCE} AS lint
FROM ${GO_BOOKWORM_IMAGE_REFERENCE}

COPY --from=lint /usr/bin/golangci-lint /usr/local/bin/golangci-lint
COPY source-conventions.go /usr/src/runner/source-conventions.go
RUN go build -trimpath -o /usr/local/bin/check-go-source /usr/src/runner/source-conventions.go
ENV GOTOOLCHAIN=local CGO_ENABLED=1 GOCACHE=/go-build-cache GOMODCACHE=/go-module-cache GOLANGCI_LINT_CACHE=/go-lint-cache
WORKDIR /usr/src/service
ENTRYPOINT ["sh", "/usr/src/runner/run-quality.sh"]
