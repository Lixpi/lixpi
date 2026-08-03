---
title: Character Creator
description: How Character Creator plans identity-focused panels, validates them against source evidence, and assembles a deterministic character sheet through the selected image-model matrix.
---

# Character Creator

Character Creator is a built-in Capability module for character design, model-sheet, and turnaround requests. It uses the selected reasoning and image-model matrix. It does not choose a hidden model, write a second Asset, or bypass normal lineage and settlement.

The module produces a provider-neutral `CharacterSheetRenderPlan`. Its package-owned backend runtime renders isolated character panels, validates them against structured source evidence, and uses deterministic Sharp/SVG code to assemble one 3840x2560 PNG.

## Module composition

The module lives at `packages/lixpi/capability-system/src/capabilities/character-creator/` and installs four module-internal packages:

| Package | Responsibility |
|---|---|
| `global.character-creator` Tool | Validates the prompt and up to eight source Asset IDs, then emits the typed render plan. |
| Character Sheet Layout Skill | Defines the panel dependency graph and deterministic composition contract. |
| Reference Fidelity Skill | Defines observed evidence, inference, conflict resolution, and identity-preservation rules. |
| Character Image Prompt Skill | Defines provider-neutral prompts for one isolated panel and targeted correction. |

Every package carries `parentModuleId: 'character-creator'` and `catalogExposure: 'module-internal'`. The module is the only user-facing catalog entry.

## Activation and preflight

Character Creator becomes active when the prompt contains an explicit module reference or the router recognizes a character creation request. Its Tool uses `executionPolicy: 'required'`, so it runs before the reasoning-model matrix fans out.

The manifest has two steps:

| Step | Action | Result |
|---|---|---|
| Validate request | `character.validate-request` | Trims the prompt, removes duplicate Asset IDs, enforces the eight-reference limit, and rejects invalid input. |
| Build render plan | `character.build-render-plan` | Returns `mediaGenerationMode`, `preserveUserPrompt`, and a validated `capabilityMediaExecutionPlan`. |

The plan carries the Capability run ID, source Asset IDs, user prompt, layout ID, one semantic retry limit, and 27 panel specifications. The Character Creator module definition publishes its strategy through `mediaStrategies`. The API installs module strategies through `CapabilityModuleCatalog`, and `ImageRouter` delegates the plan by kind without importing Character Creator.

The API supplies one typed platform adapter for authorized Asset reads, transient Object Store access, selected-provider image calls, structured VLM transport, and the NEX fidelity request. Character-specific evidence, graph, retry, assessment, prompt, composition, trace, and cleanup logic stays in the module directory.

## Panel graph

The base run generates 26 panels. It generates a 27th prop panel only when source analysis cannot produce a usable observed prop crop.

| Group | Provider operations |
|---|---:|
| Full-body turnaround | 5 |
| Matching head angles | 5 |
| Expression variants | 4 |
| Additional mouth variants | 4 |
| Hand close-ups | 2 |
| Conditional prop | 0 or 1 |
| Action poses | 6 |

The front body and front head establish canonical anchors. Adjacent turnaround panels depend on the closest accepted view. Head panels depend on the canonical head and matching body view. Action panels depend on the accepted body and head anchors.

Each panel receives one candidate and at most one semantic correction. The normal ceiling is therefore 52 image operations without a generated prop and 54 with one. Bounded transport retries are separate from this count. A moderation rejection is never retried with a rewritten prompt.

## Source evidence

Every source Asset is reauthorized against the active user, workspace, and organization. Character Creator resolves `canonical` first and `original` second. It never uses `preview`.

The selected reasoning model analyzes source pixels into structured evidence:

- source medium;
- observed and inferred facts for face, hair, skin, body, clothing, accessories, materials, and props;
- source regions for lossless face, body/outfit, and prop crops;
- target-angle and body-region coverage;
- palette and design notes;
- conflicts between references.

Observed facts require an authorized source and in-bounds coordinates. Explicit prompt changes override source facts. Otherwise observed evidence overrides descriptive prompt text, and evidence from the closest target angle wins. Unresolved conflicts remain in the trace.

Role-specific PNG references are written to organization-scoped transient storage. Original sources are reduced only when the selected model's declared pixel limit requires it. Every transient object is removed after success, failure, or cancellation.

When no source exists, the first accepted front head and body panels become canonical anchors. The final sheet says that its identity and hidden details were inferred.

## Provider capabilities and adapters

Every synchronized image model declares `imageReferenceCapabilities`: reference and identity budgets, conditioning modes, iterative-edit and control support, input-fidelity behavior, pixel limits, and aspect ratios. Character Creator fails before panel generation when the selected model cannot perform identity conditioning.

The common graph uses provider-neutral roles such as `original-source`, `face-crop`, `body-outfit-crop`, `canonical-anchor`, `adjacent-angle`, and `prop-crop`. Provider adapters reserve identity slots first, trim optional controls to the model's declared limits, and record included and omitted roles.

- OpenAI uses the multi-image edit path and synchronized fidelity metadata.
- Google interleaves explicit role labels with image parts.
- Stability uses only the image, style, or structure controls supported by the selected endpoint. Style transfer is not treated as identity conditioning.

Provider names do not appear in the Character graph or capability-media scheduler.

## Assessment and correction

The selected reasoning model compares each candidate with the target panel, source pixels, structured evidence, and accepted anchors. It scores the requested dimensions and emits concrete mismatch codes.

Photographic head-bearing panels also request the internal NEX character-fidelity workload. The workload runs pinned YuNet and SFace ONNX artifacts through single-threaded WASM, returns detections and scalar cosine similarity, and never returns or persists embeddings. Illustration and unreliable-face cases produce a typed unavailable reason instead of a fabricated score.

A correction prompt contains only failed dimensions and their mismatch codes. It preserves accepted dimensions and retries only that panel. When both valid candidates remain below the quality threshold, the higher-scoring candidate is accepted with a warning. A required missing, corrupt, or unsafe panel fails that matrix run. An unavailable optional prop leaves its cell blank.

## Deterministic composition and settlement

The compositor uses the owned `character-sheet-layout.svg` resource and deterministic bitmap glyphs. It normalizes panels, creates eye, mouth, and feet crops, draws labels and guides, adds analyzed palette swatches and design notes, and includes a plain source-coverage disclosure. It rejects missing required panels, corrupt pixels, the wrong output dimensions, and non-PNG output.

The final PNG and trace return to the ordinary `ImageRouter` result. The existing image publisher stores the bytes on the preassigned Asset, starts renditions, attaches the API-owned canvas node, records usage and lineage, and publishes the normal completion event. Intermediate panel pixels never become Assets.

## Capability description card

Hovering or focusing a Character Creator prompt-reference chip opens the module's description sheet through the same context-preview component used by media references. Composer and panel cards use its viewport-clamped body portal. Canvas cards use its pane portal, viewport scale, placement, dismissal, and cleanup behavior. The description explains the required prompt, optional reference images, best reference set, best-effort identity limits, inferred regions, and high cost and latency. The same contract applies to every Capability module.

## Related pages

- [Tools, Skills, and Capability Modules](./TOOLS-AND-SKILLS.md)
- [AI Generation Pipeline](../platform/AI-GENERATION-PIPELINE.md)
- [Image Generation](../media-generation/IMAGE-GENERATION.md)
- [Branch Lineage](../media-generation/BRANCH-LINEAGE.md)
