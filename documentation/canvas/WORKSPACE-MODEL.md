---
title: Workspace Model
description: Workspace persistence, Asset-backed canvas nodes, membership transactions, panel state, rendering coordinates, and deletion behavior.
---

# Workspace Model

A Workspace is the local spatial arrangement of reusable Assets. It owns canvas geometry and workspace UI state. An Asset owns content, media, title, descriptor, scope, lifecycle, and lineage. The same Asset can appear through different node IDs in multiple workspaces without copying bytes or global metadata.

## Workspace record

```ts
type Workspace = {
  workspaceId: string
  organizationId: string
  name: string
  accessType: 'private' | 'public'
  accessList: Array<{ userId: string; accessLevel: AccessLevel }>
  canvasState: CanvasState
  createdAt: number
  canvasStateUpdatedAt: number
  updatedAt: number
}
```

The Main/Meta/Access-List triad remains transactional. `organizationId` is authoritative for Assets, Blobs, and organization-scoped Capabilities created from the workspace.

## Canvas state

```ts
type CanvasState = {
  viewport: { x: number; y: number; zoom: number }
  nodes: CanvasNode[]
  edges: WorkspaceEdge[]
  aiChatPanel?: CanvasAiChatPanelState
  lastActiveConversationAssetId?: string
}
```

The persisted chat panel contains ordered conversation tabs, the active tab, open/history state, panel width, the `capabilities | artifacts | media | aiThreads` top-level mode, and explicit context-chip node IDs. Conversation tab `refId` values are conversation Asset IDs. Capability Runs are API records and are never persisted in Workspace state.

## Canvas node identity

Media and document nodes contain exactly one storage coordinate:

```ts
type ImageCanvasNode = {
  nodeId: string
  type: 'image'
  assetId: string
  position: Point
  dimensions: Dimensions
  generatedBy?: ImageGeneratedByMetadata
}
```

Video, audio, uploaded-document, and editable-document nodes use the same `assetId` pattern. Canvas nodes never persist Object Store keys, rendition URLs, descriptors, titles, or workspace byte coordinates.

Registered Capability Artifacts use one generic node contract:

```ts
type CapabilityArtifactCanvasNode = {
  nodeId: string
  type: 'capabilityArtifact'
  artifactTypeId: string
  assetId: string
  position: Point
  dimensions: Dimensions
  generatedBy?: CapabilityArtifactGeneratedByMetadata
}
```

`artifactTypeId` selects package-owned schema, editor, body, info, replay, reference, and library factories. The workspace renderer contains no concrete Action Timeline branch.

`nodeId` is a placement identity and is generated independently from `assetId`. It is used by edges, branch topology, selection, parent/child layout, and workspace references. Attaching one Asset twice creates two node IDs. Node IDs are never rewritten into Asset IDs during generation completion.

Branch markers contain canvas topology only. Their `conversationAssetId` points to the durable conversation Asset, while their node IDs remain branch topology IDs.

## Geometry and edges

Top-level node positions are workspace coordinates. Child positions are relative to `parentId`. `dimensions` are persisted so initial render does not depend on media download timing. Asset media metadata such as intrinsic width, height, aspect ratio, and duration lives on `Asset.media`.

Edges use node IDs:

```ts
type WorkspaceEdge = {
  edgeId: string
  sourceNodeId: string
  targetNodeId: string
  sourceHandle?: string
  targetHandle?: string
  sourceMessageId?: string
  pathType?: WorkspaceEdgePathType
}
```

Generated-media lineage has two independent layers:

- canvas topology: `parentMediaNodeId`, branch marker IDs, and connector edges;
- durable Asset lineage: `parentAssetId`, `sourceAssetIds`, and `sourceConversationAssetId` on the Asset.

## Asset resolution

On route load:

1. `WorkspaceService` loads the Workspace.
2. `AssetService` collects Asset IDs from canvas nodes, conversation tabs, the last-active conversation, and workspace-scoped document/conversation/Capability Artifact Meta pages.
3. Point-authorized Asset reads populate `assetsStore`.
4. `content` and `conversation` document roles resume from immutable snapshots plus step events.
5. The renderer resolves titles/descriptors from `assetsStore` and media URLs from `/api/assets/:assetId/renditions/:name`.

The Media and Artifacts surfaces use paginated `Asset-Meta` directly, so Assets do not need to be mounted on the current canvas before they can be attached. Media excludes `capabilityArtifact`; Artifacts requests only that category.

## Membership transactions

Canvas membership is `(assetId, nodeId)`. It can change only through Asset attach/detach operations.

Attach with a node performs one DynamoDB transaction that:

1. conditionally updates `Workspace.canvasState` using `canvasStateUpdatedAt`;
2. creates or updates `Asset-References(assetId, workspace#workspaceId)` and adds the node ID;
3. increments `Asset.referenceCount` only when the workspace reference row is new;
4. increments `Asset.revision` and updates Meta projections.

Detach removes only the requested node ID. The workspace reference row remains while another node or surface is present. Removing the row decrements the Asset counter once. Removing the last catalog/workspace reference changes lifecycle to `deleting` and queues maintenance.

