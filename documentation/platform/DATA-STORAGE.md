---
title: Data Storage
description: The revision-2 Asset and Blob storage model: DynamoDB tables, content-addressed organization Object Stores, references, leases, projections, and maintenance.
---

# Data Storage

Lixpi stores every user-created document, standalone conversation, upload, and generated media result as an **Asset**. Immutable media bytes, Capability manifests and resources, and ProseMirror snapshots are content-addressed **Blobs**. Workspaces store local geometry and panel state; they never own media bytes or duplicate global Asset metadata.

The active runtime has no document table, chat-thread table, media-library table, workspace file registry, or workspace-specific Object Store bucket.

## Ownership boundaries

| Record | Owns | Does not own |
|---|---|---|
| `Workspace` | Canvas viewport, node geometry, edges, panel tabs, local context chips | Titles, descriptors, bytes, document snapshots, Asset lifecycle |
| `Asset` | Stable identity, global title, scope, owner, optional media/document/lineage components, states, revision, edit lease | Binary bytes and large JSON documents |
| `Asset-Meta` | Compact list projection ordered by `updatedAt` | ACLs, references, full documents, rendition maps |
| `Asset-Search` | Thin scope/category/normalized-title autocomplete projection | Authorization, full Assets, conversation rows |
| `Asset-Access-List` | Per-principal grants | Workspace membership |
| `Asset-References` | Catalog membership and workspace placements/surfaces | Blob ownership |
| `Blob` | Organization-scoped hash, object address, MIME, byte size, status, reference count | Product semantics |
| `Blob-References` | Asset or Capability ownership of a Blob | Product scope or ACL |
| `Capability` package | Kind, scope, owners, status, module membership/exposure, and current manifest hash | Manifest and resource bytes or top-level module presentation metadata |
| `Prompt-Reference-Recent` | Per-user reference identity and last accepted-use timestamp | Authorization or display metadata |
| `Capability Run` | Sealed manifest hashes, owner, origin, state, steps, and output Asset IDs | Event payload bytes |

## DynamoDB tables

The Asset/Blob tables and their prompt-reference projections are defined in [`DynamoDB-tables.ts`](../../infrastructure/pulumi/src/resources/db/DynamoDB-tables.ts).

| Table | Partition key | Sort key | Indexes |
|---|---|---|---|
| `Assets` | `assetId` | — | none |
| `Assets-Meta` | `scopeAndOwner` | `assetId` | LSI `updatedAt` only |
| `Assets-Search` | `scopeAndOwner` | `searchKey` | none |
| `Assets-Access-List` | `assetId` | `principalId` | none |
| `Asset-References` | `assetId` | `referenceKey` | none |
| `Blobs` | `blobKey = organizationId#sha256` | — | none |
| `Blob-References` | `blobKey` | `referenceKey` | none |
| `Prompt-Reference-Recents` | `userId` | `referenceKey` | LSI `updatedAt` |

There are no GSIs on these tables. Listing queries bounded `Assets-Meta` partitions. Prompt autocomplete queries authorized `Assets-Search` partitions by `begins_with(<media-kind>#<normalized-title>)`, merges and deduplicates thin rows, and still point-authorizes the selected Asset before use. Conversation Assets are not projected into media search. Authorization and ordinary maintenance use point reads or one Asset/Blob partition. Maintenance-only orphan collection scans staging Blob rows and organization IDs; request paths do not.

Capability-package storage uses `Capabilities`, `Capabilities-Meta`, `Capabilities-Access-List`, and `Capability-Runs` alongside the Asset/Blob tables. Source-registered top-level Capability modules remain authoritative in the module registry; their contained packages carry `parentModuleId` plus `catalogExposure: 'module-internal'`. Workspaces include `organizationId`; every Asset or organization-owned Capability package created from a workspace uses that organization rather than selecting an arbitrary organization from the user account.

## Asset aggregate

`Asset` is component-based rather than type-discriminated:

