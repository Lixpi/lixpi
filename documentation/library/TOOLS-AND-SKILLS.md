---
title: Tools, Skills, and Capability Modules
description: How Lixpi packages AI instructions and executable workflows, how users attach and run them, and how developers add modules, standalone Tools, and standalone Skills.
---

# Tools, Skills, and Capability Modules

Lixpi's Capability system is a plug-in architecture for reusable AI behavior. Its public product unit is a first-class **Capability module**. A module owns one entry package and any Tool or Skill packages required to implement the behavior:

- A **Skill** contributes sealed instructions and authorized resources to model context.
- A **Tool** runs a declarative workflow whose steps call allowlisted API actions.

Tools and Skills are manifest-backed packages. They share scopes, permissions, dependency resolution, package storage, and run infrastructure, but a package contained by a module is not a separate user-facing catalog item.

## Taxonomy

A **Capability module** is a source-registered product behavior. It has a stable `moduleId`, presentation metadata, exactly one owned entry package, and an explicit set of Tool and Skill package installers. Character Creator, Style Extraction, and Action Timeline are modules.

A **Capability package** is one stored record with `kind: 'skill'` or `kind: 'tool'`. Every package has its own immutable ID, manifest, resources, permissions, and manifest hash. Packages are either:

- `module-internal`, with a required `parentModuleId`; or
- `standalone`, with no parent module.

All packages owned by a module, including its entry package, are `module-internal`. The module is the only row shown on the Capability surface. Standalone packages remain directly selectable on the Tool or Skill surfaces. The API enforces this boundary before serialization; clients do not infer containment from names, folders, or tags.

Every module definition includes a required description sheet. It contains:

- a plain-language purpose;
- every required, optional, or conditional input and its accepted media kinds;
- concrete guidance for better results;
- limitations that set honest expectations;
- qualitative cost and latency bands with a short execution summary.

Module registration rejects a missing, empty, or malformed sheet. Authorized module list and get responses include it. Prompt-reference chips keep only `moduleId` and `displayName`; hover or keyboard focus resolves current module metadata and opens the shared description card. An in-memory promise cache coalesces requests and evicts rejected entries so Retry performs a new authorized lookup.

{% callout type="important" %}
A manifest can describe resources, dependencies, and workflow bindings. It cannot register JavaScript, grant access to an action, embed credentials, or execute arbitrary code. Executable actions must be compiled into the API and registered in the allowlist.
{% /callout %}

## Runtime package anatomy

Every Capability manifest includes:

| Field | Meaning |
|------|---------|
| `capabilityId` | Stable identity stored in prompt atoms, references, run records, and grants. |
| `kind` | `skill` or `tool`. |
| `name` and `description` | Human and model-facing discovery text. |
| `references` | Other Capability packages required by ID and kind, with optional named imports. |
| `resources` | Content-addressed Markdown, JSON, JSON Schema, media, or Asset resources. |
| `exports` | Named instruction or step-template exports that another package can import. |
| `tool` | Tool-only input schema, output schema, execution policy, workflow steps, and outputs. |

Resources have stable `resourceId` values inside the package and immutable Blob hashes. A reference such as this imports an instruction export from another Skill:

```ts
{
    capabilityId: 'global.character-sheet-layout',
    kind: 'skill',
    import: ['layout'],
}
```

The Tool can then bind a workflow input to a resource from that resolved Skill:

```ts
layout: {
    source: 'resource',
    capabilityId: 'global.character-sheet-layout',
    resourceId: 'character-sheet-layout',
}
```

This keeps the Skill independently versioned and authorized. The Tool consumes a sealed resource instead of copying Skill text into executable code.

## Skills

A Skill is instruction-first. It can contain:

- Markdown instructions
- authorized reference media with a declared role
- JSON configuration
- JSON Schemas
- references to other Skills or Tools
- named instruction exports

A Skill does not register API actions. When the resolver includes it in a plan, its authorized resources can be added to model context or bound into a Tool workflow.

Use a module-internal Skill when it exists only to support a module. Use a standalone Skill when users or models should attach it directly. Module membership is structural: internal packages use `catalogExposure: 'module-internal'` and a required `parentModuleId`; standalone packages use `catalogExposure: 'standalone'` and no parent.

### Instruction neutrality

Static model-facing instructions describe roles, relationships, fields, invariants, evidence rules, and output structure. They do not contain illustrative subjects, objects, settings, actions, sample prompts, named aesthetics, creators, brands, equipment, or fixed semantic negative lists. Those details can prime generation even when they appear in an unrelated example or prohibition.

Required schema literals, stable identifiers, registered axis names, and domain vocabulary that defines the Capability contract are allowed. Semantic details for a run come from the authoritative user request, authorized reference evidence, or a deliberately assigned Capability resource. Negative constraints are derived from that run's request and evidence.

