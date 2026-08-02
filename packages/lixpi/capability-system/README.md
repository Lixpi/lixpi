# Capability System

`@lixpi/capability-system` contains the reusable contracts and runtime for Lixpi Capabilities. A Capability is a first-class source-registered module with one owned entry package and explicit Tool/Skill package membership. A Skill package contributes instruction resources. A Tool package contributes an executable workflow whose steps call registered application actions. Standalone Tool and Skill packages are stored without module membership and remain independently selectable.

The package is split by runtime boundary:

```text
src/
  shared/      Manifest validation, JSON Schema validation, limits, and errors.
  backend/     Resolution, action registration, workflow execution, dispatch, module composition, and model-tool adapters.
  frontend/    Browser-safe catalog client, cache, ranking, manifest parsing, and shared validation.
  capabilities/
    character-creator/  Shared/backend module, Skills, Tools, schemas, resources, and tests.
    style-extraction/   Shared/backend module, Skills, Tools, schemas, resources, and tests.
    action-timeline/    Shared/backend/frontend Artifact module, Skills, schemas, styles, and tests.
```

Use the public subpaths. Do not import files below `src` from an application:

```typescript
import { CapabilityDispatcher, CapabilityModuleCatalog } from '@lixpi/capability-system/backend'
import { validateCapabilityManifest } from '@lixpi/capability-system/shared'
```

## Runtime boundaries

### `src/shared`

Shared code must be safe in browsers, API services, workers, and tests. It can depend on cross-runtime data contracts from `@lixpi/constants`, but it must not import Node-only APIs, NATS, DynamoDB, application models, or provider SDKs.

Shared Artifact definitions own schema creation, initial and editable-mutation validation, embedded-reference collection, complete model serialization, and catalog metadata. The generic registry selects them by `artifactTypeId`; core services do not switch on a concrete Artifact type.

### `src/backend`

Backend code owns the reusable Capability engine:

- manifest and dependency resolution into a sealed plan;
- action registration and allow-list enforcement;
- workflow input, output, condition, retry, and binding handling;
- run dispatch and cancellation;
- first-class Capability-module registration and Tool/Skill package installation;
- provider-neutral model-tool definitions and provider payload conversion.

Provider payload conversion projects the sealed canonical Tool input schema to each provider's accepted JSON Schema subset. OpenAI projections omit unsupported annotations and constraints such as `$schema` and `uniqueItems`; the Capability dispatcher still validates model arguments against the complete sealed schema before execution.

Tool execution policy is explicit: `required` runs in server preflight, `model-required` is exposed as a direct Tool that each selected reasoning provider must call once before continuing its response, and `model-choice` remains optional. The backend definition records policy and Capability identity; provider adapters own their native forced-tool payload shape.

The backend accepts storage, search, event, and persistence adapters through constructors or function arguments. It must not import a service implementation.

Concrete module backend code also lives in this package. Each module accepts typed service ports for application persistence, provider calls, Asset materialization, and events. Module code never imports `services/api`.

Character Creator treats the packaged example as a layout-only reference. Character-source Assets control identity and rendering class: photographs require photorealistic repeated depictions, while illustrated sources retain their specific medium. Its restoration contract permits complete replacement of draft character pixels while preserving the non-character sheet structure.

### `src/frontend`

Frontend code owns the transport-injected catalog client, cache, deterministic empty-query ranking, manifest JSON parsing, catalog management calls, and run replay/subscription filtering. Svelte state, editor components, authentication, and the concrete NATS client stay in `services/web-ui` and call this package.

Concrete module frontend definitions live beside their shared/backend definitions. They provide canvas, editor-plugin, optional prompt-control, generated-output info/replay, prompt-reference, and library factories through generic browser host ports. Action Timeline intentionally provides no prompt-control factory: `/` keeps the standard module badge and the API extracts timing from authoritative prompt text. Module code never imports `services/web-ui`.

Action Timeline's canvas frontend renders its editable document as compact, flat segment rows on the same steel-blue surface used by branch-lineage markers. Timecodes, inline Asset references, and generated-output metrics use typography and color instead of nested cards or bordered pills; the consuming application installs the package-owned stylesheet once per browser document. Generated reference atoms persist the canonical Asset title and media kind instead of using the Asset ID as display content. The module requests thumbnail and inline Asset-reference views through one opaque host factory, so authenticated media loading, canonical Asset titles, hover previews, and legacy-reference repair stay in the application's shared reference-preview system instead of being reimplemented by the module.

Action Timeline model-output schemas use provider-supported unions and retain semantic validation after generation. Artifact lineage records every explicitly authorized generation-source Asset even when the model does not mention every source in the final segment text; inline document references remain the subset actually emitted by the model.

## Service integration

An API service supplies adapters for catalog storage, resource loading, run persistence, event streams, model inputs, Artifact persistence, and chat event mirroring. It imports module factories from this package, binds those ports in its composition root, and registers one `CapabilityModuleDefinition` per concrete module. Registry validation requires unique module IDs, unique package ownership, and exactly one owned entry package with the declared kind.

A module-owned instruction Skill uses `createInstructionSkillPackage()` with an injected storage adapter. The module catalog supplies its `parentModuleId` and `catalogExposure: 'module-internal'` during seeding. Standalone package saves use `catalogExposure: 'standalone'` with no parent module. This keeps file parsing and manifest construction in the package while the API controls Blob persistence and catalog seeding.

## Adding code

- Put cross-runtime validation and data transforms in `shared`.
- Put reusable server-side orchestration in `backend`.
- Put browser-safe orchestration in `frontend`.
- Put each concrete cross-runtime module in `capabilities/<module-id>` and colocate its shared, backend, frontend, Skills, Tools, schemas, resources, and tests.
- Keep DynamoDB, NATS, LangGraph state, provider SDK clients, and application module registration in the consuming service.
- Add new public modules through the relevant `index.ts` file.
