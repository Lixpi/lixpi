ARG NODE_VERSION=23

FROM node:${NODE_VERSION}-alpine AS builder

RUN npm install -g pnpm

WORKDIR /usr/src/service

COPY services/model-pricing .
COPY packages ./packages

RUN pnpm install --force && pnpm store prune && rm -rf ~/.pnpm-store

FROM node:${NODE_VERSION}-alpine

RUN npm install -g pnpm

WORKDIR /usr/src/service

COPY --from=builder /usr/src/service .

CMD ["pnpm", "run", "start"]