## Tools

A Tool manifest declares a DAG of workflow steps. Each step names a registered action and can define:

- dependencies on earlier steps
- inputs bound from Tool input, step output, a sealed resource, or a literal
- conditions
- bounded retries
- progress groups
- safe reasoning exposure
- output bindings

The action registry supplies the executable contract:

- input and output validation
- caller and root-Tool authorization
- timeout and cancellation
- retry classification
- safe progress summaries
- output Asset collection

The generic runner validates the Tool input schema, schedules ready steps concurrently, records skipped conditional steps, validates the final output schema, and appends durable `CapabilityRunEvent` records. Raw action inputs and outputs are not copied into progress events.

### Media-generation Tool output contract

A Tool that augments normal media generation declares that integration in its own output. The shared runtime does not identify Character Creator, Style Extraction, or any other module by Capability ID or Tool type.

The integration contract contains:

| Output | Purpose |
|---|---|
| `mediaGenerationMode` | Selects a named media policy implemented by the ordinary media pipeline. |
| `preserveUserPrompt` | Controls whether the original user request remains the image prompt instead of allowing the reasoning path to replace it. |
| `visualInstructions` | Adds provider-neutral instructions to the selected model runs. |
| `referenceImages` | Adds authorized image bytes or data URLs to the shared reference resolver. |
| `referenceImageTraceUrls` | Records auditable resource URLs without making providers resolve Capability resources themselves. |
| `capabilityMediaExecutionPlan` | Delegates a typed provider-neutral media graph to a registered strategy while retaining normal selected-model lineage and settlement. |

Instruction/reference Tools include the applicable instruction and reference fields in their output schema and workflow bindings. Plan-based Tools include `capabilityMediaExecutionPlan`. The abstract Capability runtime validates and forwards both contracts without importing or naming the module. Provider adapters consume normalized references; plan strategies select the adapters through provider definitions.

Plan-based media nodes can declare both `dependsOn` and named `outputBindings`. `dependsOn` controls when a node becomes ready. An output binding maps one declared producer result to a stable binding key for the consumer and marks that output optional or required. Binding types can add module-owned metadata that describes how the consumer materializes the result, such as a reference role and filename. `CapabilityMediaDagRunner` supplies only declared dependency and binding outputs to the module callback and blocks a consumer before provider execution when a required output is absent. It does not feed all preceding results into every later node. Nodes with satisfied barriers remain independently schedulable, so sibling consumers can run concurrently. Concrete modules decide which nodes are barriers and how bound outputs become prompts, references, controls, or other inputs; the generic runner contains no capability-specific roles.

This boundary is important for extension. Adding another media-generation Tool requires a module-owned output mode and a media-policy implementation. It must not add provider-specific reference assembly or a concrete module check to `@lixpi/capability-system`.

## How users and models select modules and packages

Typing `/` at a prompt token boundary opens the module picker. It lists top-level Capability modules only; it has no formatting, upload, Tool, or Skill commands.

Typing `@` opens the media-first prompt-reference picker. Media is the default category; the category switch also exposes Capabilities, Tools, and Skills. Capability results are source-registered modules. Tool and Skill results contain standalone packages only. Selection inserts a typed `prompt_reference` atom with a stable Asset, module, Tool, or Skill identity and a cosmetic display name.

Both pickers are scoped to the active workspace request. Media and Artifact results include current-workspace Assets plus authorized user-, current-organization-, and principal-scoped entries. They never include workspace-scoped Assets from another workspace or Assets from another organization. Capability modules, standalone Tools, and Skills use the current user, current workspace organization, global scope, and explicit principal grants; organization memberships unrelated to the active workspace are excluded. Empty-query recents are reauthorized against the same boundary before display.

The authoritative submitted conversation document is the reference source of truth. After acquiring the conversation lease, the API extracts atoms from the latest user message and reauthorizes each identity against the active workspace scope. A stale or forged atom naming a sibling-workspace or foreign-organization Asset is rejected before Blob or document resolution. The browser does not send a parallel capability-reference list. Media references can point to an Asset without adding it to the canvas; an optional `nodeId` is present only when the user selected a current-workspace placement.

The right-side Capability panel lists authorized standalone packages for inspection and attachment. Top-level modules are selected through `/` or the Capabilities category in `@`. The package catalog client and NATS API also expose manifest details, dependency names, input schemas, and detached Tool-run operations. The side-panel inspector does not render a Run form.

A Tool can start in four ways:

1. An attached Tool with `executionPolicy: 'required'` runs before the reasoning model streams.
2. An attached `model-choice` Tool becomes a model function for that turn.
3. A reasoning model calls `search_capabilities`, then `use_capability`.
4. An authorized client publishes a detached run request through the Capability Run API.