Canvas deletion may remove one node or a marquee-selected set. Each Asset-backed node uses its own ordered detach transaction, so multiple placements of the same Asset keep one workspace reference until the last selected placement is gone. The deletion state also removes incident edges, orphaned branch markers, and context-chip references to removed node IDs. A membership rebase carries the complete removed-node set so concurrent state reconciliation cannot restore a pruned marker.

Rejecting a generated candidate is stronger than removing an ordinary placement. The API marks the candidate superseded, removes its generation conversation surface and catalog reference, then detaches its canvas node. Another node or surface reference still protects the Asset. If none remains, the node detach queues Asset maintenance.

Surface IDs cover non-node workspace membership, for example:

```text
document#<assetId>
conversation#<assetId>
conversation#<conversationAssetId>#media#<mediaRunId>
```

## Full canvas saves

`Workspace.updateCanvasState` is for geometry, viewport, edges, panel metadata, and transient-state pruning. The API rejects:

- any legacy storage field such as `fileId`, `src`, `referenceId`, or `aiChatThreadId`;
- a media/document node without `assetId`;
- any change to the sorted `(assetId, nodeId)` membership signature.

This prevents stale clients, drag saves, or full-state rewrites from bypassing reference counters.

Viewport-only writes merge the incoming viewport with the current authoritative nodes and edges. All writes use `canvasStateUpdatedAt` compare-and-swap semantics and return `STALE_CANVAS_STATE` when the caller is behind.

## Upload and attach

Uploads use `POST /api/assets/workspaces/:workspaceId`. The browser first inserts a transient upload placeholder. The API sniffs the bytes, stores the original Blob, creates an Asset, and returns `assetId`, media kind, and original rendition URL. The browser replaces the placeholder with a new independently generated node ID and calls Asset attach with the exact next canvas state.

Rendition completion updates the Asset and Meta projection; it does not rewrite the node. Images resolve preview/original, videos resolve poster/original, uploaded documents resolve poster, and audio resolves original.

Replacing media creates a new Asset, detaches the old `(assetId, nodeId)`, and attaches the same node ID to the new Asset in two explicit membership transactions. It never overwrites immutable Blob bytes in place.

## Generated output projection

Lineage planning persists API-owned branch marker nodes and edges. The browser may show transient media placeholders, but it does not persist membership for them.

On final media settlement the API:

1. stores and registers the original Blob;
2. projects a final image/video node using the stable pending node ID derived from the media-run assignment, not the Asset ID;
3. rebalances the branch forest with shared canvas-engine settings;
4. attaches the Asset and Workspace canvas in one reference transaction;
5. publishes `CanvasGeometryUpdate` snapshots and edges with the persisted layout revision.

Cancellation settlement publishes removals for every planned pending node and preserves completed siblings.

Capability Artifact outputs use the same reasoning-index branch placement, collision footprint, title, model badge, candidate review, accept/supersede, regeneration, and history surfaces. The API activates a newly persisted Artifact in the same attach transaction that adds its first node. Artifact body height is measured from complete rendered content and may grow or shrink through the shared rebalancing pipeline without changing a user-resized width. Non-media output Assets stay out of media lineage planning.

## Rendering ownership

The DOM owns editable documents, branch marker content, selection chrome, controls, and the conversation panel. PIXI owns media pixels, masks, placeholders, and high-volume visual effects. Both consume the same node geometry.

Asset rendition selection is centralized:

| Node | Visual source |
|---|---|
| image | `preview`, falling back to `original` where appropriate |
| video | `poster` for still state; `original` for playback |
| audio | `original` |
| uploaded document | `poster` |
| editable document | Asset `content` document role |
| Capability Artifact | Registered `capabilityArtifact` ProseMirror schema and frontend factory |

Authenticated API URLs are resolved at render time. Tokens are not persisted in Workspace state or Asset documents.

## Global versus local edits

Global changes mutate the Asset:

- title;
- descriptor;
- scope and ACL;
- document snapshots under a lease;
- rendition/lifecycle state.

Local changes mutate the Workspace:

- node position and dimensions;
- edges and handles;
- selection and grouping topology;
- panel tabs and context chips.

Changing an Asset title updates every placement after the Asset event/reload. Moving one node never changes another placement.

## Workspace deletion

Only an owner can delete a Workspace. The API marks the Workspace as deleting, removes all Asset workspace references, then deletes the Workspace Main/Meta rows and every Access-List row from the embedded access list. Final-reference Assets enter maintenance. Capability Runs remain separate records governed by Capability-run retention.

Organization/user-scoped Assets attached elsewhere survive. Blob deletion is controlled exclusively by Blob reference counts.

## Related documentation

- [Data Storage](../platform/DATA-STORAGE.md)
- [Rendering Engine](../../packages/lixpi/canvas-engine/docs/RENDERING-ENGINE.md)
- [Edges & Connections](../../packages/lixpi/canvas-engine/docs/EDGES-AND-CONNECTIONS.md)
- [Branch Lineage](../media-generation/BRANCH-LINEAGE.md)
- [Chat Panel & Sessions](../ai-chat/CHAT-PANEL-AND-SESSIONS.md)
