---
title: Style Extraction Tool
description: The built-in workflow that extracts reusable visual traits and saves them as visual-style Tools.
---

# Style Extraction Tool

Style Extraction is a global Tool implemented by the generic Capability runner. Its self-contained module under `services/api/src/capability-modules/style-extraction/` is split into `tools/` and `skills/`. The Tool definition, action bindings, input authorization, schemas, complete specialist pipeline, and tests live under `tools/`. Router, axes, and synthesis instruction packages live under `skills/`, each with its own `SKILL.md`. The Tool references those sibling Skills through its manifest and plugs into the abstract runtime through `ToolModule`; the runtime does not import Style Extraction directly.

## Workflow

The Tool performs these stages:

1. Authorize source Assets and prepare model-safe image inputs.
2. Analyze every source scene and score visual-axis dominance.
3. Run applicable axis specialists with bounded parallelism. One failed specialist is recorded without discarding successful axes.
4. Materialize subject-detail, region, and composition evidence in parallel with axis analysis.
5. Merge the axis results and crop evidence.
6. Synthesize instructions, parameters, negative constraints, and sample recommendations.
7. Generate and validate sample images.
8. Save a scoped `visual-style` Tool and its resources through `capability.save`.

The axis registry covers palette, medium signature, character design, lighting, composition, mood, background treatment, edge treatment, line quality, and surface texture. The router marks non-applicable axes so their workflow steps appear as `skipped`, not successful empty work.

## Inputs

The public Tool schema accepts an intent, source Asset IDs, a reasoning model ID, and an optional image model ID. Source bytes are never accepted from the browser. The initialize action checks workspace and organization access, reads authorized renditions through the Blob registry, and resolves model metadata from the API catalog.

## Saved visual-style Tools

The persisted Tool contains the synthesized visual contract and ordered sample resources. Its registered `visual-style.apply` action returns `mediaGenerationMode: visual-style`, `preserveUserPrompt: false`, and the instructions and authorized images required by the shared media-generation output contract. Those resources include detail crops, generated probes, and a downscaled full-frame composition sample for each source. See [Style Reference Isolation](./ANTI-LEAKAGE.md) for the exact evidence set and its limits.

Generated sample resources remain Blob-backed. Catalog search returns metadata only, and applying the Tool reads resources from the sealed plan.

## Progress

Capability run surfaces render `CapabilityRunEvent` state with the shared Tool progress renderer. Router and synthesis reasoning can emit separate safe text chunks, but generic run events are authoritative for step status. Axis steps preserve real parallel, skipped, failed, and completed states.

A reload uses the Capability run index and JetStream replay rather than an extraction-specific session record.