Every path resolves and authorizes the same package graph. A detached run and a prompt-originated run use the same dispatcher, workflow runner, event log, cancellation path, and output rules.

Explicit image chips become authorized Asset IDs only when the selected Tool declares a compatible Asset-ID input. Transient image and video provider instances do not receive Capability model functions.

## Resolution and sealed execution

The resolver batch-authorizes catalog rows, captures each manifest hash, verifies content hashes and schemas, and walks references in deterministic order. It rejects:

- missing, disabled, or unauthorized packages
- a reference whose declared kind does not match the target
- dependency cycles
- dependency depth above 8
- more than 64 resolved packages
- more than 128 resolved resources
- workflows that name an unregistered action

The resulting `ResolvedCapabilityPlan` records every Capability ID and manifest hash. A catalog edit swaps the pointer for later runs but cannot change an in-flight plan. Superseded manifest and resource references remain readable for the configured retirement grace period.

## Source layout

The reusable runtime, service adapters, and concrete modules have separate dependency boundaries:

```text
packages/lixpi/capability-system/
  src/
    shared/                       cross-runtime validation, limits, schemas, errors
    backend/                      resolver, registry, runner, dispatcher, module/package contracts
    frontend/                     transport-injected catalog client, cache, ranking, validation
    capabilities/
      <module-id>/
        shared/                   cross-runtime contracts and validation
        backend/                  concrete orchestration and package-owned ports
        frontend/                 optional browser behavior
        tools/                    Tool package installers, schemas, resources
        skills/                   Skill package installers and instructions

services/api/src/
  capability-system/             API storage, NATS, LangGraph, and seeding adapters
  installed-capabilities.ts      built-in composition root
```

{% callout type="important" %}
A concrete Capability is one self-contained module. Do not create a capability runtime under `services/api` or another consuming service. Put capability-specific prompts, policy, orchestration, scheduling, retry, assessment, composition, trace construction, and cleanup under `capabilities/<module-id>/`. Define typed ports there for the infrastructure the host must supply.
{% /callout %}

`@lixpi/capability-system` contains the reusable system. `shared` is safe in the browser and backend. `backend` contains `CapabilityModuleDefinition`, Tool/Skill package installer contracts, manifest and resource resolution, action and media-strategy registries, DAG and workflow runners, dispatch, instruction-Skill construction, and provider-neutral model-tool conversion. Concrete module backends live under `capabilities/<module-id>/backend`; generic backend primitives do not import them. The package accepts application services through typed ports and never imports a consuming service.

`services/api/src/capability-system/` supplies those injected adapters. It connects the package to DynamoDB-backed catalog models, Blob storage, Capability run records, JetStream events, chat event mirroring, LangGraph state, selected media providers, and internal NEX requests. Provider files consume the same model-tool definitions from the package; provider-specific SDK payload conversion does not fork Capability resolution or execution.

`services/web-ui` imports the transport-injected catalog client from `@lixpi/capability-system/frontend` and manifest validation from `@lixpi/capability-system/shared`. Its authentication, concrete NATS transport, Nano Stores state, and UI remain application code.

Every direct module directory has an `index.ts` that exports one `CapabilityModuleDefinition`. A module must own its declared entry package and may contain any number of additional Tool or Skill packages. A module that needs deep media integration publishes its own strategies through `mediaStrategies` and defines every required application dependency as a typed port. `installed-capabilities.ts` binds those ports and registers each definition once; `CapabilityModuleCatalog` installs the module-owned strategies into the generic media registry.

The generic media-strategy execution context carries one shared request state: the complete authoritative prompt, all accumulated sibling Capability instructions and references, and every resolved Capability output. A plan-owning strategy must consume relevant contributions from that state instead of treating its own Tool output as the entire request. This is how multiple Capabilities selected in one prompt compose into one media result without moving concrete Capability logic into the API.

## Add a standalone Skill

A standalone Skill is a normal stored Skill manifest saved with `catalogExposure: 'standalone'` and no `parentModuleId`. Store its resources through the Capability resource path, build and validate the manifest, then save it through the catalog-management API. `createInstructionSkillPackage()` is for package installers owned by a source-registered module; it always receives module-internal membership from the module catalog during seeding.

## Add a standalone Tool

A standalone Tool needs three pieces:

1. Registered actions.
2. Input and output schema resources.
3. A Tool manifest whose workflow names only those registered actions.

Save the Tool record with `catalogExposure: 'standalone'` and no `parentModuleId`. Generated visual-style Tools use this path. Executable action code still has to be compiled into the API and registered in the server allowlist; saving a manifest cannot install an action.

Action keys should be namespaced to the module, such as `metadata-audit.inspect`. The action's `authorize` function must verify the expected root Tool and requester context. Keep raw credentials, arbitrary URLs, source code, and provider secrets out of manifests and workflow values.

