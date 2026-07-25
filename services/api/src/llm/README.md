# LLM Module

The in-process TypeScript LangGraph workflow for conversation streaming, context resolution, multi-model media generation, Asset lineage, provenance, usage, and cancellation.

## Storage contract

- A conversation is an Asset with a `conversation` ProseMirror role.
- Every concrete image/video run receives a pending output Asset before provider fan-out.
- Media bytes and document/provenance JSON are organization content-addressed Blobs.
- Canvas nodes contain `assetId`; node IDs remain independent topology identities.
- The conversation streams once. Output provenance is projected from the settled conversation Asset at terminal state.

There is no document/chat-thread persistence model or workspace file storage adapter in this module.

## Entry points

`createLlmModule()` returns:

- `process()` for a single reasoning request;
- `processMediaGenerationMatrix()` for shared-preflight multi-model fan-out;
- `seedCapabilities()` for package seeding after every isolated module has registered its actions;
- `stop()` and `stopMediaGenerationMatrix()`;
- `shutdown()`;
- `getSubscriptions()` (currently empty because the API gateway invokes the module in-process).

The NATS gateway authenticates the conversation Asset, acquires its workspace lease, obtains the authoritative `organizationId` from the Asset, and renews the lease while the workflow runs.

## Workflow

```text
validateRequest
  → resolveWorkspaceContext
  → resolveCapabilities
  → executeRequiredCapabilities
  → resolveMediaBranch
  → streamTokens
  → planMediaBranchLineage
  → generate_image | generate_video | skip
  → calculateUsage
  → cleanup
```

Context snapshots contain candidate, node, and Asset IDs plus descriptors. The API also extracts typed prompt-reference atoms from the authoritative latest user message, reauthorizes them, and materializes Asset-only media references without inventing canvas nodes. Media-enabled turns merge them into the candidate resolver; text-only reasoning turns attach the authorized image or representative frame directly to the latest user message. Video candidates use representative-frame/poster renditions; explicit extension resolves the authorized source video Asset to canonical/original MP4 internally.

Capability resolution maps selected top-level modules to their module-internal entry packages, accepts only structurally standalone Tool/Skill references on those categories, captures current manifest hashes, authorizes the transitive closure, enforces dependency and aggregate resource limits, and seals the plan. Required Tools run before provider streaming. The reasoning model also receives `search_capabilities` and `use_capability` on media-enabled turns; model-selected visual Tool output is folded back into the same provider state before lineage planning and generation. Transient media providers cannot recurse into those functions.

## Streams

Live interaction events:

```text
ai.interaction.chat.receiveMessage.<organizationId>.<conversationAssetId>               # internal canonical
ai.interaction.chat.receiveMessage.<userIdToken>.<organizationId>.<conversationAssetId> # authorized browser relay
```

Pipeline replay logs are keyed by workspace and conversation pipeline ID. `StreamPublisher` writes replay before live publication and preserves per-`mediaRunId` event ordering without serializing sibling runs.
The authorized browser relay refreshes requester and conversation authorization on a short interval, then forwards events directly between refreshes so partial-image fanout cannot queue behind one database authorization read per event.
Transient image/video providers forward media events to their owning reasoning provider; only that owner live-publishes the mirrored event, preventing duplicate partial and completion delivery.

Conversation document steps use:

```text
asset.document.steps.<organizationId>.<conversationAssetId>.conversation               # internal durable
asset.document.events.<userIdToken>.<organizationId>.<conversationAssetId>.conversation # authorized browser relay
```

`AiChatProseMirrorStreamAssembler` is the single writer for AI transcript steps. It parses streamed Markdown, updates reasoning/trace/generated-media nodes, and publishes expected-sequence step/control events through `AssetProseMirrorStepTransport`. Generation trace blocks are keyed by the full media run inside a reasoning section, so image/video model fanout preserves one final prompt and trace per output instead of overwriting sibling variants.
Before provider invocation, the API rebuilds messages and the current prompt from that authoritative conversation document; browser-serialized transcript history and prompt fingerprints are not trusted.

Generated-output replay is an explicit exception to reasoning prompt creation, not to authorization. The API validates that the requested preserved lineage marker exists in the editable Workspace and belongs to the supplied branch. A replay matrix carries output-scoped final media prompts keyed by reasoning model, media model, and modality. The provider graph skips `streamImpl`, injects each prompt only into its matching media fanout, retains the original model parameters, and creates replacement output Assets under the preserved marker. Its lineage plan includes the preserved regeneration target so clients never treat that committed marker as temporary UI geometry; all clients consume the same API-persisted marker and generated-media coordinates. Normal prompt regeneration does not use this replay contract and therefore creates a new API-planned lineage.

