---
title: Media Library
description: The Asset-backed media catalog, scope-aware listing, attachment, global metadata, and deletion.
---

# Media Library

The Media surface is an Asset catalog. It is not a separate media-library entity, table, copy, or Object Store bucket.

Every uploaded/generated media item, document, and conversation is already an Asset with an initial catalog reference. Reuse adds Workspace references or changes scope; it does not copy bytes. Capability Artifact Assets use the separate Artifacts surface and are intentionally excluded from Media.

## Listing

`AssetService.list()` requests paginated `Assets-Meta` projections. The API queries the requester’s available partitions:

- every accessible `workspace#<workspaceId>`;
- `user#<userId>`;
- every `organization#<organizationId>`;
- `principal#<userId>` for explicit grants.

Pages are merged by `updatedAt`, deduplicated by `assetId`, filtered by lifecycle/category, and returned with an opaque cursor. The API can filter `primaryCategory` to image, video, audio, document, conversation, or `capabilityArtifact`. The Media panel explicitly excludes conversations and Capability Artifacts; the Artifacts panel exclusively requests `capabilityArtifact`.

Meta rows contain only list-card data: title, category, scope/owner/origin, lifecycle/media state, thumbnail/preview hashes, MIME/size/dimensions, and descriptor summary/tags.

The workspace Media picker filters this authorized catalog to Assets attachable to its current workspace. Workspace-scoped Assets owned by another workspace remain available through that workspace but are not offered as insertion targets elsewhere.

## Prompt-reference search

The inline `@` picker uses the separate `Assets-Search` projection for bounded prefix autocomplete rather than loading the full library. Unlike the account-wide Media library, its partitions are restricted to the active workspace, current user, active workspace organization, and explicit principal grants. Workspace-scoped Assets from sibling workspaces and Assets from other organizations are never queried or returned. Media search rows are keyed by authorized scope and `<media-kind>#<normalized-title>#<assetId>`. Artifact rows use `capabilityArtifact#<artifactTypeId>#<normalized-title>#<assetId>` and carry the registered type/schema discriminators. An Artifact is returned only when every Asset cited by its document is also usable from the active workspace. Both contain thin display metadata and exclude conversation Assets. Scope and principal-grant rows mirror `Assets-Meta`; create, title/scope update, grant/revoke, repair, and deletion maintain both projections.

Deployment backfill uses the existing `asset.maintenance.repairProjections` job: enqueue one repair for each active Asset so the same authoritative projection repair populates missing search rows and deletes stale ones.

Search rows are advisory and never authorize content. The API point-authorizes every selected Asset when it reads `prompt_reference` atoms from the submitted conversation and separately verifies that its scope is usable from the active workspace. If the Asset also has a current-canvas placement, that placement ranks first and may carry its real `nodeId`; otherwise the reference remains Asset-only. Selecting either form does not call `asset.reference.attach` and does not mutate the canvas.

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

The API authorizes scope/access and commits the node plus workspace reference atomically. Multiple placements in one workspace share one reference row with multiple node IDs. User- and organization-scoped Assets can create separate reference rows in other authorized workspaces; workspace-scoped Assets can only be placed in their owning workspace.

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

Generated Capability Artifacts use the same candidate/accepted/superseded output review contract, but readiness comes from a valid Artifact document plus sealed provenance rather than a media rendition. They appear only in Artifacts. See [Action Timeline](./ACTION-TIMELINE.md).

## Related code

- [`services/api/src/models/asset.ts`](../../services/api/src/models/asset.ts)
- [`services/api/src/NATS/subscriptions/asset-subjects.ts`](../../services/api/src/NATS/subscriptions/asset-subjects.ts)
- [`services/web-ui/src/services/asset-service.ts`](../../services/web-ui/src/services/asset-service.ts)
- [`services/web-ui/src/infographics/workspace/mediaLibraryPanel.ts`](../../services/web-ui/src/infographics/workspace/mediaLibraryPanel.ts)
- [`services/web-ui/src/infographics/workspace/artifactLibraryPanel.ts`](../../services/web-ui/src/infographics/workspace/artifactLibraryPanel.ts)