```ts
type Asset = {
  assetId: string
  organizationId: string
  title: string
  scope: 'workspace' | 'user' | 'organization'
  scopeOwnerId: string
  originWorkspaceId: string
  ownerUserId: string
  documents: Partial<Record<'content' | 'conversation' | 'provenance', AssetDocumentPointer>>
  media?: AssetMedia
  lineage?: AssetLineage
  descriptor?: ContentDescriptor
  states: AssetStates
  referenceCount: number
  revision: number
  editLease?: AssetEditLease
  createdAt: number
  updatedAt: number
}
```

`primaryCategory` is computed in `Asset-Meta`: media kind wins; otherwise conversation wins over content; otherwise the Asset is a document. Invalid component combinations are rejected by the model.

All global mutations use the integer `revision` as their concurrency token. Timestamps are display/order data, not compare-and-swap tokens.

## Scope, ACL, and list projections

`scopeAndOwner` is one of:

- `workspace#<workspaceId>`
- `user#<userId>`
- `organization#<organizationId>`
- `principal#<principalId>` for explicit-grant projections

The list API queries every scope partition available to the requester plus the requester’s principal partition, merges by `updatedAt`, removes duplicates, filters deleting rows, and returns an opaque multipart cursor.

Changing scope validates every workspace reference before moving the catalog and Meta projection. A scope cannot be narrowed when an existing reference would become inaccessible. Blob keys never change when scope changes.

Asset create, title update, scope change, grant/revoke, repair, and deletion maintain `Assets-Meta` and `Assets-Search` together. Grant/revoke operations update the ACL row, principal Meta/search projections, base/other projections, and Asset revision in one conditional transaction. They cannot overwrite the owner's permanent `owner` row or race a metadata update into a stale principal projection.
The model caps total Asset projection scopes at 32 so the authority mutation plus Meta and search writes remain below DynamoDB's 100-operation transaction limit; a grant beyond that bound is rejected before writing.

`Prompt-Reference-Recents` stores at most 100 stable identities per user. Accepted authoritative submissions upsert recents; empty picker queries reauthorize the newest five in the active category, remove stale rows, then fill from current catalog results. Recents never grant access.

## References and deletion

Reference keys are typed:

- `catalog#<scope>#<scopeOwnerId>` keeps an Asset in a catalog.
- `workspace#<workspaceId>` stores `nodeIds[]` and `surfaceIds[]` for that workspace.

One workspace row counts once regardless of how many canvas nodes or document/panel surfaces it contains. Attach/detach transactions update the Workspace canvas and Asset reference row together when a canvas node is involved. A normal full canvas save must preserve the exact `(assetId, nodeId)` membership signature; it may change geometry, edges, viewport, and panel metadata only.

When the last reference is removed, the same transaction sets lifecycle `deleting`. The durable maintenance worker then:

1. verifies that the Asset is still deleting with zero references;
2. purges its Asset-document subjects;
3. removes its Blob references idempotently;
4. deletes zero-reference Blob objects;
5. deletes Asset ACL, Meta, and aggregate rows under revision conditions.

Workspace deletion removes every workspace reference and every catalog owned by that workspace before removing the Workspace triad. Only a Workspace owner can delete it.

## Content-addressed Blobs

Each organization owns one bucket:

```text
blobs-<organizationId>-files
```

Object keys are deterministic:

```text
sha256/<first-two-hex>/<64-character-sha256>
```

`BlobModel.store()` hashes the bytes, verifies any existing object at that key, creates a staging row if necessary, and returns the row. Product records activate Blobs by transactionally inserting a unique `Blob-References` row and incrementing the Blob counter. Duplicate bytes reuse one object and one Blob row.

Object Store writes cannot participate in DynamoDB transactions. Recovery therefore uses:

- immutable hash keys;
- `staging → active → deleting` states;
- conditional reference counts;
- a periodic collector for old zero-reference staging rows;
- a daily sweep that removes aged hash-addressed objects with no Blob registry row, covering an Object Store success followed by a DynamoDB failure;
- idempotent object and row deletion.

