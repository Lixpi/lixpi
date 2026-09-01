ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine

RUN npm install -g pnpm@11.6.0

WORKDIR /usr/src/quality-runner

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

COPY stylelint-lixpi-plugin.ts stylelint-runner.ts ./

WORKDIR /usr/src/repository
