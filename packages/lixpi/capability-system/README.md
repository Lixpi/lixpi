# Capability System

`@lixpi/capability-system` contains the reusable contracts and runtime for Lixpi Capabilities. A Capability is a manifest-backed plug-in unit. A Skill contributes instruction resources. A Tool contributes an executable workflow whose steps call registered application actions.

The package is split by runtime boundary:

```text
src/
  shared/      Manifest validation, JSON Schema validation, limits, and errors.
  backend/     Resolution, action registration, workflow execution, dispatch, module composition, and model-tool adapters.
  frontend/    Browser-safe catalog client, cache, ranking, manifest parsing, and shared validation.
```

Use the public subpaths. Do not import files below `src` from an application:

```typescript
import { CapabilityDispatcher, CapabilityModuleCatalog } from '@lixpi/capability-system/backend'
import { validateCapabilityManifest } from '@lixpi/capability-system/shared'
```

## Runtime boundaries

### `src/shared`

Shared code must be safe in browsers, API services, workers, and tests. It can depend on cross-runtime data contracts from `@lixpi/constants`, but it must not import Node-only APIs, NATS, DynamoDB, application models, or provider SDKs.

### `src/backend`

Backend code owns the reusable Capability engine:

- manifest and dependency resolution into a sealed plan;
- action registration and allow-list enforcement;
- workflow input, output, condition, retry, and binding handling;
- run dispatch and cancellation;
- Tool and Skill module composition;
- provider-neutral model-tool definitions and provider payload conversion.

The backend accepts storage, search, event, and persistence adapters through constructors or function arguments. It must not import a service implementation.

### `src/frontend`

Frontend code owns the transport-injected catalog client, cache, deterministic empty-query ranking, manifest JSON parsing, catalog management calls, and run replay/subscription filtering. Svelte state, editor components, authentication, and the concrete NATS client stay in `services/web-ui` and call this package.

## Service integration

An API service supplies adapters for catalog storage, resource loading, run persistence, event streams, and chat event mirroring. It registers concrete Capability modules in its composition root, then calls the package runtime. Concrete modules can use application services inside their registered actions, but the package cannot import or name those modules.

An instruction Skill uses `createInstructionSkillModule()` with an injected storage adapter. This keeps file parsing and manifest construction in the package while the API controls blob persistence and catalog seeding.

## Adding code

- Put cross-runtime validation and data transforms in `shared`.
- Put reusable server-side orchestration in `backend`.
- Put browser-safe orchestration in `frontend`.
- Keep DynamoDB, NATS, LangGraph state, provider SDK clients, and application module registration in the consuming service.
- Add new public modules through the relevant `index.ts` file.
