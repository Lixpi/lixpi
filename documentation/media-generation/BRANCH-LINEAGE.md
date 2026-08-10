---
title: Branch Lineage
description: API-owned media branch planning, stable run-to-Asset assignments, canvas topology, durable Asset lineage, projection, and provenance.
---

# Branch Lineage

Media generation has two related but separate graphs:

- the **canvas graph** connects placement node IDs and branch marker node IDs;
- the **Asset graph** connects stable output Asset IDs to source conversation and source media Asset IDs.

The API owns both mappings. The browser renders plans and authoritative geometry but never invents lineage or rewrites node IDs into Asset IDs.

## Preflight

Before provider fan-out, the API resolves:

1. explicitly attached prompt and composer context;
2. media branch candidates using authorized Asset renditions;
3. the operation kind and target/parent node;
4. reasoning and media run axes;
5. branch marker topology;
6. one stable output `assetId` for every media run.

`MediaBranchLineagePlan.runAssignments[]` is the authoritative `mediaRunId → assetId` mapping.

```ts
type MediaRunLineageAssignment = {
  assetId: string
  generationRequestId: string
  reasoningRunId?: string
  mediaRunId?: string
  reasoningModelId?: AiModelId
  reasoningIndex?: number
  mediaModelId?: AiModelId
  mediaType?: 'image' | 'video'
  mediaIndex?: number
  branchId: string
  parentMediaNodeId?: string
  branchOriginNodeId?: string
  branchForkNodeId?: string
  branchLineNodeId?: string
  lineageParentNodeId?: string
  referenceNodeIds: string[]
  sourceContextNodeIds: string[]
  promptText: string
  promptFingerprint?: string
  createdAt: number
}
```

The assignment’s topology fields are node IDs. They are not Asset IDs.

## Marker rules

- `branchOrigin` represents a new root/fork decision when the run has no existing generated source.
- `branchFork` represents one reasoning run that fans out to multiple concrete media runs.
- `branchLine` represents a single continuation from existing generated media.
- A simple fresh single generation may connect directly from its origin without a per-run marker.

Markers store prompt/provenance information and `conversationAssetId`. Their positions and dimensions are persisted in the Workspace.
At request settlement, the API projects the marker's bounded reasoning-run response preview into `provenance.reasoningResponseText`. The conversation response is authoritative while mounted; the persisted marker field guarantees the reasoning row survives reloads and prompt-replay workflows. If a provider emits only a media Tool call, the Tool prompt stored in that run's generation trace is the response fallback instead of an empty row.

Branch markers remain prompt/reasoning surfaces and never render per-media operation progress. The API creates one stable pending output node per concrete media run as soon as it accepts the request. That node receives a generic progress tree immediately, then `MediaGenerationRunProgress.items` replaces it when a Capability, Skill, Tool, or provider supplies domain-specific work. The browser renders the shared timeline directly to the right of its media node without a background. It centers vertically while shorter than the visible media/spinner outline and top-aligns after it grows taller. The external chrome does not change the media node or traveling-outline bounds. Accepting an output hides its live timeline; terminal progress remains in the Asset's sealed provenance and uses the same timeline component in accepted history.

## Pending output Assets

After the plan is built, the API creates one pending Asset per assignment. Each creation transaction writes:

- the Asset with lifecycle `creating`, media `processing`, provenance `building`;
- workspace scope/catalog projection;
- owner ACL;
- a workspace conversation/media surface reference;
- durable lineage derived from authorized node-to-Asset mappings.

`Asset.lineage` contains:

```ts
type AssetLineage = {
  sourceConversationAssetId?: string
  parentAssetId?: string
  sourceAssetIds: string[]
  generationRequestId?: string
  reasoningRunId?: string
  mediaRunId?: string
  reasoningModelId?: string
  mediaModelId?: string
  promptFingerprint?: string
}
```

The browser sees stable Asset IDs from `MEDIA_LINEAGE_PLANNED` before partial/final events arrive.

## Candidate media

Canvas candidate snapshots contain `nodeId` plus `assetId`, roles, branch hints, descriptors, and prompt metadata. `explicitReferenceCandidateIds` is the allowlist; the API drops every other candidate before Asset reads or branch resolution. Prompt reference atoms can add Asset-only candidates without canvas node IDs. Browser-supplied byte URLs are not trusted. The API point-authorizes each allowed Asset and resolves a model-safe Blob:

