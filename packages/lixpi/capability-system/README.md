# Capability System

`@lixpi/capability-system` contains the reusable contracts and runtime for Lixpi Capabilities. A Capability is a first-class source-registered module with one owned entry package, explicit Tool/Skill package membership, and a required description sheet. A Skill package contributes instruction resources. A Tool package contributes an executable workflow whose steps call registered application actions. Standalone Tool and Skill packages are stored without module membership and remain independently selectable.

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
- dependency validation and deterministic ready-node scheduling through `CapabilityDagRunner`;
- required and optional media-output bindings through `CapabilityMediaDagRunner`, including module-defined binding metadata, declared-output-only delivery, parallel release of ready consumers, and blocked-node settlement when a required producer has no output;
- run dispatch and cancellation;
- per-step execution traces: the runner hands each action a recorder through its execution context, so a step records the model calls it makes, the params each was called with, the Assets and Capabilities passed to each one, its reasoning, and resulting facts while it runs. The trace is emitted on that step's run events, including failure and cancellation events, so an aborted step still explains what it had already done. Actions may also declare `collectInputHandles` and `collectOutputHandles` so a step names what it was handed before it produces anything. Durable handles carry an entity id and a readable fallback, never a copied title, so a sealed trace does not drift. Recorded params report what a provider was actually called with rather than what was requested: a media request carries only a size preference, so the platform adapter reports the size it resolved against the model's supported sizes and the trace records that;
- first-class Capability-module registration and Tool/Skill package installation;
- provider-neutral model-tool definitions and provider payload conversion.

Provider payload conversion projects the sealed canonical Tool input schema to each provider's accepted JSON Schema subset. OpenAI projections omit unsupported annotations and constraints such as `$schema` and `uniqueItems`; the Capability dispatcher still validates model arguments against the complete sealed schema before execution.

Model-facing Skill text, Tool descriptions, schemas, and runtime prompts use content-neutral structural language. They contain no illustrative semantic or aesthetic examples and no stock negative lists. Required schema literals and Capability-domain contracts remain explicit; run-specific details come only from the authoritative request, authorized evidence, or resources with a declared role.

Tool execution policy is explicit: `required` runs in server preflight, `model-required` is exposed as a direct Tool that each selected reasoning provider must call once before continuing its response, and `model-choice` remains optional. The backend definition records policy and Capability identity; provider adapters own their native forced-tool payload shape.

The backend accepts storage, search, event, and persistence adapters through constructors or function arguments. It must not import a service implementation.

Concrete module backend code also lives in this package. Each module accepts typed service ports for application persistence, provider calls, Asset materialization, and events. Module code never imports `services/api`.

Character Creator owns its full backend runtime beside its Tool, Skills, shared plan, and resources. Its module definition registers the media strategy that receives the complete shared Capability media state, reauthorizes source Assets through an injected port, analyzes explicit request changes and baseline evidence, prepares lossless identity crops, attaches sibling Capability references plus dedicated text-free neutral-mannequin pose images, schedules and assesses a configurable 3-to-10-shot graph with one paid attempt per shot, normalizes every provider-generated panel to PNG, and publishes terminal shots that pass the categorical single-panel and target-view contract. Template and framing scores remain review metadata while deterministic composition normalizes crop, scale, margins, and cell placement. Provider partials stream immediately into presentation-only sheet previews, but never satisfy a generated-output binding or release a dependent shot. Every accepted terminal shot is stored as an isolated panel, progressively composed into the deterministic text-free 3840x2560 PNG, returned as a durable media-composition component beside the flattened sheet, traced, and cleared from transient work. A provider or categorical failure preserves its latest usable pixels as a `character-sheet-panel-review-only` component and completes a partial durable sheet whenever any panel pixels exist; review-only components never release dependent shots and are excluded from future generated-anchor resolution. The strategy fails without an output only when no accepted, terminal, or streamed panel pixels exist. Structured evidence declares full-sheet or selected-panel regeneration and the complete affected panel-ID set; unaffected durable panels enter the DAG only for a strict selected-panel scope, while missing components are always regenerated. The original source Assets remain separate composition provenance, while stored accepted panel components satisfy generated-reference bindings without another provider call. The generic media context identifies the resolver-selected edit target without importing the Character strategy into the host and preserves every provider-safe `REFERENCE_n` alias through evidence analysis and provider filenames. Every modern or legacy Character Creator sheet reference is resolved into its isolated accepted components; each provider request receives only the component matching its panel, never a flattened multi-panel sheet. Evidence analyzes original references and editable prior panels as separate input classes and classifies the prior sheet as `preserve-panel`, `identity-only`, `discard`, or `not-present`. A preserved matching panel is materialized as `edit-target`; identity-only approval sends only a cropped `edit-target-identity` face reference to the head shot and sends no rejected panel pixels to body shots. Portrait shots never receive body/outfit or carried-element crops. When an approved edit-target identity crop exists, a portrait also excludes full-body original sources and unrelated inferred face crops unless the request explicitly assigns face-region evidence from that source; otherwise a lossless face crop replaces its redundant full source for the portrait call. Original evidence remains `original-source`, including facts named by requested changes when the request assigns the corrected target to that original; request-assigned evidence outranks supporting or unassigned evidence for the same feature. These reference relationships are carried through the API's LangGraph image-reference state and provider adapters only serialize them. The shared state's provider-safe raw user prompt is authoritative; reasoning-model prompt expansions cannot replace it. The same state carries source subject-identity classifications and every sibling Capability contribution. Runtime prompt construction contains no named transformation or style branches: it applies only the authoritative request, extracted directives, shared Capability state, observed source medium, and panel contract. Each provider prompt scopes the complete request to one panel and forbids rendering other shots mentioned by the sheet-level request. Source depiction medium is preserved unless the request or a sibling Capability explicitly changes it. The configured barrier chain generates the neutral-front portrait, front full-body outfit view, and back full-body outfit view sequentially. The front-body request binds the categorically accepted portrait as `generated-identity-anchor`; the back-body request binds the accepted portrait and front-body output; every optional shot binds all three accepted anchors through `generated-identity-anchor`, `generated-outfit-anchor`, and `generated-back-outfit-anchor`. The three terminal images are materialized through plan-owned reference roles and filenames, while unrelated completed shots are not attached. After all three barriers settle, optional shots may run concurrently. The authoritative prompt and sibling Capability instructions always outrank source facts and generated anchors. A missing, multi-shot, or wrong-view terminal anchor blocks dependent provider calls, and omission of any required generated reference fails the affected provider result. Long source, VLM, provider, assessment, and composition calls publish five-second elapsed-time heartbeats through one ordered reporting chain. Valid categorical assessment failures reject the terminal candidate from anchor release while retaining its pixels for review. A malformed or unavailable comparison remains a review flag and never converts completed generation into a structural failure or blocks dependent shots. Non-categorical fidelity, template, and framing findings remain review flags with exact diagnostics. NEX face scoring runs independently from structured dimension scoring. It does not import API code, choose a hidden model, retry a failed shot, render typography into the sheet, or persist an output Asset.

