---
title: Character Creator
description: How the Character Creator Capability module adds a fixed character-sheet contract to the ordinary image-model matrix and branch-lineage pipeline.
---

# Character Creator

Character Creator is a built-in Capability module for character design requests. It does not own a separate generation pipeline. Its Tool prepares a provider-neutral visual brief and layout reference, then the normal selected-model matrix performs image generation, Asset settlement, and canvas lineage.

## Module composition

The module lives at `packages/lixpi/capability-system/src/capabilities/character-creator/` and installs four runtime Capability packages through API-owned adapters:

| Package | Visibility | Responsibility |
|---|---|---|
| `global.character-creator` Tool | Module-internal entry | Validates the request and returns media-generation instructions and reference images. |
| Character Sheet Layout Skill | Module-internal | Defines the fixed cell order, labels, framing, scale, and background. |
| Reference Fidelity Skill | Module-internal | Defines identity, construction, material, and conflict-resolution rules for source references. |
| Character Image Prompt Skill | Module-internal | Defines how to assemble one provider-neutral prompt for a single sheet image. |

The Tool also stores `character-sheet-example.jpg` as an immutable example resource. Every package carries `parentModuleId: 'character-creator'` and `catalogExposure: 'module-internal'`. They remain independently stored and resolved, but none appears on standalone Tool or Skill surfaces; the module is the only user-facing entry point.

## Activation

Character Creator becomes active when either condition is true:

- The prompt contains an explicit Character Creator module reference selected through `/` or the `@` Capabilities category.
- The request router recognizes a character creation, character design, character sheet, model sheet, or turnaround request and adds the same Tool reference.

The Tool uses `executionPolicy: 'required'`, so it runs during shared preflight before the reasoning-model matrix fans out.

## Tool workflow

The live manifest has two steps:

| Step | Action | Result |
|---|---|---|
| Validate request | `character.validate-request` | Trims the prompt, removes duplicate Asset IDs, enforces the 8-reference limit, and rejects invalid input. |
| Build character prompt | `character.build-prompt` | Combines the three Skill resources, the user request, the reference count, and the one-shot example into `mediaGenerationMode`, `preserveUserPrompt`, `visualInstructions`, `referenceImages`, and `referenceImageTraceUrls`. |

The Tool sets `mediaGenerationMode` to `character-creator` and `preserveUserPrompt` to `true`. The abstract Capability runtime forwards these module-owned values through the generic media-generation output contract. It does not name Character Creator or inspect the Tool's Capability ID. The output is generation context, not an image, and contains no generated Asset ID. This boundary keeps model selection, fanout, metering, lineage, provider invocation, and Asset settlement in the ordinary media path.

## Source and layout references

Explicit media prompt references become `referenceAssetIds` only after the API reads the authoritative conversation atom and authorizes its Asset identity. Asset-only references do not need canvas placements. The Capability Tool returns the packaged layout example separately. The image router combines both groups through `buildImageGenerationReferences()`:

1. source references with role `character-source`
2. Capability resources with role `character-layout-example`

`resolveImageGenerationReferences()` resolves each entry to bytes once, determines its media type, normalizes its filename, measures its size, and computes its SHA-256 hash. The normalized collection is stored in `resolvedImageGenerationReferences` before an image-provider workflow runs.

Current and future image-provider adapters must consume that shared resolved collection. They must not rebuild Character Creator references from provider-specific message blocks. This single path keeps source images and the sheet template in the same order for OpenAI, Google, Stability, and later providers.

Source references control both character identity and rendering class. Photographic sources require photorealistic character depictions with recognizable facial likeness, natural anatomy, real skin and hair detail, photographic materials, and physically coherent studio lighting. The illustrated character inside the packaged layout is a negative style reference; only its layout, panels, guides, labels, and view placement may influence the output.

Reference-conditioned runs use a second bounded restoration edit. The generated draft controls composition but its character pixels are disposable placeholders. The restoration edit may completely replace every character depiction to recover source identity and medium while keeping the non-character sheet structure unchanged. The NEX model-synchronization workload records each model's effective image-input fidelity. The router rejects a selected model before provider invocation unless that routed metadata declares `level: high`; provider-specific request values come from the same record.

The Character Creator action logs the packaged layout resource ID, byte length, hash, manifest hash, and source Asset IDs. The shared resolver logs role, filename, byte length, media type, and hash at provider ingress. These two log points prove whether the exact Capability resource reached the media adapter.

## Model matrix and video exclusion

The selected reasoning and image-model controls remain authoritative:

- one selected reasoning model and one selected image model produce one image run
- multiple selected reasoning or image models produce the ordinary matrix fanout
- Character Creator removes video models, video options, and video replay prompts before normalization
- provider adapters suppress `generate_video` while `capabilityUsageMode` is `character-creator`

Character Creator never asks the reasoning model to choose an unselected image or video model.

## Branch lineage and Asset settlement

Shared preflight forwards the complete Capability patch to every reasoning child. That patch includes the visual instructions, Capability reference images, usage mode, and trace URLs. The media matrix then:

1. builds the normal lineage plan from the selected model axes
2. creates pending output Assets and canvas assignments
3. sends each child through the normal reasoning and image-provider workflow
4. settles partial and final media through the shared generated-Asset path
5. publishes ordinary media completion events

The browser renders the API-owned branch markers and generated media. Character Creator does not create an extra branch marker, attach a generated Asset directly, or maintain a second canvas progress node.

## Fixed sheet contract

The packaged Skills request one landscape image with these cells in order:

1. portrait
2. front full-height view
3. left full-height profile
4. right full-height profile
5. back full-height view
6. three-quarter full-height view
7. walking full-height view

Every full-height cell uses the same scale and identity. The prompt forbids cropped feet, extra characters, alternate outfits, scenery, logos, watermarks, and additional panels.

## Related pages

- [Tools, Skills, and Capability Modules](./TOOLS-AND-SKILLS.md)
- [AI Generation Pipeline](../platform/AI-GENERATION-PIPELINE.md)
- [Image Generation](../media-generation/IMAGE-GENERATION.md)
- [Branch Lineage](../media-generation/BRANCH-LINEAGE.md)
