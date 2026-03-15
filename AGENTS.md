# Project Guidelines

## Architecture

Lixpi is a visual, node-based AI image/video generation pipeline — a pnpm monorepo with TypeScript services, a Python LLM API, and NATS messaging. See [documentation/PRODUCT-OVERVIEW.md](documentation/PRODUCT-OVERVIEW.md) for full architecture details.

| Service | Language | Path | Purpose |
|---------|----------|------|---------|
| **web-ui** | Svelte / TypeScript | `services/web-ui/` | Browser SPA — canvas, ProseMirror editors, AI chat UI |
| **api** | Node.js / TypeScript | `services/api/` | Gateway — JWT auth, CRUD, DynamoDB, NATS bridge |
| **llm-api** | Python (LangGraph) | `services/llm-api/` | AI orchestration — validate → stream → usage → cleanup |
| **nats** | Go (3-node cluster) | `services/nats/` | Message bus — pub/sub, JetStream Object Store |
| **localauth0** | Node.js | `services/localauth0/` | Mock Auth0 for local dev |

Shared TypeScript packages live in `packages/lixpi/`. Infrastructure-as-Code in `infrastructure/pulumi/`.

## Code Style

Language-specific coding conventions are in `documentation/coding-style-guides/`. Find the guide for the language you're working in and follow it.

## Documentation

Each folder may contain a separate `README.md`. When working on code, look for and read nearby README files. If you update a component, also update the README in that directory (or the parent if changes affect parent code). Do not create README files that don't already exist.

Documentation style guides are in `documentation/documentation-style-guides/`. Find the relevant guide before writing or updating documentation.

## Conventions

- When a question is related to SVG or D3, always refer to the available `D3` MCP server.
- Everything in `services/web-ui` runs inside Docker (`lixpi-web-ui`). Run tests with `docker exec lixpi-web-ui pnpm test:run`.
- Never use `cat` to edit files.
- Never run large inline Python or JS code in the terminal.
