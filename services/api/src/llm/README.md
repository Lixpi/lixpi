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
- `stop()` and `stopMediaGenerationMatrix()`;
- `shutdown()`;
- `getSubscriptions()` (currently empty because the API gateway invokes the module in-process).

The NATS gateway authenticates the conversation Asset, acquires its workspace lease, obtains the authoritative `organizationId` from the Asset, and renews the lease while the workflow runs.

## Workflow

```text
resolveWorkspaceContext
  → resolveFeatures
  → resolveMediaBranch
  → planMediaBranchLineage
  → validateRequest
  → streamTokens
  → generate_image | generate_video | skip
  → calculateUsage
  → cleanup
```

Context snapshots contain node/Asset IDs and descriptors. The API point-authorizes selected Assets and resolves model-safe Blob URLs. Video candidates use representative-frame/poster renditions; explicit extension resolves the authorized source video Asset to canonical/original MP4 internally.

## Streams

Live interaction events:

```text
ai.interaction.chat.receiveMessage.<organizationId>.<conversationAssetId>               # internal canonical
ai.interaction.chat.receiveMessage.<userIdToken>.<organizationId>.<conversationAssetId> # authorized browser relay
```

Pipeline replay logs are keyed by workspace and conversation pipeline ID. `StreamPublisher` writes replay before live publication and preserves per-`mediaRunId` event ordering without serializing sibling runs.

Conversation document steps use:

```text
asset.document.steps.<organizationId>.<conversationAssetId>.conversation               # internal durable
asset.document.events.<userIdToken>.<organizationId>.<conversationAssetId>.conversation # authorized browser relay
```

`AiChatProseMirrorStreamAssembler` is the single writer for AI transcript steps. It parses streamed Markdown, updates reasoning/trace/generated-media nodes, and publishes expected-sequence step/control events through `AssetProseMirrorStepTransport`. Generation trace blocks are keyed by the full media run inside a reasoning section, so image/video model fanout preserves one final prompt and trace per output instead of overwriting sibling variants.
Before provider invocation, the API rebuilds messages and the current prompt from that authoritative conversation document; browser-serialized transcript history and prompt fingerprints are not trusted.

Generated-output replay is an explicit exception to reasoning prompt creation, not to authorization. The API validates that the requested preserved lineage marker exists in the editable Workspace and belongs to the supplied branch. A replay matrix carries output-scoped final media prompts keyed by reasoning model, media model, and modality. The provider graph skips `streamImpl`, injects each prompt only into its matching media fanout, retains the original model parameters, and creates replacement output Assets under the preserved marker. Its lineage plan includes the preserved regeneration target so clients never treat that committed marker as temporary UI geometry; all clients consume the same API-persisted marker and generated-media coordinates. Normal prompt regeneration does not use this replay contract and therefore creates a new API-planned lineage.

## Media preflight and Asset creation

`MediaBranchLineagePlanner` enumerates reasoning/media axes and returns marker topology plus one `MediaRunLineageAssignment` per concrete output. Each assignment includes its stable `assetId`.

Shared preflight creates pending Assets with:

- workspace scope/catalog and conversation/media surface reference;
- owner ACL and Meta projection;
- `creating/processing/building` states;
- `sourceConversationAssetId`;
- `parentAssetId` and `sourceAssetIds` resolved from authorized node-to-Asset maps;
- generation/reasoning/media IDs and prompt fingerprint.

Providers and browser code must never synthesize assignments, marker IDs, or output Asset IDs.
A reasoning-only matrix has no concrete media assignments, so it creates no pending output Assets or media-lineage canvas markers.

## Image and video publishers

Image partials are ephemeral data URLs and are never Blob renditions. Final publishers:

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
├── tools/
├── extraction/
├── prompts/
└── usage/

../prosemirror/ai-chat-stream-assembler.ts
../prosemirror/asset-prosemirror-step-transport.ts
../services/asset-canvas-projection.ts
../services/generated-asset-storage.ts
../services/asset-provenance-materializer.ts
```

## Provider invariants

- Provider state updates are partial overlays; undefined fields do not erase state.
- Transient media providers do not emit their own top-level start/end lifecycle.
- Reference traces never contain inline image bytes.
- Provider routers receive exact preplanned run metadata.
- Usage uses synchronized model pricing and decimal arithmetic.
- Every request has an AbortController and the global timeout.

## Related docs

- [`documentation/platform/AI-GENERATION-PIPELINE.md`](../../../documentation/platform/AI-GENERATION-PIPELINE.md)
- [`documentation/media-generation/BRANCH-LINEAGE.md`](../../../documentation/media-generation/BRANCH-LINEAGE.md)
- [`documentation/platform/DATA-STORAGE.md`](../../../documentation/platform/DATA-STORAGE.md)