- image: canonical/original or preview as required;
- video grounding: representative frame, falling back to poster;
- explicit video extension: canonical/original MP4.

Videos cost one still image in branch resolution. The MP4 is used only by the explicit extension path.

The branch VLM assigns target, style, and lineage roles only within the explicit candidate set. Every explicit candidate remains a generation reference. If the VLM cannot assign a target safely, the API keeps all explicit references and plans a targetless fresh branch instead of failing preflight.

## Canvas projection

The browser may render a transient preflight branch marker before the lineage plan arrives, but it never creates or positions generated media nodes. Request creation assigns each concrete run its stable media-run, Asset, operation-node, and output-node IDs, then immediately persists the pending image/video node before reasoning, Capability execution, lineage planning, or any provider event. The later lineage plan reuses and enriches that same node rather than replacing it.

The API projection service persists marker topology when the lineage plan is announced. It uses shared marker text metrics and canvas-engine branch-tree/collision settings. Canvas revisions are strictly greater than the persisted revision, including when several provider events commit in the same millisecond. Every connected client can therefore apply the same ordered node snapshots and coordinates.

Streaming reasoning text updates the conversation document but does not emit canvas geometry revisions per text chunk. Marker geometry is reserved by the lineage plan and reconciled once at request settlement, preventing token streaming from continuously resizing and rebalancing the visible tree.

Generated media nodes persist `mediaGenerationPhase` with their geometry. Before the original rendition is ready, the phase is `pending-before-first-frame`; the client paints a compact loading circle, while every API rebalance reserves the node's full final card footprint and media-chrome height. Partial attachment is idempotent, and final projection changes the phase to `ready` without changing the reserved card dimensions. A first frame therefore cannot enlarge a collision box, overlap a sibling, or repeatedly reflow the branch forest. Clients consume the persisted phase and use local event or Asset state only as a fallback for workspace data created without it.

When a final image or video settles, the API:

1. uses the same pending node ID as the final placement ID;
2. sets only `assetId`, geometry, and generated topology metadata on the media node;
3. adds the declared lineage edge;
4. rebalances the branch forest;
5. attaches the Asset reference and Workspace canvas in one transaction;
6. publishes `CanvasGeometryUpdate` with node snapshots, edge snapshots, removals, and `layoutRevision`.

If the pending projection already attached the Asset reference, final settlement still commits the Workspace canvas mutation under the expected canvas revision. Reference idempotency skips only the unchanged Asset reference write; it never skips final geometry persistence.

The node ID is stable across pending/final state and remains independent of the Asset ID. `mediaGenerationPhase` controls the layout footprint only. Asset lifecycle and rendition readiness still come from `assetsStore`.

Clients discard stale geometry revisions and ignore late upserts for locally cancelled request IDs. If completion geometry is absent because the attach failed, the completion is not considered durable; publisher failure propagates instead of fabricating local topology.

## Partial image events

Progressive image partials are ephemeral NATS Object Store objects associated with the assignment’s `assetId`. Pipeline events carry only authenticated `/api/transient-media/...` references. Replacements delete superseded revisions, terminal completion/teardown deletes the last revision, and partial bytes are never registered as Asset renditions or persisted in Workspace state.

The final event contains the durable Asset original URL and API canvas geometry. The Asset rendition worker then produces preview and thumbnail asynchronously.

## Provenance

The source conversation streams once. Each terminal output Asset receives a sealed `provenance` document built from the durable pipeline event log:

- source user message/request context;
- events for the shared `reasoningRunId`;
- only events matching that output’s `mediaRunId` when an event is media-specific;
- the Asset lineage assignment;
- that output run's terminal recursive generation-progress tree;
- terminal status: completed, failed, or cancelled.

Sibling outputs can share reasoning while never receiving each other’s media prompt/call/result events.

Provenance is an immutable JSON Blob and rejects client steps. Materialization failure queues a durable rebuild and prevents pipeline-log cleanup from silently discarding the source.

## Candidate review and regeneration

Every pending generated output Asset starts with `generatedOutputReview.status = candidate`. Candidate media remains attached to its API-planned branch marker and exposes two node-level actions: accept or replay the existing media prompt. Reasoning-prompt regeneration exists only on the branch marker.

