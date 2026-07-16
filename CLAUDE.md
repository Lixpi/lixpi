# Project Guidelines

## Architecture

Lixpi is a visual, node-based AI image/video generation pipeline — a pnpm monorepo with TypeScript services and NATS messaging. See [documentation/PRODUCT-OVERVIEW.md](documentation/PRODUCT-OVERVIEW.md) for full architecture details.

| Service | Language | Path | Purpose |
|---------|----------|------|---------|
| **web-ui** | Svelte / TypeScript | `services/web-ui/` | Browser SPA — canvas, ProseMirror editors, AI chat UI |
| **api** | Node.js / TypeScript | `services/api/` | Gateway + in-process LLM orchestration (LangGraph), JWT auth, CRUD, DynamoDB |
| **nats** | Go (3-node cluster) | `services/nats/` | Message bus — pub/sub, JetStream Object Store |
| **localauth0** | Rust (vendored) | `services/localauth0/` | Mock Auth0 for local dev |

The LLM orchestration workflow (validate → stream → image gen → usage → cleanup) lives at `services/api/src/llm/` and uses [`@langchain/langgraph`](https://github.com/langchain-ai/langgraphjs). It used to be a separate Python `services/llm-api/` Fargate task; for the internal-service NATS auth pattern that Python service used, see [`documentation/knowledge/INTERNAL-SERVICE-NATS-AUTH-PATTERN.md`](documentation/knowledge/INTERNAL-SERVICE-NATS-AUTH-PATTERN.md).

Shared TypeScript packages live in `packages/lixpi/`. Infrastructure-as-Code in `infrastructure/pulumi/`.

## Code Style

At the start of every implementation iteration, use the documentation index to find the current coding guidance for the files you are changing. Always read [`documentation/testing/USING-TESTING-GUIDES.md`](documentation/testing/USING-TESTING-GUIDES.md) before deciding whether any test writing or test execution is allowed. Read the guide that matches the language, styling layer, framework, or runtime surface before editing. For `services/web-ui` TypeScript UI, SVG, D3, Svelte-adjacent, canvas chrome, or component work, always read [`documentation/coding-style-guides/TYPESCRIPT.md`](documentation/coding-style-guides/TYPESCRIPT.md) and [`documentation/coding-style-guides/UI-COMPONENTS.md`](documentation/coding-style-guides/UI-COMPONENTS.md).

## Command Execution

Agents MUST NOT run `npm`, `npx`, `pnpm`, or `pnpx` on the host. Agents MUST NOT install project dependencies or tooling on the host by any package manager.

Agents MUST NOT run project setup, package scripts, build scripts, docs builds, linters, formatters, test runners, framework CLIs, or repo scripts on the host. All project setup and all script execution must happen inside the appropriate Docker container, such as `docker exec <container> pnpm ...`, when the task's other permission and testing gates allow that command.

If the Dockerized command is not documented or the required container is unavailable, stop and ask instead of falling back to a host command.

## Documentation

Start at the documentation index, then read [Maintaining Documentation](documentation/MAINTAINING-DOCUMENTATION.md) before reorganizing, moving, deleting, or adding developer docs. Each folder may contain a separate `README.md`. When working on code, look for and read nearby README files. If you update a component, also update the README in that directory (or the parent if changes affect parent code). Do not create README files that don't already exist.

## Conventions

- When a question is related to SVG or D3, always refer to the available `D3` MCP server.
- Agents MUST NOT write tests or run tests unless the user explicitly asks for tests in the current thread. Static review and non-test hygiene checks are allowed, but test files and test commands are user-gated.
- Everything in `services/web-ui` runs inside Docker (`lixpi-web-ui`), but tests run via the separate `lixpi-typescript-test-runner` image, invoked as a one-shot `docker compose run`. If the user explicitly asks to run web-ui tests, use `docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner web-ui` or the targeted equivalent documented in `documentation/testing/TypeScript/web-ui/TESTING-GUIDE.md`.
- Agents MUST NOT run `svelte-check` anywhere in this repository, directly or through a package script or wrapper. It is prohibited.
- Agents MUST NOT use a browser, browser automation, screenshots, or manual visual inspection to verify work in this repository. Use static review unless the user explicitly asks for permitted automated test commands.
- Never use `cat` to edit files.
- Never run large inline Python or JS code in the terminal.

## Cross-repo metering contract

The usage-metering wire contract — the `metrics.*` subjects in `packages/lixpi/constants/nats-subjects.json` (`METRICS_SUBJECTS`) and the check/confirm request/response shapes in `services/api/src/metrics/contracts.ts` (used by `metrics-client.ts`) — is served by a hosted metering backend in a separate repository. Do not change this contract surface without explicit user allowance. If the user does allow a change, it must be mirrored in that backend in the same change, and remind the user that both sides must be updated and released together — a one-sided change silently breaks the wire.
