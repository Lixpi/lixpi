---
title: Workspace Export and Import
description: Revision-2 Asset/Blob archives, validate-first clone/remap import, and the offline version-1 converter.
---

# Workspace Export and Import

The active portability format is revision 2. It archives Workspace state, recursively referenced Assets, Asset lineage, document/media Blob metadata, and each unique Blob object once.

Version-1 archives are never read by runtime import. They must be converted offline first.

## Endpoints

```text
GET  /api/workspaces/:workspaceId/export
POST /api/workspaces/:workspaceId/import
```

Both require Workspace access. Import also verifies membership in the target Workspace’s `organizationId`.

## Archive layout

```text
workspace-assets-v2.zip
├── manifest.json
└── blobs/
    ├── <sha256>
    └── <sha256>
```

Blob filenames are hashes, not Asset IDs or original filenames. One hash appears once even when several Assets/Features would reuse the same bytes.

## Manifest

```ts
type Revision2Manifest = {
  exportVersion: 2
  exportedAt: string
  workspace: {
    name: string
    canvasState: CanvasState
    createdAt: number
    updatedAt: number
  }
  assets: Asset[]
  references: AssetReference[]
  blobs: Array<{
    blobHash: string
    mimeType: string
    byteSize: number
    sourceBlobHash?: string
    derivationKind?: AssetRenditionName
    derivationVersion?: string
  }>
}
```

ACL rows and external catalog grants are not exported as importable authority.

## Export enumeration

Export seeds Asset IDs from:

- every Asset-backed canvas node;
- conversation IDs on branch markers/generated metadata;
- conversation panel tabs and `lastActiveConversationAssetId`;
- the target workspace’s `Assets-Meta` catalog partition;
- a strongly consistent scan of `Asset-References`, filtered to the target Workspace, because the table intentionally has no inverse Workspace index.

It then recursively point-loads every Asset referenced by
`sourceConversationAssetId`, `parentAssetId`, `sourceAssetIds`, or an `assetId`
embedded in a current content/conversation snapshot. An inaccessible or dangling
lineage/embedded Asset fails export instead of silently producing an incomplete
graph.

For each Asset, export queries its reference partition and projects the target
Workspace reference. Required content/conversation surfaces are copied into that
portable reference even when the durable source surface belongs to another mount
of the same shared document. Mutable document roles are rebuilt in memory from
their settled snapshot plus later JetStream steps, so accepted live edits are
included without changing the source Asset. Export gathers document/rendition
Blob hashes plus every `sourceBlobHash` dependency, point-loads persistent Blob
rows, verifies Object Store byte size and SHA-256, and streams the ZIP without
temporary files. In-memory current document snapshots are hash-addressed virtual
archive Blobs and are not registered in the source organization.

## Validate-first import

Before any external write, import validates:

- format version and required manifest sections;
- unique/non-empty Asset IDs;
- unique valid SHA-256 Blob hashes;
- archive-wide byte ceiling;
- every Blob entry’s exact size and hash;
- every document/rendition pointer has a manifest Blob;
- Asset component/state, document-role, rendition, and lineage invariants;
- every lineage ID exists in the Asset graph;
- every reference targets an exported Asset;
- every Asset embedded in mutable content/conversation JSON has the matching document/conversation Workspace surface reference;
- canvas nodes contain no legacy storage fields;
- every Asset-backed canvas node has an exported Asset and a matching workspace node reference;
- deleting Assets are not portable.

Invalid archives return 400 with the target Workspace unchanged.

## Clone/remap behavior

Every import creates new Asset IDs, even when the same archive is imported repeatedly. Node IDs remain placement/topology IDs and are preserved.

The importer remaps:

- `CanvasNode.assetId`;
- conversation panel tab `refId` and `lastActiveConversationAssetId`;
- branch marker/generated `conversationAssetId`;
- Asset `sourceConversationAssetId`, `parentAssetId`, and `sourceAssetIds`;
- Asset IDs embedded in ProseMirror conversation/content/provenance JSON;
- Asset rendition URLs embedded in snapshots;
- Asset IDs embedded in workspace surface IDs.

Each remapped ProseMirror snapshot is serialized, rehashed, stored as a new/reused Blob, and written into the cloned document pointer. Copying the old pointer unchanged would leave thread/generated-media identities pointing at the exported Assets and is prohibited.

Imported Assets receive:

- target organization and owner;
- target-workspace scope and origin;
- a fresh owner ACL;
- a fresh target-workspace catalog;
- when the source Asset had a Workspace reference, a target-workspace reference carrying preserved node IDs/remapped surface IDs;
- `importedFromAssetId` for audit only.

Lineage-only dependencies that were not placed on the source canvas and had no source Workspace surface remain catalog-only after import. Empty Workspace references are never created.

Receiving conversations become paused. Pending renditions become stable failed rendition entries; media becomes ready, degraded, failed, or cancelled based on the portable bytes. After canvas replacement commits, degraded imported media is queued for durable reconstruction of any missing revision-2 renditions. Creating/deleting runtime states are not resumed as live work.

After all Assets exist, import replaces the target canvas state. It then detaches previous target-workspace references and removes catalogs owned by the replaced workspace. User/organization-scoped Assets survive elsewhere.

If import fails before canvas replacement, created workspace/catalog references are detached and queued Asset maintenance cleans the clones. Unreferenced staging Blobs are collected later.

## Version-1 offline converter

```text
services/api/src/debug-tools/convert-workspace-export-to-assets.ts \
  --input old-workspace.zip \
  --output workspace-assets-v2.zip
```

The converter:

- accepts only `exportVersion: 1`;
- refuses to overwrite output;
- performs no DynamoDB, NATS, or network writes;
- preassigns Asset IDs for documents, conversations, and media groups;
- groups video originals/posters/representative frames and other derivatives into one Asset rendition map;
- hashes and deduplicates every archived object;
- converts document/conversation snapshots to title-free Asset schemas and remaps embedded IDs/URLs;
- converts canvas storage fields to `assetId` while preserving node IDs;
- moves the newest valid legacy canvas descriptor onto its document/media Asset;
- derives durable Asset lineage from legacy generated metadata and node-to-Asset mappings;
- validates the output graph and all Blob pointers before writing.

The output uses placeholder migration organization/user/workspace IDs. Runtime import replaces them with target ownership and fresh Asset IDs.

## Security

- ZIP entries are addressed only by manifest SHA-256 names.
- Hash/size validation happens before Blob registration.
- Imported scope and owner are never trusted from the archive.
- Exported ACLs are discarded.
- Asset authorization is point-checked during recursive export.
- Public URL fetching is not part of archive import.

## Relevant code

- [`workspace-export-routes.ts`](../../services/api/src/routes/workspace-export-routes.ts)
- [`convert-workspace-export-to-assets.ts`](../../services/api/src/debug-tools/convert-workspace-export-to-assets.ts)
- [`asset.ts`](../../services/api/src/models/asset.ts)
- [`blob.ts`](../../services/api/src/models/blob.ts)