## Media preflight and Asset creation

`MediaBranchLineagePlanner` enumerates reasoning/media axes and returns marker topology plus one `MediaRunLineageAssignment` per concrete output. Each assignment includes its stable output `assetId`, every selected `referenceAssetId`, and the node-backed `referenceNodeId` subset. Asset-only references contribute provenance but never canvas topology.

For a plain single-model request, reasoning chooses `generate_image` or `generate_video` before lineage planning, so only the chosen modality receives an assignment even though both scalar model selectors are configured. Character Creator is image-only: request routing selects the Tool before provider execution, retains the selected reasoning/image axes, and removes every video model and video option before matrix normalization or scalar provider setup. Explicit matrix requests still enumerate every requested model axis allowed by the selected Tool. `ImageRouter` packages every source and capability image into the typed `imageGenerationReferences` contract. `BaseProvider` resolves and fingerprints that ordered list exactly once before any image-provider workflow runs; OpenAI, Google, Stability, and future provider adapters consume the same `resolvedImageGenerationReferences` state instead of reparsing vendor-specific message blocks. Character Creator therefore preserves the authoritative character source first and the packaged sheet-layout example second across every provider. The Character Creator action logs the packaged example's byte length and SHA-256 when it leaves capability storage, and the shared resolver logs the same fingerprint at provider ingress, so a run can prove that the repository resource—not a prompt-only substitute—reached the media adapter.

Shared preflight creates pending Assets with:

- workspace scope/catalog and conversation/media surface reference;
- owner ACL and Meta projection;
- `creating/processing/building` states;
- `sourceConversationAssetId`;
- `parentAssetId` and `sourceAssetIds` resolved from authorized node-to-Asset maps;
- generation/reasoning/media IDs and prompt fingerprint.

`ImageRouter` reads source images directly from the authoritative candidate-based branch resolution and snapshot. Reasoning-provider tool-call extraction is only a fallback when no branch references were selected, so a failed or skipped reasoning response cannot silently remove an explicitly selected character source. Character Creator forces the closest supported landscape size (`1536x1024` for OpenAI and `3:2` for ratio-based providers) and treats `character-sheet-example.jpg` as the authoritative output-layout template. Its textual contract matches the template's complete turnaround, head, feature, notes, palette, material, detail, alignment-guide, and pose-panel structure; a simplified turnaround strip is invalid. When character source images exist, generation is a two-pass workflow: a capture-only layout-synthesis pass uses the source images plus template, then a bounded fidelity-restoration edit uses the generated sheet as the locked composition target and reattaches every source image for identity, design, medium, line, edge, mark, palette, substrate, and texture preservation. Only the restoration pass is persisted. OpenAI reference-conditioned generation uses `images.edit`; GPT Image 2 supplies automatic high input fidelity, while GPT Image 1 and 1.5 explicitly request `input_fidelity=high`. Google interleaves an explicit role label before every image part. Stability uses the template through Structure control for layout synthesis, then uses the captured sheet as `init_image` and a composite containing every character source as `style_image` for the restoration pass.

Providers and browser code must never synthesize assignments, marker IDs, or output Asset IDs.
A lineage-plan canvas write persists branch markers only. Planned media slots remain transient until the first media event attaches each preassigned Asset node through its reference-counted Asset/workspace transaction.
A matrix reasoning child never completes the shared generation request. It may settle only its own skipped branch; the matrix orchestrator publishes the single request-level completion after every reasoning child finishes.
A reasoning-only matrix has no concrete media assignments, so it creates no pending output Assets or media-lineage canvas markers.

## Image and video publishers

Image partials are ephemeral Object Store objects and are never Blob renditions. Final publishers:

1. validate provider bytes;
2. store/register the original Blob on the preassigned Asset;
3. start the rendition service;
4. project and attach the final canvas node through the Asset transaction;
5. publish `IMAGE_COMPLETE` or `VIDEO_COMPLETE` with `assetId` and authoritative canvas geometry;
6. materialize terminal provenance, queuing a rebuild on failure.

Canvas attach failure propagates; the publisher does not emit a fabricated durable completion.

## Provenance

