# Go targets use the repository root as their build context.
FROM golangci/golangci-lint:v2.13.2@sha256:ba07dffad130794ae79ebaa0056809d18c0168f3f846480ffd3eb6c04578b83d AS go-lint
FROM golang:1.26.8-bookworm@sha256:9fdc884aacc3bec89b20ffc69f4bb369c78210e3e4f600387b5128b12c199f81 AS go-base
ENV GOTOOLCHAIN=local
WORKDIR /usr/src/service

FROM go-base AS development
COPY --from=go-lint /usr/bin/golangci-lint /usr/local/bin/golangci-lint
RUN go install golang.org/x/tools/gopls@v0.22.0 && go install github.com/go-delve/delve/cmd/dlv@v1.27.2
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
