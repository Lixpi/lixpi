# Project Guidelines

## Required Human-Facing Communication Skill

At the start of every agent turn, before writing any human-facing text, resolve and read `$talk-like-a-human` through the active harness's skill discovery. This is a hard rule for every interaction, including answers, clarification questions, progress updates, review comments, documentation, tickets, reports, and final responses. It applies even when the task is unrelated to documentation.

Read the repository's `env.lixpi` as configuration data and resolve `LIXPI_REPOSITORY_PATH` before following skill paths. The skill is stored at `${LIXPI_REPOSITORY_PATH}/skills/talk-like-a-human/SKILL.md`. Run `${LIXPI_REPOSITORY_PATH}/setup-skills.sh` after cloning so the active harness can discover the skills managed under `${LIXPI_REPOSITORY_PATH}/skills/`. Every repository skill path and skill-documentation link must use the owning repository's configured path variable; never use a relative path or a checkout alias.

If the skill cannot be resolved or read, stop immediately. Do not continue the task and do not produce any substantive response. The only permitted response is a brief report that `talk-like-a-human` could not be resolved, followed by waiting for the user's instructions.

## Architecture

Lixpi is a visual, node-based AI image/video generation pipeline — a pnpm monorepo with TypeScript services and NATS messaging. See [documentation/PRODUCT-OVERVIEW.md](documentation/PRODUCT-OVERVIEW.md) for full architecture details.

| Service | Language | Path | Purpose |
|---------|----------|------|---------|
| **web-ui** | TypeScript | `services/web-ui/` | Browser SPA — canvas, ProseMirror editors, AI chat UI |
| **api** | Node.js / TypeScript | `services/api/` | Gateway + in-process LLM orchestration (LangGraph), JWT auth, CRUD, DynamoDB |
| **nats** | Go (3-node cluster) | `services/nats/` | Message bus — pub/sub, JetStream Object Store |
| **localauth0** | Rust (vendored) | `services/localauth0/` | Mock Auth0 for local dev |
| **ai-model-registry** | Node.js / TypeScript | `services/ai-model-registry/` | Owns the model catalog: per-model rule files, provider and models.dev fetch, merge, drift reporting, and the `AI_MODELS_LIST` DynamoDB write. Also the parameter registry and its review UI |

The LLM orchestration workflow (validate → stream → image gen → usage → cleanup) lives at `services/api/src/llm/` and uses [`@langchain/langgraph`](https://github.com/langchain-ai/langgraphjs). It used to be a separate Python `services/llm-api/` Fargate task; for the internal-service NATS auth pattern that Python service used, see [`documentation/knowledge/INTERNAL-SERVICE-NATS-AUTH-PATTERN.md`](documentation/knowledge/INTERNAL-SERVICE-NATS-AUTH-PATTERN.md).

Shared TypeScript packages live in `packages/lixpi/`. Infrastructure-as-Code in `infrastructure/pulumi/`.

### Capability Module Ownership

Every concrete Capability MUST be self-contained under `packages/lixpi/capability-system/src/capabilities/<module-id>/`. The module directory owns its shared contracts, backend and frontend behavior, Tool and Skill packages, runtime orchestration, prompts, schemas, resources, and tests.

Consuming services MUST NOT implement capability-specific runtime logic or import a concrete capability strategy. A service may only supply infrastructure through package-owned typed ports, register the module definition in its composition root, and install module-published strategies through `CapabilityModuleCatalog`. Generic Capability infrastructure MUST NOT import a concrete module. See [Tools and Skills](${LIXPI_REPOSITORY_PATH}/documentation/library/TOOLS-AND-SKILLS.md) and the nearby [`@lixpi/capability-system` README](packages/lixpi/capability-system/README.md) before changing Capability code.

## Code Quality

At the start of every implementation iteration, resolve and read the [`code-quality` skill](${LIXPI_REPOSITORY_PATH}/skills/code-quality/SKILL.md). It selects the coding style and testing guides that apply to the files being changed. Its TypeScript rules bind every TypeScript file in the monorepo, not only web UI code, and its testing rules apply before an agent decides whether any test writing or execution is allowed.

## AI Model Registry

Before changing or reviewing an AI provider model, model ID, model list, parameter, request payload, configuration control, default, option, compatibility rule, price, capability, SDK surface, or related documentation, read and follow [`services/ai-model-registry/documentation/AI-MODEL-REGISTRY.md`](services/ai-model-registry/documentation/AI-MODEL-REGISTRY.md).

Registry data and production code MUST stay synchronized in the same implementation iteration. A code change requires the matching registry update, and a registry change requires the matching model-sync, provider, matrix, UI, test, and documentation review.

Agents MUST NOT edit `services/ai-model-registry/data/params/` directly, edit the fetched `services/ai-model-registry/data/model-catalog/<provider>/<model>.json` files by hand, or access the registry with host HTTP/JSON tools. The `-lixpi.json` beside each fetched file is the hand-authored half and is the one to change. Start the service with Docker Compose and execute registry reads, writes, validation, and provider-document fetches inside the appropriate container. If the container or required API operation is unavailable, stop instead of bypassing the registry boundary.

## Command Execution

Agents MUST NOT run `npm`, `npx`, `pnpm`, or `pnpx` on the host. Agents MUST NOT install project dependencies or tooling on the host by any package manager.

Agents MUST NOT run project setup, package scripts, build scripts, docs builds, linters, formatters, test runners, framework CLIs, or repo scripts on the host. All project setup and all script execution must happen inside the appropriate Docker container, such as `docker exec <container> pnpm ...`, when the task's other permission and testing gates allow that command.

If the Dockerized command is not documented or the required container is unavailable, stop and ask instead of falling back to a host command.

## Documentation

Start at the documentation index, then read [Maintaining Documentation](documentation/MAINTAINING-DOCUMENTATION.md) before reorganizing, moving, deleting, or adding developer docs. Each folder may contain a separate `README.md`. When working on code, look for and read nearby README files. If you update a component, also update the README in that directory (or the parent if changes affect parent code). Do not create README files that don't already exist.

## Conventions

- When a question is related to SVG or D3, always refer to the available `D3` MCP server.
- Agents MUST NOT write tests or run tests unless the user explicitly asks for tests in the current thread. Static review and non-test hygiene checks are allowed, but test files and test commands are user-gated.
- Everything in `services/web-ui` runs inside Docker (`lixpi-web-ui`), but tests run via the separate `lixpi-typescript-test-runner` image, invoked as a one-shot `docker compose run`. If the user explicitly asks to run web-ui tests, use `docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner web-ui` or the targeted equivalent documented in `documentation/code-quality/testing/TYPESCRIPT.md`.
- Agents MUST NOT use a browser, browser automation, screenshots, or manual visual inspection to verify work in this repository. Use static review unless the user explicitly asks for permitted automated test commands.
- Never use `cat` to edit files.
- Never run large inline Python or JS code in the terminal.

## Cross-repo provider-usage contract

The provider-usage wire contract — the `metrics.*` subjects in `packages/lixpi/constants/nats-subjects.json` (`METRICS_SUBJECTS`) and the request-authorization and usage-recording request/response shapes in `packages/lixpi/usage-reporter/src/provider-usage-contract.ts` (used by that package's `provider-usage-client.ts`) — is served by a hosted provider-usage responder in a separate repository. Do not change this contract surface without explicit user allowance. If the user does allow a change, it must be mirrored in that backend in the same change, and remind the user that both sides must be updated and released together — a one-sided change silently breaks the wire.
