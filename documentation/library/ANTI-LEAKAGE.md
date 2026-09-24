---
title: Style Reference Isolation
description: How Style Extraction preserves visual evidence while reducing accidental subject and composition reuse.
---

# Style Reference Isolation

Style Extraction must preserve enough source evidence for a media model to reproduce a visual treatment without treating the source scene as the requested output. The implementation reduces that risk with bounded crops, neutral probes, explicit instructions, and traceable Capability resources.

This is risk reduction, not a mathematical guarantee. The current implementation also keeps a downscaled composition sample when composition is part of the extracted style. That sample intentionally preserves the full frame and can carry recognizable source structure. Consumers that require strict subject isolation must exclude resources whose `cropRegion.purpose` is `composition-evidence`.

## Evidence created during extraction

The Style Extraction router receives every authorized source image and returns:

- normalized subject bounding boxes and salience ranks
- normalized non-subject region bounding boxes
- a medium classification
- per-axis dominance scores
- intent resolution and concrete negative constraints

The crop stage uses that assessment to create four kinds of evidence:

| Evidence | Source area | Purpose |
|---|---|---|
| Subject-detail crop | A deterministic square inside a subject box | Preserve line, shading, mark, anatomy, and rendering details without always carrying the whole subject. |
| Region crop | A deterministic square inside a background or other region | Preserve texture, material, palette, and edge behavior. |
| Composition sample | The full source frame, downscaled to fit within 512 by 512 pixels | Preserve composition when composition is part of the requested style. |
| Generated sample | A deterministic palette or texture board, or a provider-rendered neutral probe | Demonstrate the synthesized style contract. |

Subject and region crops must have at least 128 pixels on each axis. Crop positions are deterministic for the Style Extraction run ID and source reference. Large detail crops are resized to fit within 1024 by 1024 pixels. Every materialized crop is encoded as PNG and stored as an organization Blob.

The stored metadata includes the source image reference, pixel rectangle, label, and one of these purposes:

- `texture-evidence`
- `applied-medium-evidence`
- `subject-detail-evidence`
- `composition-evidence`

## Applied-medium probes

When the request includes an image model, the sample stage can ask that selected model to render a neutral subject. The provider-neutral image router receives:

- the synthesized style instructions
- the synthesized category, name, and summary
- the neutral sample prompt
- up to four materialized source crops
- an instruction that forbids copying subject identity, pose, layout, or composition from the crops

The router converts the same `referenceImages` collection into the provider-specific request format. Style Extraction does not select a hidden provider or model. If no image model is selected, applied-medium probes are skipped. Palette boards and texture specimens remain deterministic `sharp` output.

## Persisted visual-style Tool

The persistence stage stores these resources in stable order:

1. all source crops, including composition samples
2. all generated samples

It then creates an organization-scoped Tool whose `toolType` is `visual-style`. The Tool also stores the synthesized Markdown instructions and JSON configuration. The configuration records source Asset IDs and sample metadata, but downstream consumers receive only the sealed resources, not arbitrary browser paths or source bytes.

Running the Tool invokes `visual-style.apply`. That action returns:

- `visualInstructions`, built from the stored instructions and configuration
- `referenceImages`, built from every stored sample resource
- `referenceImageTraceUrls`, which identify the exact Capability resource and manifest hash used

The normal media-generation pipeline consumes this provider-neutral result. Provider adapters do not implement separate Style Extraction behavior.

## Isolation limits

The following constraints matter when evaluating the result:

- A subject-detail crop can still contain identifiable traits.
- A composition sample deliberately contains the complete source layout.
- A provider can follow visual references differently even when it receives the same normalized reference set.
- Prompt instructions reduce copying pressure but cannot guarantee disentanglement in a closed provider model.
- A generated neutral probe can inherit source traits and is itself stored as later reference evidence.

For strict isolation, filter out `composition-evidence`, inspect subject-detail crops, and use only region crops or approved probes. The current `visual-style.apply` action does not apply that filter automatically.

## Verification points

Use Capability run traces and persisted configuration to verify the full path:

1. `style.initialize` resolved the expected source Asset IDs.
2. `style.route` returned one assessment entry per reference.
3. `style.materialize-crops` produced Blob-backed evidence with crop metadata.
4. `style.generate-samples` attached source crops when it called the selected image model.
5. `style.persist` stored the ordered resources in the generated Tool.
6. `visual-style.apply` returned the expected reference count and trace URLs.
7. The media provider received the normalized references returned by the Tool.

## Related pages

- [Style Extraction Pipeline](./STYLE-EXTRACTION-PIPELINE.md)
- [Style Extraction Tool](./STYLE-EXTRACTION-TOOL.md)
- [Tools, Skills, and Capability Modules](./TOOLS-AND-SKILLS.md)
- [Capability Storage and Operations](./CAPABILITY-STORAGE.md)
