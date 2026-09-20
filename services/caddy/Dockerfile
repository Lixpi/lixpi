# Build from the repository root, as with services/nats.
ARG GO_BOOKWORM_IMAGE_REFERENCE=golang:1.27.1-bookworm

FROM --platform=$BUILDPLATFORM ${GO_BOOKWORM_IMAGE_REFERENCE} AS go-build
ARG TARGETOS
ARG TARGETARCH
ENV GOTOOLCHAIN=local
WORKDIR /usr/src/service
COPY services/caddy/go.mod services/caddy/go.sum ./
RUN go mod download
COPY services/caddy/cmd ./cmd
COPY services/caddy/internal ./internal
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -mod=readonly -trimpath -tags=lambda.norpc,nobadger,nomysql,nopgx -o /out/lixpi-caddy ./cmd/lixpi-caddy

FROM scratch AS embedded-runtime
COPY --from=go-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=go-build /out/lixpi-caddy /usr/local/bin/lixpi-caddy
ENV XDG_CONFIG_HOME=/tmp/caddy-config XDG_DATA_HOME=/tmp/caddy-data
ENTRYPOINT ["/usr/local/bin/lixpi-caddy"]
