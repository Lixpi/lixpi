---
title: Character Creator
description: How Character Creator plans configurable identity-focused shots, publishes progressive sheets, compares them with source evidence, and preserves manual variants.
---

# Character Creator

Character Creator is the built-in Capability module for character design, model-sheet, and turnaround requests. It uses the selected reasoning and image-model matrix. It does not choose a hidden model or bypass normal Asset settlement and lineage.

The Tool produces a provider-neutral `CharacterSheetRenderPlan`. Its package-owned backend runtime renders isolated shots, compares them with structured source evidence, and uses deterministic Sharp/SVG code to assemble one 3840x2560 PNG. Each provider request renders one shot; the provider never renders the sheet layout or labels.

## Module composition

The module lives at `packages/lixpi/capability-system/src/capabilities/character-creator/` and installs four module-internal packages:

| Package | Responsibility |
|---|---|
| `global.character-creator` Tool | Validates the prompt and up to eight source Asset IDs, then emits the typed render plan. |
| Character Sheet Layout Skill | Defines the configurable shot graph, one-attempt policy, and deterministic composition contract. |
| Reference Fidelity Skill | Defines observed evidence, inference, conflict resolution, and identity-preservation rules. |
| Character Image Prompt Skill | Defines provider-neutral prompts for one isolated shot and comparison reporting. |

Every package carries `parentModuleId: 'character-creator'` and `catalogExposure: 'module-internal'`. The module is the only user-facing catalog entry.

## Activation and preflight

Character Creator becomes active when the prompt contains an explicit module reference or the router recognizes a character creation request. Its Tool uses `executionPolicy: 'required'`, so it runs before the reasoning-model matrix fans out.

The manifest has two steps:

| Step | Action | Result |
|---|---|---|
| Validate request | `character.validate-request` | Trims the prompt, removes duplicate Asset IDs, enforces the eight-reference limit, and rejects invalid input. |
| Build render plan | `character.build-render-plan` | Returns `mediaGenerationMode`, `preserveUserPrompt`, and a validated `capabilityMediaExecutionPlan`. |

The plan carries the Capability run ID, source Asset IDs, user prompt, layout ID, zero semantic retries, and 3 to 10 shot specifications. The API installs the module strategy through `CapabilityModuleCatalog`, and `ImageRouter` delegates the plan by kind without importing Character Creator.

The API supplies typed platform adapters for authorized Asset reads, transient Object Store access, selected-provider image calls, structured VLM transport, NEX fidelity requests, progressive image publication, and durable run progress. Character-specific evidence, graph, assessment, prompt, composition, trace, and cleanup logic stays inside the module directory.

## Configurable shot graph

The default run contains exactly three shots and at most three paid image-provider calls:

| Shot | Purpose |
|---|---|
| Front face detail | Straight-on, clearly lit close-up with the face large enough to inspect identity details. |
| Front body | Neutral full-body front view from head to footwear. |
| Three-quarter body | Full-body three-quarter back view showing silhouette, outfit construction, and footwear. |

The face and front-body shots render in parallel. The three-quarter body shot uses both as consistency anchors. This creates one shallow dependency edge instead of a long sequential turnaround chain.

Free-form prompt text can request a total from 3 to 10 shots. Additional slots are prioritized by the requested subject matter: belongings or props, facial expressions, profile and back views, face angles, and action poses. For example, “make 5 shots with belongings and facial expressions” adds those subjects before generic turnaround coverage. A 10-shot request can use the complete optional catalog. Cost and latency scale with the requested count.

Every planned shot gets one generation attempt. Transport failure, moderation, comparison failure, or low fidelity never starts a replacement provider call automatically.

## Progressive results and failure surfacing

The durable media-generation run reports four phases: preparation, rendering, assessment, and composition. The canvas operation card shows the current message and completed-shot count. Those updates are persisted and recovered after reconnect rather than living only in process memory.

After each shot reaches a terminal render result, the compositor publishes a new partial sheet on the preassigned output Asset. Rendered cells show their current pixels. Failed cells are marked unavailable, pending cells remain marked waiting, and dependent shots continue with whichever planned anchors rendered successfully. Presentation failures cannot invalidate already-rendered work.

