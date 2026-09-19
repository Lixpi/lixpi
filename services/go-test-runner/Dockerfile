FROM natsio/nats-box@sha256:ffce8bd103383f179f8c7f11cf645726acf5d17280706c530c3b342dbe16334c AS snapshot-cli
FROM golang:1.26.8-bookworm@sha256:9fdc884aacc3bec89b20ffc69f4bb369c78210e3e4f600387b5128b12c199f81

COPY --from=snapshot-cli /usr/local/bin/nats /usr/local/bin/nats

ENV GOTOOLCHAIN=local CGO_ENABLED=1 GOCACHE=/go-build-cache GOMODCACHE=/go-module-cache
WORKDIR /usr/src/service
ENTRYPOINT ["sh", "/usr/src/runner/run-tests.sh"]