`asset-provenance-materializer.ts` projects only the matching reasoning/media run from the settled conversation Asset into a schema-valid, title-free ProseMirror provenance snapshot. It stores the sealed snapshot Blob in `documents.provenance` and updates terminal states under Asset revision. A completed run retries while the rich conversation projection is still settling, then uses a minimal valid terminal projection only after bounded retries are exhausted. Failed/cancelled runs receive the same minimal valid terminal projection when no generated-media atom exists. Deferred reconstruction does not depend on pipeline events that normal cleanup may already have purged.

Request-level failure/cancellation settles every unfinished planned Asset. Assets whose original already settled rely on their per-publisher provenance job/retry.

Pipeline cleanup may discard source events after terminal delivery because deferred provenance reconstruction reads the settled conversation Asset.

Generated media partials never travel inside pipeline, ProseMirror, or live NATS event payloads. Providers write each revision to an immutable run-scoped object in the organization transient-media Object Store and publish only an authenticated API reference. After a replacement is stored, the superseded revision is deleted; terminal media clears the last partial immediately, with provider teardown retrying any failed cleanup. The mechanism is media-type agnostic, and final media remains available only through its settled Asset rendition.

Asset-document resume follows the same payload boundary: core NATS returns snapshot metadata and byte-bounded replay pages, while the browser fetches the Blob-backed ProseMirror snapshot through the authenticated Asset HTTP route. Conversation growth cannot turn a resume reply into a `max_payload` failure.

## Cancellation

Matrix stop aborts and awaits provider groups, patches cancelled state into the persisted conversation Asset through the system snapshot path, settles canvas removals using the retained lineage plan, materializes cancelled provenance for unfinished outputs, drains projection/document queues, and releases the lease.

If no live publisher exists, the API still performs persisted conversation cancellation and canvas settlement. It never depends solely on browser state.

## File layout

```text
llm/
├── graph/
│   ├── state.ts
│   ├── stream-publisher.ts
│   ├── pipeline-event-log.ts
│   ├── workspace-context-resolver.ts
│   ├── media-branch-resolver.ts
│   ├── image-publisher.ts
│   └── video-publisher.ts
├── lineage/
│   ├── media-branch-lineage-planner.ts
│   └── media-generation-run-planner.ts
├── orchestration/media-generation-matrix.ts
├── providers/
├── structured-vlm/
├── tools/
├── prompts/
└── usage/

../../../packages/lixpi/capability-system/    # reusable validation, resolver, registry, runner, dispatcher, module contracts
../capability-system/                         # API storage, NATS, LangGraph, and seeding adapters
../installed-capabilities.ts                  # built-in Tool and Skill composition root
../capability-modules/character-creator/      # self-contained Character Creator tools/ + skills/
../capability-modules/style-extraction/       # self-contained Style Extraction tools/ + skills/
../prosemirror/ai-chat-stream-assembler.ts
../prosemirror/asset-prosemirror-step-transport.ts
../services/asset-canvas-projection.ts
../services/generated-asset-storage.ts
../services/asset-provenance-materializer.ts
```

## Provider invariants

- Provider state updates are partial overlays; undefined fields do not erase state.
- Capability references resolve once in shared preflight to an immutable, hash-verified plan. Matrix children receive that exact plan and never re-resolve it.
- Reasoning providers expose `search_capabilities`, `use_capability`, and attached `model-choice` Tools through bounded provider-native continuation loops. Transient image/video providers never expose Capability invocation functions.
- Required Tools execute before reasoning; every Tool action resolves through the server allowlist and emits replayable generic run events with sealed manifest provenance.
- Media-generation context Tools return provider-neutral instructions and model-safe references. Shared preflight forwards that context to every selected reasoning/media child without changing the selected model matrix. `MediaBranchLineagePlanner` allocates the normal output Assets and topology before provider fanout; Tool runtimes do not generate or attach those outputs themselves.
- A required non-generation Tool may still return terminal output Assets and suppress ordinary media routing when that Tool's product contract makes those Assets the request result. Character Creator is a generation-context Tool, so it does not use that terminal-output path.
- Transient media providers do not emit their own top-level start/end lifecycle.
- Reference traces never contain inline image bytes.
- Provider routers receive exact preplanned run metadata.
- Usage uses synchronized model pricing and decimal arithmetic.
- Every request has an AbortController and the global timeout.

## Related docs

- [`documentation/platform/AI-GENERATION-PIPELINE.md`](../../../documentation/platform/AI-GENERATION-PIPELINE.md)
- [`documentation/media-generation/BRANCH-LINEAGE.md`](../../../documentation/media-generation/BRANCH-LINEAGE.md)
- [`documentation/platform/DATA-STORAGE.md`](../../../documentation/platform/DATA-STORAGE.md)
