---
title: Style Extraction Pipeline
description: The Style Extraction Tool's router, parallel specialists, source evidence crops, synthesis, sample generation, validation, and visual-style output.
---

# Style Extraction Pipeline

Style Extraction is a built-in Capability module executed through the generic Capability workflow runner. Its self-contained source lives under `services/api/src/capability-modules/style-extraction/`. The `tools/` side contains the module-internal entry Tool manifest, schemas, action bindings, input resolver, complete specialist pipeline, and tests. The sibling `skills/` side contains module-internal router, axes, and synthesis Skills, each with its own `SKILL.md` and stable package ID. The manifest owns ordering, conditions, value bindings, and progress labels. Registered TypeScript actions retain the specialist algorithms, validators, Asset authorization, provider calls, sample generation, and persistence rules.

## Public input

The Tool accepts:

```ts
type StyleExtractionInput = {
  intent?: string
  sourceAssetIds: string[]
  analysisModelId: string
  imageModelId?: string
}
```

The initialize action authorizes the workspace and every source Asset, chooses model-safe renditions, loads bytes through the Blob registry, and resolves model metadata. Browser-supplied Object Store coordinates and inline source bytes are rejected.

## Workflow stages

| Stage | Registered action | Behavior |
|---|---|---|
| Initialize | `style.initialize` | Authorize inputs, load source references, and construct internal extraction state. |
| Route | `style.route` | Analyze the scene, resolve explicit intent, and score axis dominance. |
| Extract axes | `style.extract-axis` | Run applicable specialists with a concurrency cap of four. Non-applicable axes emit `STEP_SKIPPED`; one failed specialist does not discard successful axes. |
| Materialize crops | `style.materialize-crops` | Create subject-detail, region, and composition evidence in parallel where dependencies permit. |
| Merge | `style.merge-analysis` | Combine scene assessment, axis output, failures, and crop evidence. |
| Synthesize | `style.synthesize` | Produce name, summary, tags, instructions, parameters, negative constraints, and sample recommendations weighted by dominance. |
| Generate samples | `style.generate-samples` | Build required palette boards, texture specimens, and applied-medium probes through authorized provider paths. |
| Persist | `style.persist` | Validate the visual contract and save a scoped `visual-style` Tool through `capability.save`. |

## Axis specialists

The registry includes palette, medium signature, character design, lighting, composition, mood, background treatment, edge treatment, line quality, and surface texture. Each specialist owns a structured schema and validator. Character design is skipped when no subject is present. Surface and edge axes are skipped when router evidence says they are not applicable.

Ready axis steps execute in parallel, bounded to four active specialists. Crop materialization can overlap with independent analysis work. The generic runner persists actual pending, running, skipped, failed, cancelled, and completed states instead of presenting a sequential approximation.

## Style reference isolation

The result captures reusable visual behavior while reducing accidental source reuse. Detail crops preserve material, edge, texture, and subject-rendering evidence without always retaining the entire source frame. The crop stage also creates a downscaled full-frame `composition-evidence` sample for each source. Generated neutral probes demonstrate the synthesized medium and parameter contract. Palette-dominant output includes deterministic swatches and roles.

The synthesized Tool instructions include negative constraints for rejected training-prior tropes. A digital cel-shaded input, for example, can explicitly forbid paper tooth and wash artifacts even if a model associates the palette with watercolor.

See [Style Reference Isolation](./ANTI-LEAKAGE.md) for the crop behavior, provider path, and isolation limits.

## Output

Persistence creates a normal Capability with `toolType: visual-style`. Its manifest stores the visual contract and ordered sample resources as content-addressed Blobs. The registered `visual-style.apply` action returns the generic media-generation output fields with `mediaGenerationMode: visual-style`, sealed instructions, authorized images, and trace URLs for downstream image or video generation.

Discovery, scope, grants, rename behavior, deletion, and prompt attachment all use the common Capability catalog. Persistence writes a `visual-style` Tool rather than introducing a separate storage model.

## Progress and recovery

Every step emits a safe `CapabilityRunEvent` after durable append. Router and synthesis reasoning can appear as separate safe text, but the generic event log is authoritative for state. Chat-originated runs mirror the event into the conversation pipeline. Detached clients subscribe to the tokenized live subject before replay, then deduplicate by run sequence.

Reloading the workspace reconstructs progress from the Capability run index and JetStream event log. There is no extraction-specific session record.

## Related pages

- [Style Extraction Tool](./STYLE-EXTRACTION-TOOL.md)
- [Tools and Skills](./TOOLS-AND-SKILLS.md)
- [Capability Storage and Operations](./CAPABILITY-STORAGE.md)
- [Streaming and Events](../platform/STREAMING-AND-EVENTS.md)