When exactly one authorized original Asset exists, Character Creator deterministically reattaches an observed evidence fact with a missing source identifier to that Asset before validation. Ambiguous multi-source observations still fail validation instead of inventing a relationship.

### `src/frontend`

Frontend code owns the transport-injected catalog client, cache, deterministic empty-query ranking, manifest JSON parsing, catalog management calls, and run replay/subscription filtering. Authorized module metadata includes the description sheet used by application-owned hover and focus cards. Svelte state, editor components, authentication, and the concrete NATS client stay in `services/web-ui` and call this package.

Concrete module frontend definitions live beside their shared/backend definitions. They provide canvas, editor-plugin, optional prompt-control, generated-output info/replay, prompt-reference, and library factories through generic browser host ports. Action Timeline intentionally provides no prompt-control factory: `/` keeps the standard module badge and the API extracts timing from authoritative prompt text. Module code never imports `services/web-ui`.

Action Timeline's canvas frontend renders its editable document as compact, flat segment rows on the same steel-blue surface used by branch-lineage markers. Timecodes, inline Asset references, and generated-output metrics use typography and color instead of nested cards or bordered pills; the consuming application installs the package-owned stylesheet once per browser document. Generated reference atoms persist the canonical Asset title and media kind instead of using the Asset ID as display content. The module requests thumbnail and inline Asset-reference views through one opaque host factory, so authenticated media loading, canonical Asset titles, hover previews, and legacy-reference repair stay in the application's shared reference-preview system instead of being reimplemented by the module.

Action Timeline model-output schemas use provider-supported unions and retain semantic validation after generation. Artifact lineage records every explicitly authorized generation-source Asset even when the model does not mention every source in the final segment text; inline document references remain the subset actually emitted by the model.

## Service integration

An API service supplies adapters for catalog storage, resource loading, run persistence, event streams, model inputs, media providers, authorized Assets, transient storage, Artifact persistence, and chat event mirroring. It imports module factories from this package and binds those ports in its composition root. A module can publish owned media strategies through `CapabilityModuleDefinition.mediaStrategies`; `CapabilityModuleCatalog.registerMediaStrategies()` installs them into the host registry without the API importing the concrete strategy. Registry validation requires a complete description sheet, unique module IDs, unique package ownership, and exactly one owned entry package with the declared kind.

A consuming service must not contain a capability runtime. Capability-specific prompts, policy, orchestration, scheduling, retry, assessment, composition, tracing, and cleanup belong in `capabilities/<module-id>/`. Service adapters are limited to implementing package-owned ports with application infrastructure.

A module-owned instruction Skill uses `createInstructionSkillPackage()` with an injected storage adapter. The module catalog supplies its `parentModuleId` and `catalogExposure: 'module-internal'` during seeding. Standalone package saves use `catalogExposure: 'standalone'` with no parent module. This keeps file parsing and manifest construction in the package while the API controls Blob persistence and catalog seeding.

## Adding code

- Put cross-runtime validation and data transforms in `shared`.
- Put reusable server-side orchestration in `backend`.
- Put browser-safe orchestration in `frontend`.
- Put each concrete cross-runtime module in `capabilities/<module-id>` and colocate its shared, backend, frontend, Skills, Tools, schemas, resources, and tests.
- Keep concrete DynamoDB, NATS, LangGraph state, provider SDK clients, and application module registration in the consuming service. Expose them to modules only through package-owned typed ports.
- Add new public modules through the relevant `index.ts` file.
