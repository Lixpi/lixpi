# Set Node.js version
ARG NODE_VERSION=23

FROM node:${NODE_VERSION}-alpine

# Set the working directory
WORKDIR /usr/src/service

# The picker has no dependencies. Node runs the TypeScript entrypoint directly
# through native type stripping, so there is nothing to install and nothing to
# build. Sources are bind-mounted in docker-compose for the dev loop; these
# copies keep the image runnable on its own.
COPY ./services/param-picker/src ./src
COPY ./services/param-picker/public ./public

# Selections are written here. docker-compose mounts the host directory over it.
RUN mkdir -p /usr/src/service/data

EXPOSE 3010

CMD ["node", "./src/server.ts"]
