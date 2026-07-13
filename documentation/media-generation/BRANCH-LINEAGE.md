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

1. descriptor-first workspace context;
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

Canvas candidate snapshots contain `nodeId` plus `assetId`, roles, branch hints, descriptors, and prompt metadata. Browser-supplied byte URLs are not trusted. The API point-authorizes each Asset and resolves a model-safe Blob:

- image: canonical/original or preview as required;
- video grounding: representative frame, falling back to poster;
- explicit video extension: canonical/original MP4.

Videos cost one still image in branch resolution. The MP4 is used only by the explicit extension path.

## Canvas projection

The browser may render transient pending media nodes, identified by a deterministic node ID derived from the run assignment. These nodes are not persisted through normal full canvas saves.

The API projection service persists marker topology when the lineage plan is announced. It uses shared marker text metrics and canvas-engine branch-tree/collision settings.

When a final image or video settles, the API:

1. uses the same pending node ID as the final placement ID;
2. sets only `assetId`, geometry, and generated topology metadata on the media node;
3. adds the declared lineage edge;
4. rebalances the branch forest;
5. attaches the Asset reference and Workspace canvas in one transaction;
6. publishes `CanvasGeometryUpdate` with node snapshots, edge snapshots, removals, and `layoutRevision`.

The node ID is stable across pending/final state and remains independent of the Asset ID. Asset media readiness is resolved from `assetsStore`, not duplicated on the node.

Clients discard stale geometry revisions and ignore late upserts for locally cancelled request IDs. If completion geometry is absent because the attach failed, the completion is not considered durable; publisher failure propagates instead of fabricating local topology.

## Partial image events

Progressive image partials are ephemeral data URLs associated with the assignment’s `assetId`. They update the transient pending node only. Partial bytes are not registered as Asset renditions and are not persisted in Workspace state.

The final event contains the durable Asset original URL and API canvas geometry. The Asset rendition worker then produces preview and thumbnail asynchronously.

## Provenance

The source conversation streams once. Each terminal output Asset receives a sealed `provenance` document built from the durable pipeline event log:

- source user message/request context;
- events for the shared `reasoningRunId`;
- only events matching that output’s `mediaRunId` when an event is media-specific;
- the Asset lineage assignment;
- terminal status: completed, failed, or cancelled.

Sibling outputs can share reasoning while never receiving each other’s media prompt/call/result events.

Provenance is an immutable JSON Blob and rejects client steps. Materialization failure queues a durable rebuild and prevents pipeline-log cleanup from silently discarding the source.

## Completion, failure, and cancellation

Successful settlement stores the original Blob, starts rendition generation, attaches canvas membership, materializes provenance, and publishes the final event with `assetId`.

Provider failure or cancellation materializes terminal provenance for every unfinished planned Asset. Failed Assets use lifecycle/media `failed`; cancelled Assets use lifecycle `failed` and media/provenance `cancelled`. They remain addressable through their catalog/reference rows until explicitly removed.

Request settlement removes transient pending node IDs for unfinished assignments and rebalances remaining markers/completed outputs. Completed siblings are never removed by a later cancellation.

## Invariants

- Every concrete media run has exactly one stable `assetId` before provider work.
- Every final canvas media node has one `assetId` and an independently generated node ID.
- Browser state never determines durable Asset lineage.
- Canvas topology fields always reference node IDs.
- Asset lineage fields always reference Asset IDs.
- One live conversation stream is shared; output provenance is materialized after settlement.
- No generated output depends on a workspace Object Store key or a chat-thread table row.

## Relevant code

- [`media-branch-lineage-planner.ts`](../../services/api/src/llm/lineage/media-branch-lineage-planner.ts)
- [`media-generation-matrix.ts`](../../services/api/src/llm/orchestration/media-generation-matrix.ts)
- [`asset-canvas-projection.ts`](../../services/api/src/services/asset-canvas-projection.ts)
- [`generated-asset-storage.ts`](../../services/api/src/services/generated-asset-storage.ts)
- [`asset-provenance-materializer.ts`](../../services/api/src/services/asset-provenance-materializer.ts)
- [`generated-media-turn-projection.ts`](../../packages/lixpi/prosemirror/src/shared/generated-media-turn-projection.ts)