## Add a multi-package Capability module

Use a first-class module when one product behavior needs executable orchestration plus reusable instruction packages.

1. Choose a stable module ID, entry package ID, and IDs for every supporting package.
2. Put each Skill in `skills/<skill-id>/` with its own `SKILL.md` and seeding adapter.
3. Export all Skill modules from `skills/index.ts`.
4. Put Tool schemas, action registration, workflow definition, resources, and implementation code under `tools/`.
5. Add Skill references to the Tool manifest.
6. Add a complete `descriptionSheet` to the `CapabilityModuleDefinition`.
7. Put all concrete backend orchestration under the module's `backend/` directory. Do not create a runtime directory in a consuming service. If the module needs application infrastructure, define package-owned ports and publish the owned strategy through `mediaStrategies`.
8. Export the definition from the module root. Its entry and every installer are persisted with `catalogExposure: 'module-internal'` and the module's `parentModuleId`.
9. Bind only the required platform ports and register the module definition once in `installed-capabilities.ts`.

If the Tool augments media generation, also declare the shared media-generation output contract in its action result, output schema, and workflow outputs. The generic router owns dispatch and settlement; the concrete module owns its plan validation and media policy.

Startup follows this order:

1. Construct and validate the module catalog.
2. Install module-owned media strategies into the host registry.
3. Register actions from every Tool package installer.
4. Capture the complete allowlisted action set.
5. Seed module-internal Skill packages.
6. Seed module-internal Tool packages.

Skills are seeded before Tools so Tool references resolve against installed Skill packages. Runtime dependency resolution remains kind-neutral, so a Tool or Skill may reference either kind without merging their package identities.

## Generated Capabilities

A registered action can save a new user or organization Capability at runtime. Style Extraction uses this path to create organization-scoped `visual-style` Tools. Generated packages use the same manifest validation, Blob storage, catalog metadata, grants, resolver, and prompt attachment flow as built-ins.

Generated Tools can call only actions already present in the server allowlist. Saving a manifest does not install new executable code.

## Scopes, permissions, and visibility

Within an active workspace, Capability catalog visibility is the authorized union of:

- `user#<userId>`
- `organization#<activeWorkspaceOrganizationId>`
- `global#system`
- explicit `principal#<userId>` projections

Catalog rows contain metadata and the manifest pointer. Search never returns Object Store coordinates or Capability bodies. Authorized manifest and resource reads happen after catalog authorization.

User and organization packages store resources in the organization Blob bucket. Deployment-owned global packages use the system bucket. Global mutation requires server authority.

## Built-in modules

### Style Extraction

Style Extraction lives under `packages/lixpi/capability-system/src/capabilities/style-extraction/`. Its module-internal entry Tool routes source images, selects visual axes, runs applicable specialists with bounded concurrency, materializes source evidence, synthesizes a visual contract, generates samples, validates the result, and saves an organization-scoped standalone `visual-style` Tool. Router, axes, and synthesis are separate module-internal Skills. See [Style Extraction Tool](./STYLE-EXTRACTION-TOOL.md).

### Character Creator

Character Creator lives under `packages/lixpi/capability-system/src/capabilities/character-creator/`. Its module-internal entry Tool validates the request and builds a typed provider-neutral plan for 3 to 10 shots. Separate module-internal Skills define the dependency graph, reference fidelity, and per-panel prompt rules.

The Tool does not select a hidden media model or generate an Asset itself. The selected reasoning and image-model matrix remains authoritative. The media strategy reauthorizes canonical/original sources, analyzes structured evidence, generates and checks isolated panels, and assembles the final PNG with owned deterministic layout code. The final image settles through ordinary Asset and canvas paths. Character Creator excludes video generation. See [Character Creator](./CHARACTER-CREATOR.md).

### Action Timeline

Action Timeline lives under `packages/lixpi/capability-system/src/capabilities/action-timeline/`. Its entry Tool runs once per selected reasoning model, ignores persistent image/video selections, extracts duration and precision from authoritative prompt text, writes a server-owned timing grid in sequential token-budgeted batches, and persists one reusable `capabilityArtifact` Asset per successful model variant. Its timing-grid, segment-writing, and reference-fidelity Skills are module-internal. The module owns all Artifact-specific schema, validation, serialization, editor, picker, library, info, and replay factories; explicit `/` selection uses the same generic module badge as other Capabilities and mounts no parameter form. See [Action Timeline](./ACTION-TIMELINE.md).

## Storage and operations

Capability manifests, Markdown, JSON Schemas, images, and generated visual-style samples are independent content-addressed Blobs. Capability runs have a DynamoDB run index and a per-workspace JetStream event log. See [Capability Storage and Operations](./CAPABILITY-STORAGE.md) for storage keys, sealed runs, backup, restore, repair, and garbage collection.
