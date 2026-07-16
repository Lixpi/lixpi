---
title: Media Library
description: The Asset-backed media catalog, scope-aware listing, attachment, global metadata, and deletion.
---

# Media Library

The Media surface is an Asset catalog. It is not a separate media-library entity, table, copy, or Object Store bucket.

Every uploaded/generated media item, document, and conversation is already an Asset with an initial catalog reference. Reuse adds Workspace references or changes scope; it does not copy bytes.

## Listing

`AssetService.list()` requests paginated `Assets-Meta` projections. The API queries the requester’s available partitions:

- every accessible `workspace#<workspaceId>`;
- `user#<userId>`;
- every `organization#<organizationId>`;
- `principal#<userId>` for explicit grants.

Pages are merged by `updatedAt`, deduplicated by `assetId`, filtered by lifecycle/category, and returned with an opaque cursor. The UI can filter `primaryCategory` to image, video, audio, document, or conversation.

Meta rows contain only list-card data: title, category, owner/origin, lifecycle/media state, thumbnail/preview hashes, MIME/size/dimensions, and descriptor summary/tags.

## Library cards

Cards render global Asset metadata and the authorized thumbnail rendition:

```text
GET /api/assets/:assetId/renditions/thumbnail
```

Opening an Asset point-loads its aggregate and optional document snapshots. No card depends on a canvas node or workspace-local byte registry.

## Add to canvas

Adding a catalog Asset creates a new random node ID and an appropriate node type/dimensions. The browser sends `asset.reference.attach` with:

- `assetId`;
- target `workspaceId`;
- new `nodeId`;
- the expected and next Workspace canvas state/revision.

The API authorizes scope/access and commits the node plus workspace reference atomically. Multiple placements in one workspace share one reference row with multiple node IDs. Placements in other workspaces create separate reference rows.

## Global metadata

Title and descriptor are Asset-level fields. Updating either uses Asset `revision` and rewrites all relevant Meta projections in the same transaction. Every placement resolves the same title/descriptor after the Asset event or reload.

Node position, dimensions, edges, and selection remain workspace-local.

## Scope

Assets can be workspace, user, or organization scoped. Scope change validates all existing workspace references against the target accessible-workspace set before moving the catalog/Meta projection. It never moves or copies Blob objects.

Explicit ACL storage exists for viewer/editor grants. Sharing UX is separate from this storage contract.

## Remove and delete

Removing a node detaches only `(assetId, workspaceId, nodeId)`. The Asset survives when another node, surface, workspace, or catalog reference remains.

Removing the catalog reference is explicit. The final reference transition marks the Asset deleting and queues maintenance. Maintenance releases document/rendition Blob references and deletes zero-reference objects. There is no special media-library deletion path.

## Generated media

Generated outputs are Assets from preflight, before bytes exist. They appear with creating/processing state and settle to ready/degraded/failed/cancelled. Their original and derived renditions are attached to the same Asset identity; no “save generated image to library” copy is required.

## Related code

- [`services/api/src/models/asset.ts`](../../services/api/src/models/asset.ts)
- [`services/api/src/NATS/subscriptions/asset-subjects.ts`](../../services/api/src/NATS/subscriptions/asset-subjects.ts)
- [`services/web-ui/src/services/asset-service.ts`](../../services/web-ui/src/services/asset-service.ts)
- [`services/web-ui/src/infographics/workspace/mediaLibraryPanel.ts`](../../services/web-ui/src/infographics/workspace/mediaLibraryPanel.ts)
