FROM node:24-alpine

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN pnpm install

# Copy source files
COPY setup-env.ts ./
COPY templates ./templates

# Set environment for colored output
ENV FORCE_COLOR=1

# Mount point for workspace
VOLUME /workspace

ENTRYPOINT ["node", "setup-env.ts"]
