ARG NATS_IMAGE=lixpi/nats-embedded
FROM ${NATS_IMAGE} AS broker
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
WORKDIR /adapter
COPY package.json ./
RUN npm install --omit=dev --package-lock=false
COPY adapter.ts main.ts ./
COPY --from=broker /usr/local/bin/lixpi-nats /usr/local/bin/lixpi-nats
ENTRYPOINT ["node", "--experimental-transform-types", "/adapter/main.ts"]
