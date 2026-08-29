# Set Node.js version
ARG NODE_VERSION=23

FROM node:${NODE_VERSION}-alpine

# Set the working directory
WORKDIR /usr/src/service

# Registry maintenance commands run inside this container. Keep curl and jq
# available so agents never depend on host tools to read, update, or validate it.
RUN apk add --no-cache curl jq

# Vite builds the client; sass compiles its stylesheet. The server needs no
# dependencies at all, because Node runs its TypeScript directly through native
# type stripping.
COPY ./services/ai-model-registry/package.json ./package.json
RUN npm install --no-audit --no-fund

COPY ./services/ai-model-registry/vite.config.ts ./vite.config.ts
COPY ./services/ai-model-registry/src ./src

# Build once so the image can serve the client without a dev server. In
# development Vite serves it instead, see the compose command.
RUN npm run build

# Parameter files live here. docker-compose mounts the host directory over it.
RUN mkdir -p /usr/src/service/data

EXPOSE 3010

CMD ["node", "./src/server.ts"]
