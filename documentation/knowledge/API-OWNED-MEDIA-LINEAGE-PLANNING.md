---
title: API-Owned Media Lineage Planning
description: Why the API assigns branch topology and output Asset identities before media generation, and how clients apply the contract.
---

# API-Owned Media Lineage Planning

The API is the sole authority for media branch topology and durable output identity. Planning happens after context/branch resolution and before reasoning/media provider fan-out.

## Contract

`MediaBranchLineagePlanner` produces one immutable `MediaBranchLineagePlan` containing:

- generation request and branch IDs;
- source and placement-anchor node IDs;
- branch origin/fork/line marker definitions;
- one `MediaRunLineageAssignment` per concrete media run;
- a stable `assetId` on each assignment.

The plan is published as `MEDIA_LINEAGE_PLANNED`, copied into each concrete `MediaGenerationRunMeta`, persisted as branch marker topology, and retained by `StreamPublisher` until request settlement.

## Why planning precedes providers

Provider responses can arrive out of order, retry, stream partials, or finish after cancellation. If the browser or completion order assigned identity, sibling results could swap Assets or attach to the wrong branch. Preassignment makes every event self-identifying by `mediaRunId` and `assetId`.

Pending Assets are created immediately from assignments. Their durable lineage is resolved from authorized candidate/context `nodeId → assetId` mappings. Browser byte URLs and inferred sibling order are never lineage inputs.

## Client responsibilities

The client may:

- render API-declared markers and transient pending media;
- apply authoritative `CanvasGeometryUpdate` revisions;
- resolve Asset state/renditions through `assetId`;
- ignore stale or cancelled request updates.

The client must not:

- derive marker IDs or lineage parents;
- create durable output Asset IDs;
- persist transient pending media through full canvas saves;
- rewrite a placement node ID into an Asset ID;
- construct Asset lineage from local edges.

## Projection and settlement

Plan projection persists markers/marker edges. Final settlement projects the media node using the stable pending node ID, rebalances with shared canvas-engine settings, and attaches Workspace membership through the Asset transaction. Cancellation uses the retained plan to publish deterministic pending-node removals.

Durable Asset lineage and canvas topology are deliberately separate: an Asset can later be attached to another workspace under a different node ID without changing provenance.