Accepting a media node changes its review status to `accepted`, preserves its sealed output provenance, removes its active branch topology fields and lineage edge from the Workspace projection, and leaves the media node as an independent canvas entity. Its user-message history control is rendered only in this accepted state. Accepting a branch marker applies the same transition to every candidate child. A marker is deleted when its last candidate child detaches; otherwise it remains connected to the candidates that have not been accepted.

Existing-prompt regeneration marks the replaced candidate Assets as `superseded`, removes their canvas nodes, and preserves the selected lineage marker. The matrix request carries each output's sealed `finalPrompt`, reasoning/media model pair, and media parameters. The API lineage plan repeats the validated regeneration target explicitly, so clients cannot reinterpret the committed marker as temporary preflight geometry. Provider execution skips reasoning prompt generation, replays the prompt directly through the selected media provider, and attaches the replacement Asset to the preserved marker using API-persisted coordinates. Resolver-selected reference media remains provenance context but cannot become the replay's topology parent; the preserved marker is the only layout parent. This prevents one provider's replay from changing prompts used by sibling providers or attaching the replacement to an unrelated tree.

Prompt regeneration is available only from a branch-lineage marker. It supersedes and removes every candidate child, removes the old marker when it becomes empty, and submits the entire former variant set through normal reasoning to produce a new prompt and new lineage. Media-node controls can accept one output or replay its existing sealed media prompt, but cannot regenerate the reasoning prompt. Orphaned old markers are pruned; markers with other candidate children remain.

## Completion, failure, and cancellation

Successful settlement stores the original Blob, starts rendition generation, attaches canvas membership, publishes the final media content, flushes that content into the conversation snapshot, and materializes sealed provenance. Asset updates drive review-control enablement without waiting for a workspace reload.

Provider failure or cancellation materializes terminal provenance for every unfinished planned Asset. Failed Assets use lifecycle/media `failed`; cancelled Assets use lifecycle `failed` and media/provenance `cancelled`. They remain addressable through their catalog/reference rows until explicitly removed.

Durable media requests also project one generic `operationStatus` state node per concrete run. It points directly to the stable `outputNodeId`; lineage planning rebinds the operation/output identities to the matching assignment without creating a marker ownership edge. Every update mirrors structured progress onto that image/video node. While the operation is `in-progress`, its operation card stays hidden and the media-owned side timeline is the progress surface. Terminal provenance materialization embeds the final tree in the Asset document; ambiguity, missing provider verification, and provider failure retain actionable recovery cards while the output node keeps the matching progress state.

Request settlement removes unfinished pending Asset placements and rebalances remaining markers/completed outputs, but it does not silently erase the durable failed operation node. Completed siblings are never removed by a later failure or cancellation. Only explicit Cancel/Dismiss removes waiting/failed recovery state and releases its retained checkpoint.

## Invariants

- Every concrete media run has exactly one stable `assetId` before provider work.
- Every final canvas media node has one `assetId` and an independently generated node ID.
- Browser state never determines durable Asset lineage.
- Canvas topology fields always reference node IDs.
- Asset lineage fields always reference Asset IDs.
- One live conversation stream is shared; output provenance is materialized after settlement.
- Candidate review state belongs to the output Asset; branch attachment belongs to the Workspace projection.
- Accepted output Assets are immutable review decisions and retain sealed provenance after canvas detachment.
- Existing-prompt replay never invokes a reasoning provider and never rewrites sibling media prompts.
- Generated media topology and coordinates are persisted by the API before clients render them.
- No generated output depends on a workspace Object Store key or a chat-thread table row.
- A user-selected ambiguous target resumes the same request and bypasses another target-selection call.
- No provider rejection automatically retries or rewrites a paid request.

## Relevant code

- [`media-branch-lineage-planner.ts`](../../services/api/src/llm/lineage/media-branch-lineage-planner.ts)
- [`media-generation-matrix.ts`](../../services/api/src/llm/orchestration/media-generation-matrix.ts)
- [`asset-canvas-projection.ts`](../../services/api/src/services/asset-canvas-projection.ts)
- [`generated-asset-storage.ts`](../../services/api/src/services/generated-asset-storage.ts)
- [`asset-provenance-materializer.ts`](../../services/api/src/services/asset-provenance-materializer.ts)
- [`generated-media-turn-projection.ts`](../../packages/lixpi/prosemirror/src/shared/generated-media-turn-projection.ts)
