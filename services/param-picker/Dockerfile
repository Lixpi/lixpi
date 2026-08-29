# Set Node.js version
ARG NODE_VERSION=23

FROM node:${NODE_VERSION}-alpine

# Set the working directory
WORKDIR /usr/src/service

# esbuild and sass are the only dependencies, and they exist to build the client:
# TypeScript to a bundle, SCSS to a stylesheet. The server itself needs nothing,
# because Node runs its TypeScript directly through native type stripping.
COPY ./services/param-picker/package.json ./package.json
RUN npm install --omit=optional --no-audit --no-fund

COPY ./services/param-picker/src ./src

# Build once so the image can serve without a writable mount. In development the
# container rebuilds on every change instead, see the compose command.
RUN node ./src/build.ts

# Parameter files live here. docker-compose mounts the host directory over it.
RUN mkdir -p /usr/src/service/data

EXPOSE 3010

CMD ["node", "./src/server.ts"]
