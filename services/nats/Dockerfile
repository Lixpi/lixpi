# Go targets use the repository root as their build context.
ARG GOLANGCI_LINT_IMAGE_REFERENCE=golangci/golangci-lint:v2.13.2
ARG GO_BOOKWORM_IMAGE_REFERENCE=golang:1.27.1-bookworm
ARG GOPLS_VERSION=v0.23.0
ARG DLV_VERSION=v1.27.2

FROM ${GOLANGCI_LINT_IMAGE_REFERENCE} AS go-lint
FROM ${GO_BOOKWORM_IMAGE_REFERENCE} AS go-base
ENV GOTOOLCHAIN=local
WORKDIR /usr/src/service

FROM go-base AS development
ARG GOPLS_VERSION
ARG DLV_VERSION
COPY --from=go-lint /usr/bin/golangci-lint /usr/local/bin/golangci-lint
RUN go install "golang.org/x/tools/gopls@${GOPLS_VERSION}" && go install "github.com/go-delve/delve/cmd/dlv@${DLV_VERSION}"
CMD ["sh"]

FROM go-base AS go-build
COPY services/nats/go.mod services/nats/go.sum ./
RUN go mod download
COPY services/nats/cmd ./cmd
COPY services/nats/internal ./internal
RUN CGO_ENABLED=0 go build -mod=readonly -trimpath -o /out/lixpi-nats ./cmd/lixpi-nats

FROM scratch AS embedded-runtime
COPY --from=go-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=go-build /out/lixpi-nats /usr/local/bin/lixpi-nats
COPY services/nats/nats-server.conf /opt/nats/nats-server.conf
ENTRYPOINT ["/usr/local/bin/lixpi-nats"]
