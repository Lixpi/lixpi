ARG NATS_IO_NATS_BOX_IMAGE_REFERENCE=natsio/nats-box:0.20.1
ARG GO_BOOKWORM_IMAGE_REFERENCE=golang:1.27.3-bookworm

FROM ${NATS_IO_NATS_BOX_IMAGE_REFERENCE} AS snapshot-cli
FROM ${GO_BOOKWORM_IMAGE_REFERENCE}

COPY --from=snapshot-cli /usr/local/bin/nats /usr/local/bin/nats

ENV GOTOOLCHAIN=local CGO_ENABLED=1 GOCACHE=/go-build-cache GOMODCACHE=/go-module-cache
WORKDIR /usr/src/service
ENTRYPOINT ["sh", "/usr/src/runner/run-tests.sh"]