After all render nodes settle, the runtime compares every assessable shot with source evidence and accepted anchors. The final sheet and image-generation trace show match scores, failed dimensions, unavailable comparisons, and unavailable shots. Comparison is advisory: pixels are preserved even when they need review.

If no shot renders, the run fails visibly. Otherwise the runtime publishes the best partial sheet it can assemble and marks missing or questionable cells for review.

## Manual variants and branch lineage

The runtime always records `automaticRetries: 0`. A comparison issue recommends keeping the current candidate or explicitly generating another variant. The existing candidate remains on the canvas.

An explicit “Regenerate” action replays the request as a new run. For a single output, the API verifies the sealed source provenance without requiring the source Asset to be superseded, creates a branch-continuation marker from that media node, and places the new output after it. Repeating the action produces an editing line such as candidate 1 → continuation → candidate 2 → continuation → candidate 3. The user can inspect every candidate and accept the preferred output.

Prompt regeneration remains a separate action: it creates fresh lineage because the reasoning model is asked to write a different prompt.

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

When no source exists, the generated front face and front body become canonical anchors. The final sheet discloses that identity and hidden details were inferred.

## Provider capabilities and adapters

Every synchronized image model declares `imageReferenceCapabilities`: reference and identity budgets, conditioning modes, iterative-edit and control support, input-fidelity behavior, pixel limits, and aspect ratios. Character Creator fails before shot generation when the selected model cannot perform identity conditioning.

The common graph uses provider-neutral roles such as `original-source`, `face-crop`, `body-outfit-crop`, `canonical-anchor`, `adjacent-angle`, and `prop-crop`. Provider adapters reserve identity slots first, trim optional controls to the model's declared limits, and record included and omitted roles.

- OpenAI uses the multi-image edit path and synchronized fidelity metadata.
- Google interleaves explicit role labels with image parts.
- Stability uses only the image, style, or structure controls supported by the selected endpoint. Style transfer is not treated as identity conditioning.

Provider names do not appear in the Character graph or capability-media scheduler.

## Assessment

The selected reasoning model compares each rendered shot with its target, source pixels, structured evidence, and available anchors. It scores the requested dimensions and emits concrete mismatch codes.

Photographic head-bearing shots also request the internal NEX character-fidelity workload. The workload runs pinned YuNet and SFace ONNX artifacts through single-threaded WASM, returns detections and scalar cosine similarity, and never returns or persists embeddings. Illustration and unreliable-face cases produce a typed unavailable reason instead of a fabricated score.

Evidence analysis and assessment each use a single structured-VLM attempt with no transport, truncation, or provider-fallback retry. Assessment never modifies a rendered shot and never schedules a second image attempt. Malformed VLM output, unavailable fidelity infrastructure, and threshold failures become visible comparison issues on the preserved candidate.

## Deterministic composition and settlement

The compositor uses the owned `character-sheet-layout.svg` resource and deterministic bitmap glyphs. It derives a one- or two-row grid from the requested shot count, normalizes shot pixels, draws labels and statuses, adds palette swatches and evidence notes, and includes a source-coverage disclosure.

The final PNG and review trace return to `ImageRouter`. `ImagePublisher.complete` stores the bytes on the preassigned Asset, starts renditions, attaches the API-owned canvas node, records usage and lineage, clears transient partials, and publishes the normal completion event. Intermediate isolated shot pixels never become Assets.

## Capability description card

Hovering or focusing a Character Creator prompt-reference chip opens the module's description sheet through the same context-preview component used by media references. The description explains the three-shot default, free-form 3-to-10-shot configuration, optional reference images, best reference set, best-effort identity limits, inferred regions, one-attempt policy, and scaling cost and latency.

## Related pages

- [Tools, Skills, and Capability Modules](./TOOLS-AND-SKILLS.md)
- [AI Generation Pipeline](../platform/AI-GENERATION-PIPELINE.md)
- [Image Generation](../media-generation/IMAGE-GENERATION.md)
- [Branch Lineage](../media-generation/BRANCH-LINEAGE.md)