Capability package references use `capability#<capabilityId>#manifest` and `capability#<capabilityId>#resource#<resourceId>`. Asset document and rendition references use `asset#<assetId>#document#<role>` and `asset#<assetId>#rendition#<name>`.

Capability manifests and resources use the system Blob bucket for deployment-owned global entries and the owning organization bucket for user or organization entries. Catalog edits store and verify new resources first, store canonical manifest JSON, then conditionally swap the catalog pointer. A sealed run keeps its captured hashes, so superseded Blob references remain readable through the retirement grace period. See [Capability Storage and Operations](../library/CAPABILITY-STORAGE.md).

## Renditions

The API owns Asset state and Blob registration. NEX owns only heavy byte transformation. Jobs contain organization/Asset/Blob coordinates and request a versioned rendition set.

| Kind | Required rendition parity |
|---|---|
| image | original, preview, thumbnail; canonical when needed |
| video | original, preview, poster, thumbnail, representative frame; canonical when needed |
| audio | original; canonical when needed |
| document | original, poster, thumbnail; canonical PDF when needed |

NEX writes immutable hash-addressed output objects and returns hashes, MIME types, sizes, dimensions, duration, page count, and per-rendition failures. It never writes Asset tables. The API reads and hashes returned objects before registering them and transactionally replacing rendition references.

An Asset is `ready` only when required renditions are ready. It is `degraded` when a playable/model-safe source exists but a derived rendition failed. Bounded durable retries repair degraded Assets; repeated failure remains visible with stable error codes.

Provenance rebuild failures use self-renewing durable maintenance messages with exponential backoff capped at five minutes. Rebuilds read the persisted conversation snapshot and fall back to a minimal terminal projection after bounded retries, so the response-specific pipeline subject can be purged immediately after the final conversation and canvas writes settle.

## Asset documents and leases

Asset document roles are `content`, `conversation`, and `provenance`. Each pointer references an immutable JSON Blob and records ProseMirror version/schema metadata. Titles exist only on the Asset.

Live steps use the organization stream `ASSET_STEPS_<organizationId>` and subjects:

```text
asset.document.steps.<organizationId>.<assetId>.<role>
```

Client editing requires a 30-second workspace lease renewed every 10 seconds. Active holder records let multiple editors and API writers in the lease-owning workspace share it; releasing the last holder removes it immediately. Other workspaces mount read-only. Settlement replays accepted steps onto the latest snapshot, stores a new JSON Blob, and swaps the pointer/reference under both Asset revision and lease-token conditions. Provenance rejects client steps and is written only by the provenance materializer.

## HTTP byte routes

Authorized bytes are served from:

```text
GET /api/assets/:assetId/renditions/:renditionName
```

Audio/video responses support HTTP Range requests. `download=true` adds a content-disposition filename. Upload and public-URL import use:

```text
POST /api/assets/workspaces/:workspaceId
POST /api/assets/workspaces/:workspaceId/import-url
```

The API validates workspace access, uses the workspace’s organization, sniffs bytes, stores the original Blob, creates the Asset, and starts rendition processing. The browser attaches the resulting `assetId` to a distinct canvas `nodeId` through the Asset attach transaction.

## Revision-2 portability

Workspace archives contain `manifest.json` plus `blobs/<sha256>`. The manifest includes workspace state, recursively referenced Assets, target-workspace references, lineage, document pointers, rendition maps, and one entry per unique Blob hash.

Import validates the entire graph, every byte size, and every SHA-256 before writes. It generates new Asset IDs, remaps canvas/panel/lineage identities, rewrites and rehashes every ProseMirror snapshot containing Asset identities, assigns target-workspace ownership/scope, creates fresh owner ACL/catalog/reference rows, then replaces canvas state. Exported ACLs and external catalog grants are never imported.

The only version-1 boundary is the offline converter documented in [Workspace Export & Import](../library/WORKSPACE-EXPORT-IMPORT.md).
