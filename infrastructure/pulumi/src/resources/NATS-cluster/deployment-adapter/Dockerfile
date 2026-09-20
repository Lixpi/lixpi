ARG NATS_IMAGE=lixpi/nats-embedded
ARG NODE_JS_ALPINE_IMAGE_REFERENCE=node:24.21.0-alpine
FROM ${NATS_IMAGE} AS broker
FROM ${NODE_JS_ALPINE_IMAGE_REFERENCE}
WORKDIR /adapter
COPY package.json ./
RUN npm install --omit=dev --package-lock=false
COPY adapter.ts main.ts ./
COPY --from=broker /usr/local/bin/lixpi-nats /usr/local/bin/lixpi-nats
ENTRYPOINT ["node", "--experimental-transform-types", "/adapter/main.ts"]
