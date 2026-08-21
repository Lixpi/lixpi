---
title: Action Timeline
description: Reusable timed prompt Artifacts, multi-model generation, editing, references, storage, review, and model-input admission.
---

# Action Timeline

Action Timeline is a built-in Capability that turns a free-form request into a reusable, editable, time-segmented prompt document. Duration and precision define an immutable millisecond grid; each segment contains editable prose and inline media `@` references.

The output is a generic Capability Artifact Asset, not a chat message or video. It has `artifactTypeId: action-timeline`, schema `action-timeline-v1`, and a `capabilityArtifact` ProseMirror document. The same Asset identity is used by canvas placements, the Artifacts library, prompt references, generated-output review, and source-media retention.

## Create a timeline

Select Action Timeline with `/`, or ask for an action timeline, shot plan, storyboard timeline, or timed beats in free form. Explicit selection inserts the same compact Capability badge as every other `/` module and mounts no parameter form. Write both values in the request itself, for example `Build a 15-second action timeline with 3-second beats`:

- Duration must be greater than zero.
- Precision must be at least one millisecond.

The API extracts the values from authoritative prompt text for both explicit selection and free-form routing. Milliseconds, seconds, and minutes accept compact or long-form units and at most three decimal places; values must convert exactly to integer milliseconds and are never rounded. Missing duration or precision blocks the run through the normal user-visible error path. Sealed regeneration inputs are fallback-only, so stale client values cannot override timing written in the current prompt.

Submission preserves the typed Capability-module atom in the conversation document. Pending and planned branch markers render the same standard badge at its original inline position among the submitted words. On the dark submitted-message and marker surfaces, the badge keeps its Capability color with a lighter orange accent for contrast; it is not recolored white. Marker clicks and accepted Artifact history use the shared read-only chat-turn projection used by image and video lineage; Action Timeline does not define a separate history panel or depend on a live marker remaining on the canvas. The accepted-output history trigger is also shared across images, videos, and Capability Artifacts: it displays the original prompt-derived user message instead of a generic `History` label, preserves the Capability atom's submitted word order, truncates only at atom boundaries, and renders the complete badge with the same lighter orange used by other dark message surfaces. Capability-only output suppresses image and video generation, then the selected reasoning provider streams one brief plain-language completion into the same persisted turn. That continuation may not emit code, pseudocode, code blocks, diagrams, visualizations, or a duplicate of the Artifact content. While the response is still pending, history shows only the current submitted message and never inherits an earlier turn's response.

The grid uses `Math.ceil(durationMs / precisionMs)`. Segment `i` starts at `i * precisionMs` and ends at the smaller of the next boundary and total duration. A 13-second duration at 5-second precision therefore produces `0–5`, `5–10`, and `10–13`.

## Model variants and batching

The entry Tool declares `executionMultiplicity: per-reasoning-model`. Each selected reasoning model gets an independent run, title, model badge, candidate review state, history, canvas node, and one API-owned lineage marker. A single selected reasoning model therefore produces one marker and one Artifact node; it does not create a redundant origin-plus-fork marker pair. Persistent image and video model selections are ignored for this Capability, so the turn produces no media run.

Shared preflight authorizes and materializes every cited input before model fanout. Its lineage marker receives normal canvas-world placement on the first render and participates in pan/zoom immediately; it never waits beside the composer for the Artifact to finish. Action Timeline is then exposed as a `model-required` Tool inside each selected reasoning provider's normal agent loop. The provider is forced to call that sealed Tool once, receives its structured result, and continues the same streamed assistant response; Tool execution is not a detached one-shot preflight job. The completed timeline is staged as a `creating` Asset during the Tool round. The API publishes the terminal response event and finalizes the authoritative conversation first, then reconstructs the canvas run from the staged Asset's persisted lineage before it atomically attaches, activates, and publishes the Artifact node; the provider's pre-Tool run object is never treated as canvas lineage authority. Pipeline-event cleanup remains deferred until the node event is durable. A failed or cancelled continuation discards the staged Asset and its cited-source surfaces. The reasoning turn, Capability generation trace, Artifact, and lineage marker share stable request and reasoning-run IDs. Successful model variants continue when a sibling fails. Within one variant, segment batches run sequentially according to the model's completion budget. Only validated output becomes continuity context. A schema, slot, or reference-membership failure receives one correction attempt with machine-readable feedback; a second invalid response fails that variant without creating a partial Asset.

## Supported references

Timeline segments may cite image, video, audio, or document Assets. They may not cite another Capability Artifact.

