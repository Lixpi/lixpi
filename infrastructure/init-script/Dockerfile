FROM node:24-alpine

# Install pnpm
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate

WORKDIR /app

# Copy package files and install dependencies
COPY packages/lixpi/debug-tools/ts /packages/lixpi/debug-tools/ts
COPY infrastructure/init-script/package.json ./
RUN pnpm --dir /packages/lixpi/debug-tools/ts install --prod && pnpm install --prod

# Copy source files
COPY infrastructure/init-script/setup-env.ts ./
COPY infrastructure/init-script/templates ./templates

# Set environment for colored output
ENV FORCE_COLOR=1

# Mount point for workspace
VOLUME /workspace

ENTRYPOINT ["node", "setup-env.ts"]
