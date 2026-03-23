# Development Guide

## Services

| Service | Path | Purpose |
|---------|------|---------|
| **web-ui** | `services/web-ui/` | Svelte SPA — canvas, editors, AI chat UI |
| **api** | `services/api/` | Node.js gateway — auth, CRUD, DynamoDB |
| **llm-api** | `services/llm-api/` | Python AI orchestration (LangGraph) |
| **nats** | `services/nats/` | NATS message bus (3-node cluster) |
| **localauth0** | `services/localauth0/` | Mock Auth0 for local dev |

---

## Quick Start

### 1. Environment Setup

Run the interactive setup wizard to generate your `.env` file.

```bash
# macOS / Linux
./init-config.sh

# Windows
init-config.bat
```

For CI/automation (non-interactive), see [`infrastructure/init-script/README.md`](../infrastructure/init-script/README.md).

### 2. Initialize Infrastructure

Run the infrastructure initialization script to set up TLS certificates and DynamoDB tables. This step is required before starting the application for the first time.

```bash
# macOS / Linux
./init-infrastructure.sh

# Windows (run as Administrator for certificate installation)
init-infrastructure.bat
```

This script will:
- Start Caddy to generate TLS certificates
- Extract and install the CA certificate to your system's trust store
- Initialize DynamoDB tables using Pulumi

### 3. Start the Application

Run the startup script which will let you select an environment:

```bash
# macOS / Linux
./start.sh

# Windows
start.bat
```

---

## Build and Run Individual Services

### Web UI

```shell
# Remove all previous builds including dangling images and force re-build
./rebuild-containers.sh lixpi-web-ui

# Then run single service
docker-compose --env-file .env.<stage-name> up lixpi-web-ui
```

### API

```shell
# Remove all previous builds including dangling images and force re-build
./rebuild-containers.sh lixpi-api

# Then run single service
docker-compose --env-file .env.<stage-name> up lixpi-api
```

### LLM API

```shell
# Remove all previous builds including dangling images and force re-build
./rebuild-containers.sh lixpi-llm-api

# Then run single service
docker-compose --env-file .env.<stage-name> up lixpi-llm-api
```

**Note:** Before running the LLM API service, ensure you have generated NKey credentials:

```shell
# Generate LLM service NKey user credentials (NOT account!)
docker exec -it lixpi-nats-cli nsc generate nkey --user

# Add the seed to your .env file as NATS_LLM_SERVICE_NKEY_SEED
# Add the public key to your .env file as NATS_LLM_SERVICE_NKEY_PUBLIC
```

---

## Deploying to Production

To build Web UI:

```shell
docker exec -it lixpi-web-ui pnpm build
```

---

## Local Authentication

LocalAuth0 provides zero-config Auth0 mocking for offline development.

**Configuration:** Set `VITE_MOCK_AUTH=true` in your `.env` file (default in local environment)

**Default user:** `test@local.dev` / `local|test-user-001`

See [`services/localauth0/README.md`](../services/localauth0/README.md) for details.

---

## Pulumi (Infrastructure-as-Code)

We use Pulumi to manage our infrastructure code.

First you have to create two S3 buckets with the following names:
- `lixpi-pulumi-<your-name>-local` — for local development
- `lixpi-pulumi-<your-name>-dev` — for dev deployments

To rebuild Pulumi container from scratch:

```shell
./rebuild-containers.sh lixpi-pulumi
```

To run Pulumi:

```shell
docker-compose --env-file .env.<stage-name> up lixpi-pulumi
```