Each persisted reference atom carries its canonical Asset title and media kind. The Artifact therefore renders a stable human-readable label after reload without depending on an already-warm browser Asset cache; workspace hydration also follows the Artifact's lineage source IDs so thumbnails and hover previews resolve for older Timeline documents that stored only Asset IDs.

| Asset | Model representation |
|---|---|
| Image | Canonical, preview, or original image rendition |
| Video | Representative frame, poster, or thumbnail |
| Audio | Original audio rendition |
| Document | Complete extracted document text |

The selected reasoning-model variant must support every input kind. Conversion is complete-or-error: a missing Asset, rendition, Blob, Object Store object, corrupt payload, unsupported modality, or over-budget complete request fails with a specific error instead of dropping or shortening input.

Each reasoning-provider adapter measures the complete translated native request, including timeline text and materialized references, against that model's context window while reserving its completion budget. Overflow is rejected before provider invocation; input content is never clipped to fit.

## Canvas editing

The canvas body is a live ProseMirror editor built from the module-owned schema and plugins. Time headers are rendered by an immutable segment NodeView. Users can edit segment prose and add or remove media chips, but cannot change document duration, precision, segment count, or segment boundaries in place. Running the Capability again creates a new timeline with a new grid.

The node has a fixed initial width and measures its complete body. It grows or shrinks vertically after generation, edits, reload, or width resizing; it has no internal scrolling, truncation, collapse, or pagination. Geometry changes use the same branch-tree collision and rebalancing pipeline as generated media while preserving the user-resized width.

Generated-output chrome supplies the global Asset title, reasoning-model badge, info, accept, regenerate, and history controls. Its info surface uses the shared generated-output metadata panel: editable title/description, flat typographic timeline metrics without statistic cards, Asset status/documents/lineage, and scope control. Its history surface uses the shared chat-turn renderer and includes both the reasoning response and the Capability generation-details trace. Accept and supersede operate on one output node, so peer reasoning-model variants remain independent. Regeneration replays the sealed prompt, timing, cited Assets, and reasoning model.

## Artifacts library and `@` references

Artifacts is a separate top-level right-panel surface beside Capabilities, Media, and AI Threads. The generic library lists `capabilityArtifact` Assets, delegates cards and inspectors by `artifactTypeId`, and supports add-to-canvas, title, scope, review, and sealed history. Capability Artifacts never appear in Media.

The `@` picker also has a separate Artifacts category. Selecting a timeline inserts a generic `capability-artifact` atom containing its Asset and Artifact type. When a later request references it, the API point-authorizes the timeline and optional placement, validates its registered schema, serializes every timed segment without clipping, authorizes every cited Asset, and attaches the complete provider-neutral inputs.

## Storage and lifecycle

Artifact content and sealed provenance are immutable content-addressed JSON Blobs. Tool persistence creates the Asset in `creating` and attaches `capabilityArtifact#<artifactAssetId>` surfaces to cited Assets without adding canvas membership. Post-stream finalization atomically activates the Artifact with its first canvas placement only after the assistant continuation is durable. No Artifact node becomes visible while reasoning is still streaming.

The activation transaction condition and expression values are assembled together: the `creating`-only activation path does not send placeholders used only by the ordinary active-or-creating attachment path. This keeps the DynamoDB transaction valid while canvas state, the Asset reference, lifecycle activation, and search projections commit together.

Each embedded surface keeps the cited Asset alive after its canvas and Media catalog placements are removed. Settled edits reconcile surfaces against the complete current document. Deleting the Artifact's final reference queues maintenance, removes only its surface prefix, releases its document/provenance Blob references, and lets cited Assets delete only when their own reference counts reach zero.

## Source layout

- Package module: [`packages/lixpi/capability-system/src/capabilities/action-timeline/`](../../packages/lixpi/capability-system/src/capabilities/action-timeline/)
- API adapters: [`services/api/src/capability-system/`](../../services/api/src/capability-system/)
- Browser composition: [`services/web-ui/src/installed-capabilities.ts`](../../services/web-ui/src/installed-capabilities.ts)
- Generic Artifact library: [`services/web-ui/src/infographics/workspace/artifactLibraryPanel.ts`](../../services/web-ui/src/infographics/workspace/artifactLibraryPanel.ts)

## Related documentation

- [Tools, Skills, and Capability Modules](./TOOLS-AND-SKILLS.md)
- [Capability Storage and Operations](./CAPABILITY-STORAGE.md)
- [Media Library](./MEDIA-LIBRARY.md)
- [Workspace Model](../canvas/WORKSPACE-MODEL.md)
- [Data Storage](../platform/DATA-STORAGE.md)
