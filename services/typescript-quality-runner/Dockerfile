ARG NODE_VERSION=23

FROM node:${NODE_VERSION}-alpine

RUN npm install -g pnpm@11.6.0

WORKDIR /usr/src/repository/services/typescript-quality-runner

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

WORKDIR /usr/src/repository
