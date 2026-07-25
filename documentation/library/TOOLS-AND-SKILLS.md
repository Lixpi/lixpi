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

A **Capability module** is a source-registered product behavior. It has a stable `moduleId`, presentation metadata, exactly one owned entry package, and an explicit set of Tool and Skill package installers. Character Creator and Style Extraction are modules.

A **Capability package** is one stored record with `kind: 'skill'` or `kind: 'tool'`. Every package has its own immutable ID, manifest, resources, permissions, and manifest hash. Packages are either:

- `module-internal`, with a required `parentModuleId`; or
- `standalone`, with no parent module.

All packages owned by a module, including its entry package, are `module-internal`. The module is the only row shown on the Capability surface. Standalone packages remain directly selectable on the Tool or Skill surfaces. The API enforces this boundary before serialization; clients do not infer containment from names, folders, or tags.

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
| `resources` | Content-addressed Markdown, JSON, JSON Schema, image, example, or Asset resources. |
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
- examples and reference images
- JSON configuration
- JSON Schemas
- references to other Skills or Tools
- named instruction exports

A Skill does not register API actions. When the resolver includes it in a plan, its authorized resources can be added to model context or bound into a Tool workflow.

Use a module-internal Skill when it exists only to support a module. Use a standalone Skill when users or models should attach it directly. Module membership is structural: internal packages use `catalogExposure: 'module-internal'` and a required `parentModuleId`; standalone packages use `catalogExposure: 'standalone'` and no parent.

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

The module must include these fields in its output schema and workflow output bindings. The abstract Capability runtime validates the shape and forwards it without importing or naming the module. Provider adapters consume the single normalized `resolvedImageGenerationReferences` collection produced later by the media pipeline.

This boundary is important for extension. Adding another media-generation Tool requires a module-owned output mode and a media-policy implementation. It must not add provider-specific reference assembly or a concrete module check to `@lixpi/capability-system`.

## How users and models select modules and packages

Typing `/` at a prompt token boundary opens the module picker. It lists top-level Capability modules only; it has no formatting, upload, Tool, or Skill commands.

Typing `@` opens the media-first prompt-reference picker. Media is the default category; the category switch also exposes Capabilities, Tools, and Skills. Capability results are source-registered modules. Tool and Skill results contain standalone packages only. Selection inserts a typed `prompt_reference` atom with a stable Asset, module, Tool, or Skill identity and a cosmetic display name.

The authoritative submitted conversation document is the reference source of truth. After acquiring the conversation lease, the API extracts atoms from the latest user message and reauthorizes each identity. The browser does not send a parallel capability-reference list. Media references can point to an Asset without adding it to the canvas; an optional `nodeId` is present only when the user selected a current-workspace placement.

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

services/api/src/
  capability-system/             API storage, NATS, LangGraph, and seeding adapters
  capability-modules/
    <module-id>/
      index.ts                    module entry point
      tools/                      Tool package installers and implementations
        index.ts
      skills/                     Skill package installers and resources
        index.ts
        <skill-id>/
          index.ts
          SKILL.md
  installed-capabilities.ts      built-in composition root
```

`@lixpi/capability-system` contains the reusable system. `shared` is safe in the browser and backend. `backend` contains `CapabilityModuleDefinition`, Tool/Skill package installer contracts, manifest and resource resolution, the action registry, workflow runner, dispatcher, instruction-Skill construction, and provider-neutral model-tool conversion. The package accepts catalog search, Blob access, run persistence, event naming, and event mirroring as injected adapters. It does not import a service or name a concrete module.

`services/api/src/capability-system/` supplies those injected adapters. It connects the package to DynamoDB-backed catalog models, Blob storage, Capability run records, JetStream events, chat event mirroring, and LangGraph state. Provider files consume the same model-tool definitions from the package; provider-specific SDK payload conversion does not fork Capability resolution or execution.

`services/web-ui` imports the transport-injected catalog client from `@lixpi/capability-system/frontend` and manifest validation from `@lixpi/capability-system/shared`. Its authentication, concrete NATS transport, Svelte state, and UI remain application code.

Every direct module directory has an `index.ts` that exports one `CapabilityModuleDefinition`. A module must own its declared entry package and may contain any number of additional Tool or Skill packages. `installed-capabilities.ts` is the built-in composition root and registers each definition once with `CapabilityModuleCatalog`.

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
6. Export one `CapabilityModuleDefinition` from the module root. Its entry and every installer are persisted with `catalogExposure: 'module-internal'` and the module's `parentModuleId`.
7. Register the module definition once in `installed-capabilities.ts`.

If the Tool augments media generation, also declare the shared media-generation output contract in its action result, output schema, and workflow outputs. Keep the mode value and its policy implementation outside the abstract Capability runtime.

Startup follows this order:

1. Construct and validate the module catalog.
2. Register actions from every Tool package installer.
3. Capture the complete allowlisted action set.
4. Seed module-internal Skill packages.
5. Seed module-internal Tool packages.

Skills are seeded before Tools so Tool references resolve against installed Skill packages. Runtime dependency resolution remains kind-neutral, so a Tool or Skill may reference either kind without merging their package identities.

## Generated Capabilities

A registered action can save a new user or organization Capability at runtime. Style Extraction uses this path to create organization-scoped `visual-style` Tools. Generated packages use the same manifest validation, Blob storage, catalog metadata, grants, resolver, and prompt attachment flow as built-ins.

Generated Tools can call only actions already present in the server allowlist. Saving a manifest does not install new executable code.

## Scopes, permissions, and visibility

Catalog visibility is the authorized union of:

- `user#<userId>`
- `organization#<organizationId>`
- `global#system`
- explicit `principal#<userId>` projections

Catalog rows contain metadata and the manifest pointer. Search never returns Object Store coordinates or Capability bodies. Authorized manifest and resource reads happen after catalog authorization.

User and organization packages store resources in the organization Blob bucket. Deployment-owned global packages use the system bucket. Global mutation requires server authority.

## Built-in modules

### Style Extraction

Style Extraction lives under `services/api/src/capability-modules/style-extraction/`. Its module-internal entry Tool routes source images, selects visual axes, runs applicable specialists with bounded concurrency, materializes source evidence, synthesizes a visual contract, generates samples, validates the result, and saves an organization-scoped standalone `visual-style` Tool. Router, axes, and synthesis are separate module-internal Skills. See [Style Extraction Tool](./STYLE-EXTRACTION-TOOL.md).

### Character Creator

Character Creator lives under `services/api/src/capability-modules/character-creator/`. Its module-internal entry Tool validates the request and builds a provider-neutral character-generation brief with an authorized layout example. Separate module-internal Skills define sheet layout, reference fidelity, and image-prompt rules.

The Tool does not select a hidden media model or generate an Asset itself. The selected reasoning and image-model matrix remains authoritative. The normal media pipeline receives the Tool output, allocates branch lineage, sends the source and layout references through the shared provider-neutral reference resolver, and settles every variant through ordinary Asset and canvas paths. Character Creator excludes video generation. See [Character Creator](./CHARACTER-CREATOR.md).

## Storage and operations

Capability manifests, Markdown, JSON Schemas, images, and generated visual-style samples are independent content-addressed Blobs. Capability runs have a DynamoDB run index and a per-workspace JetStream event log. See [Capability Storage and Operations](./CAPABILITY-STORAGE.md) for storage keys, sealed runs, backup, restore, repair, and garbage collection.
