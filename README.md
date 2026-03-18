# Lixpi

Bridges the gap between the best models

## Preview here: https://www.dropbox.com/scl/fi/a94opjhks8xa3arxzmyvd/lixpi-demo-moz.mp4?rlkey=q9yl8shub0w9xqfqrvqzc2sem&st=13vh5202&dl=0

<img width="1280" height="742" alt="image" src="https://github.com/user-attachments/assets/33ec726d-d0c3-4203-b5c9-5ce0a30568dd" />


## Quick Start

### 1. Environment Setup

Run the interactive setup wizard to generate your `.env` file.

```bash
# macOS / Linux
./init-config.sh

# Windows
init-config.bat
```

For CI/automation (non-interactive), see [`infrastructure/init-script/README.md`](infrastructure/init-script/README.md).

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

## Mock Authentication for Local Development

LocalAuth0 provides zero-config Auth0 mocking for offline development.

**Configuration:** Set `VITE_MOCK_AUTH=true` in your `.env` file (default in local environment)

**Default user:** `test@local.dev` / `local|test-user-001`

See [`services/localauth0/README.md`](services/localauth0/README.md) for details.

---


# Build and run individual services

## Web UI

```shell
# remove all previous builds including dangling images and force re-build and run
# unix
./rebuild-containers.sh lixpi-web-ui

# Then run single service
docker-compose --env-file .env.<stage-name> up lixpi-web-ui
```

## API

```shell
# remove all previous builds including dangling images and force re-build and run
# unix
./rebuild-containers.sh lixpi-api

# Then run single service
docker-compose --env-file .env.<stage-name> up lixpi-api
```

## LLM API

```shell
# remove all previous builds including dangling images and force re-build and run
# unix
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


##### Pulumi

We use Pulumi to manage our infrastructure code.

First you have to create twp *S3* buckets with the following names
 - `lixpi-pulumi-<your-name>-local`    // For local development
 - `lixpi-pulumi-<your-name>-dev`      // For dev deployments

To rebuild Pulumi container from scratch run:
```shell
./rebuild-containers.sh lixpi-pulumi
```

To run Pulumi:
```shell
docker-compose --env-file .env.<stage-name> up lixpi-pulumi
```


# Deploying to prod:

To build Web-ui

```shell
docker exec -it lixpi-web-ui pnpm build
```


# Architecture

Lixpi AI Bridge is a real-time AI-powered document collaboration platform built on a microservices architecture with NATS as the central nervous system for all inter-service and client-server communication.

## High-Level System Overview

![generated-image (4)](https://github.com/user-attachments/assets/ac8f7018-0b6a-41cd-80ee-d125970f28aa)


**The core idea is simple:**
- **Everything talks through NATS** — browser clients, API service, and LLM service all communicate via the same message bus
- **Web UI connects directly to NATS** via WebSocket, enabling real-time streaming without HTTP polling
- **API Service** handles authentication, business logic, and database operations
- **LLM API Service** streams AI responses directly to clients (bypassing API for lower latency)

## Service Responsibilities

| Service | Role |
|---------|------|
| **Web UI** | Browser-based client, real-time document editing, AI chat interface |
| **API** | Gateway service, JWT authentication, business logic, DynamoDB access |
| **LLM API** | AI model orchestration, token streaming, usage tracking |
| **NATS Cluster** | Message broker, pub/sub, request/reply |
| **LocalAuth0** | Mock Auth0 for offline development |
| **DynamoDB** | Document storage, user data, AI model metadata |

## NATS as the Communication Backbone

All communication in Lixpi flows through NATS, enabling:
- **End-to-end messaging**: Browser ↔ NATS ↔ Backend services
- **Real-time streaming**: AI token streaming directly to clients
- **Centralized auth**: NATS auth_callout delegates authentication to API service
- **Queue groups**: Load balancing across service instances

### Subject Naming Convention

```
domain.entity.action[.qualifier]

Examples:
  user.get                           # Request: Get user data
  document.create                    # Request: Create document
  ai.interaction.chat.sendMessage    # Publish: Send AI chat message
  ai.interaction.chat.receiveMessage.{documentId}  # Subscribe: Receive AI stream
  ai.interaction.chat.process        # Internal: API → LLM API
```


## AI Chat Flow

![generated-image (5)](https://github.com/user-attachments/assets/69641005-d191-4e56-b312-94f3ea57cfc5)


![generated-image](https://github.com/user-attachments/assets/4b6a2214-8bbf-4ae0-9ecb-e9e23a1cd793)


**Key insight:** Response tokens stream directly from LLM API → NATS → Web UI, bypassing the API service for minimal latency.

### Key Design Decisions

1. **Direct client streaming**: LLM API publishes tokens directly to the client's subscribed subject (`receiveMessage.{documentId}`), bypassing the API service for lower latency.

2. **API as gateway**: The API service acts as a gateway—it receives client requests, validates tokens, enriches data (e.g., AI model metadata), and forwards to LLM API.

3. **LangGraph workflows**: LLM API uses LangGraph state machines for structured processing: `validate → stream → calculate_usage → cleanup`.

4. **Provider abstraction**: OpenAI and Anthropic share a common base class, making it easy to add new AI providers.

## Scalability & Load Balancing

The system is designed to scale horizontally with zero configuration changes. Both `main-api` and `llm-api` services are stateless and can be replicated to handle increased load.


### How It Works

1. **Service Registration**: When a new instance of `main-api` or `llm-api` starts, it connects to NATS and subscribes to its relevant subjects (e.g., `ai.interaction.chat.process`) using a specific queue group name (e.g., `llm-workers`).
2. **Automatic Discovery**: NATS immediately recognizes the new subscriber as part of the group.
3. **Load Distribution**: When a message is published to that subject, NATS delivers it to **only one** member of the group, chosen at random.
4. **Fault Tolerance**: If an instance crashes, NATS detects the disconnection and stops sending messages to it, automatically rerouting traffic to the remaining healthy instances.

This architecture allows us to add or remove service instances dynamically based on CPU/memory usage without updating any routing configurations.


# A big thanks to all open source technologies that make this project possible!

 - ProseMirror: https://prosemirror.net
 - CodeMirror: https://codemirror.net
 - NATS: https://nats.io
 - D3: https://d3js.org
 - Svelte: https://svelte.dev
 - LangGraph: https://www.langchain.com/langgraph
 - shadcn & shadcn-svelte: https://www.shadcn-svelte.com
 - CSS Spinners: https://cssloaders.github.io

