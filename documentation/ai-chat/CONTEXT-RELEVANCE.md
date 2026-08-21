---
title: Explicit Workspace Context
description: How prompt references and composer context chips become authorized model inputs without canvas-wide relevance selection.
---

# Explicit Workspace Context

AI turns receive workspace content only when the user attaches it to the submitted message or adds it to the composer's context tray. Unselected canvas nodes, connected nodes, and generated outputs from earlier turns are not candidates for automatic inclusion.

The API enforces this boundary. Browser snapshots are request hints, not permission to load arbitrary workspace media.

## Context Sources

Two user actions add context:

- **Prompt reference atoms** are typed references embedded in the authoritative latest user message. They can reference media, documents, Capability Artifacts, Tools, Skills, or Capability modules.
- **Composer context chips** are canvas nodes explicitly added to the context tray before submit. They can reference images, videos, documents, or Capability Artifacts.

Plain canvas proximity, connector edges, branch membership, recency, and descriptor similarity do not add context. A follow-up such as "make it warmer" must carry the intended media as a prompt reference or context chip.

## Request Path

1. `buildWorkspaceContextSnapshot()` emits entries only for the submitted context-chip node IDs.
2. Media candidate builders emit only media node IDs explicitly attached to that turn.
3. The NATS handler rebuilds the latest user message from the conversation Asset, extracts prompt reference atoms, and authorizes every referenced Asset or Capability against the active workspace's scope chain. Sibling-workspace and foreign-organization Assets are rejected even when the user can access them elsewhere.
4. The handler filters browser candidate snapshots against `explicitReferenceCandidateIds` before it reads Asset records or Blob renditions.
5. `resolveWorkspaceContext()` deterministically selects `isExplicitChip` nodes. It does not call a relevance model, rank descriptors, inspect unselected nodes, or expand context from canvas edges.
6. Documents and Capability Artifacts are expanded into text or typed model inputs. Images and videos resolve to authorized image renditions; video context uses a representative frame or poster.
7. Prompt-reference media and context-chip media are merged into the explicit media candidate set.
8. `resolveMediaBranch()` may inspect those explicit media pixels to assign target, style, and lineage roles. Every explicit candidate remains in `referenceCandidateIds`, so role assignment cannot remove an attached reference or introduce another canvas node.

If attached free-form reference matching or media-role target assignment is ambiguous between at least two authorized Assets, the API persists the candidates and pauses the durable media request. The planned operation node opens an anchored picker. Choosing one candidate reauthorizes every binding and resumes the same request/revision chain; closing or reloading does nothing, and only explicit Cancel cancels it. If duplicate canvas candidates collapse to one underlying Asset, the API keeps that Asset as context and plans a targetless fresh branch because the picker has no choice to resolve.

For media-generation turns, the provider projection replaces attached Asset display titles and matched filename/title variants with request-scoped `REFERENCE_n` aliases before reasoning. Authorized descriptors, depiction medium, and subject-identity classification preserve meaning. Unmatched text remains unchanged user intent. See [Media Reference Identity and Provider Moderation](../media-generation/MEDIA-REFERENCE-IDENTITY-AND-MODERATION.md).

## Browser Payloads

`WorkspaceContextSnapshot` contains only explicitly attached canvas nodes:

```typescript
type WorkspaceContextSnapshot = {
    resolverVersion: string
    workspaceId: string
    conversationAssetId: string
    promptText: string
    nodes: WorkspaceContextNode[]
}
```

Each `WorkspaceContextNode` carries the node and Asset identity plus enough metadata to format context after authorization. `isExplicitChip` must be `true` for the API to retain the node. `isEdgeForced` remains a transport compatibility field and is ignored by context resolution.

`MediaBranchCandidateSnapshot.explicitReferenceCandidateIds` is the media allowlist. Candidates outside that list are dropped before authorization. Asset-only prompt references use `asset:<assetId>` candidate identities because they have no canvas node ID.

## API Resolution

`WorkspaceContextResolution` remains the streamed result contract used by placement and context UI:

```typescript
type WorkspaceContextResolution = {
    resolverVersion: string
    selections: Array<{
        nodeId: string
        role: 'forced-chip'
    }>
    narrowedMediaNodeIds: string[]
}
```

The API emits `CONTEXT_RELEVANCE_RESOLVED` for protocol compatibility. Runtime selections are deterministic and contain only explicit chips.

## Content Expansion

- Documents load their authorized `content` ProseMirror snapshot.
- Images load an authorized preview or original rendition.
- Videos load `representativeFrame`, then fall back to poster or thumbnail.
- Capability Artifacts validate their registered Artifact schema, serialize their document, authorize cited Assets, and attach the cited media, audio, or document inputs.
- Prompt reference atoms are read only from the latest authoritative user message.

Full media bytes and document contents are resolved after authorization. The browser never supplies trusted Blob coordinates.

## Relevant Code

- [`ai-image-branching.ts`](../../services/web-ui/src/services/ai-image-branching.ts)
- [`prompt-reference-resolver.ts`](../../services/api/src/services/prompt-reference-resolver.ts)
- [`ai-interaction-subjects.ts`](../../services/api/src/NATS/subscriptions/ai-interaction-subjects.ts)
- [`workspace-context-resolver.ts`](../../services/api/src/llm/graph/workspace-context-resolver.ts)
- [`media-branch-snapshot.ts`](../../services/api/src/llm/graph/media-branch-snapshot.ts)
- [`media-branch-resolver.ts`](../../services/api/src/llm/graph/media-branch-resolver.ts)
