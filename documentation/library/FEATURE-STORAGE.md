---
title: Feature Storage
description: Feature and Extraction Run persistence with organization-scoped content-addressed sample Blobs.
---

# Feature Storage

Features and Extraction Runs remain separate product records. They are not Assets. Feature sample bytes use the same organization Blob registry and Object Store as Asset media/documents.

## Feature records

`Features` stores the complete Feature definition. `Features-Meta` stores compact organization-list projections. Features created by extraction are organization scoped using the owning `Workspace.organizationId`; the runtime never selects an arbitrary first organization from the user account.

Feature samples contain Blob coordinates:

```ts
type FeatureSampleRef = {
  idx: number
  blobHash: string
  imageUrl?: string
  ext?: string
}
```

`imageUrl` is a presentation route, not storage authority. `blobHash` is authoritative.

## Sample creation

Extraction crop/sample stages store bytes with `BlobModel.store()` in:

```text
blobs-<organizationId>-files/sha256/<prefix>/<hash>
```

Internal generation may use data URLs while the run is active. Stage 6 writes the final Feature and then must successfully create one durable Blob reference per sample:

```text
feature#<featureId>#sample#<index>
```

The Extraction Run is not marked complete until those references exist. This prevents the staging-Blob collector from deleting samples after workspace deletion.

## Serving samples

Authorized samples use:

```text
GET /api/features/:featureId/samples/:sampleIndex
```

The route authenticates the user, resolves organization through the requested workspace (or an explicitly authorized organization), authorizes the Feature scope, loads the Blob row, and streams the hash-addressed object.

The stored route can omit query parameters; callers add the current workspace/token context when rendering. Every sample resolves through its Blob registry row and the organization Object Store bucket.

## Feature deletion

Deletion is two-phase:

1. mark Main/Meta status `removed`, making the Feature unavailable to list/get;
2. remove each Feature Blob reference and delete zero-reference Blobs;
3. delete Feature Main/Meta rows.

Blob removal is idempotent. Samples shared by content hash with Assets or other Features remain until every reference is gone.

## Extraction Runs

Extraction Runs remain API records keyed by extraction run/workspace. They own live status, selected models, transcript/trace data, source context, and terminal errors. Deleting a workspace deletes its Extraction Runs. Deleting an Extraction Run does not delete a separately saved Feature.

## Source context

Feature source context records semantic provenance such as extraction run, source workspace, and source/reference roles. It does not own sample bytes. Model context resolution turns authorized Blob hashes into internal Object Store URLs only inside the API.

## Relevant code

- [`services/api/src/models/feature.ts`](../../services/api/src/models/feature.ts)
- [`services/api/src/services/feature-sample-storage.ts`](../../services/api/src/services/feature-sample-storage.ts)
- [`services/api/src/models/blob.ts`](../../services/api/src/models/blob.ts)
- [`services/api/src/llm/extraction/stage6-persist.ts`](../../services/api/src/llm/extraction/stage6-persist.ts)
