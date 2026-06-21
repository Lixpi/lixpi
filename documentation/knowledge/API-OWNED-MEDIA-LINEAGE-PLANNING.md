---
title: API-Owned Media Lineage Planning
description: Why media branch topology is planned by the API and only applied visually by the browser.
---

# API-Owned Media Lineage Planning

Media lineage is distributed-system state. The browser can collect candidate context and render geometry, but it must not decide branch topology. All generated-media branch IDs, branch-root markers, branch-fork markers, lineage parent IDs, and marker provenance are API-owned.

This is a hard architecture boundary. Do not implement fallback branch/fork decisions in `services/web-ui`, even temporarily. If the browser lacks a topology decision, fix the API contract or stream timing so the browser receives one. The frontend must fail visibly or wait for API state rather than inventing branch lineage from selected models, local canvas state, prompt text, candidate order, persisted legacy fields, existing edges, or currently mounted DOM nodes.

## Failure Over Fallbacks

Media lineage code must be exact. A missing or inconsistent API lineage plan is a contract failure, not a cue to recover locally.

Do not add:

- UI-side branch IDs, marker IDs, lineage-parent selection, fork grouping, or marker provenance.
- model-count heuristics that decide whether a request forked by reasoning model or media model.
- edge-derived parent recovery, existing-node metadata recovery, DOM-state recovery, or candidate-order recovery.
- compatibility shims that keep older lineage topology alive by reconstructing missing fields.
- provider/router fallback assignments when a concrete media run does not have an exact `MediaRunLineageAssignment`.

The allowed responses are: wait for the API event that carries the contract, fail the request visibly, or fix the API/data migration path. Do not make the browser or provider routers guess.

## Ownership Boundary

The browser sends useful context:

- `WorkspaceContextSnapshot` for descriptor-first relevance.
- `ImageBranchCandidateSnapshot` for media candidates, labels, existing branch hints, and prompt fingerprinting.
- Explicit context chips, selected canvas media, and edge-connected context.

These inputs are non-authoritative. They exist so the API can make a grounded decision with the current request state. The browser may use them for pending outlines and placement hints, but it must not turn them into branch/fork decisions.

Uploaded media, media-library media, first-frame images, style references, and workspace-relevance selections are references unless the API verifies that the selected node is already a generated-media branch member. They can anchor placement, but they must not become generated-output connector parents. Reference-only requests must be rooted through API lineage structure such as `branchOrigin`, not through the referenced source media.

The API owns the decisions:

- `resolveWorkspaceContext` narrows the workspace context.
- `resolveImageBranch` uses the structured VLM resolver to select target/reference/excluded media when candidates exist, and synthesizes a fresh-branch resolution in the API when the candidate list is empty.
- `MediaBranchLineagePlanner` converts the resolver result into a `MediaBranchLineagePlan`.
- `StreamPublisher.mediaLineagePlanned()` emits `MEDIA_LINEAGE_PLANNED` before media partials or completions.

## Lineage Plan Contract

`MediaBranchLineagePlan` is the browser-facing topology contract. It assigns:

- `branchId`
- `sourceNodeId` and `placementAnchorNodeId`
- `branchOrigin.nodeId` and neutral root provenance
- `branchForks[].nodeId` and `branchForks[].parentBranchNodeId`, assigned per reasoning run rather than per media model
- per-run `MediaRunLineageAssignment`
- generated-media lineage fields: `parentMediaNodeId`, schema alias `parentImageNodeId`, `branchOriginNodeId`, `branchForkNodeId`, references, source context, operation kind, prompt text, prompt fingerprint, and creation ordering

Matrix requests run the planner once in shared preflight, then pass the plan to every reasoning child. Single media requests run the same planner as the `planMediaBranchLineage` graph node. `MediaGenerationRunPlanner` is the shared media-agnostic run layer used by single requests, matrix reasoning runs, image routers, and video routers to assign stable reasoning/media run IDs and attach exact lineage assignments. No image/video provider-specific code should decide lineage parentage, synthesize marker topology, or fall back to a reasoning-level assignment when a concrete media-run assignment is missing.

## Branch-Root Provenance

A `branchOrigin` marker is neutral lineage chrome. Its metadata describes only:

- the user's prompt,
- the references/context supplied to the request,
- the API decision that this request starts or forks a generated branch.

It must not include a child reasoning model's prompt rewrite, response text, media-run metadata, or model-specific output. When a request immediately forks into several reasoning runs, each `branchFork` carries the reasoning-run provenance for its dedicated branch. The branch root stays model-neutral.

## Browser Responsibilities

`WorkspaceCanvas.ts` applies the plan to canvas state:

- create planned `branchOrigin` and `branchFork` marker nodes if referenced by generated media,
- add planned fork edges,
- persist `generatedBy` lineage fields from `MediaRunLineageAssignment`,
- compute marker/media positions from visible canvas geometry,
- run branch-tree tidy layout and collision cleanup.

Those are presentation responsibilities. The browser must not derive `branchOriginNodeId`, `branchForkNodeId`, `parentMediaNodeId`, lineage-parent selection, fork count, or marker provenance from selected models, prompt text, selected nodes, local canvas order, previous canvas nodes, connector edges, persisted aliases, or candidate-snapshot contents.

## Extension Rule

Future media pipelines should depend on the `MediaBranchLineagePlan` contract, not on a specific provider graph or matrix orchestrator. Add new provenance fields by extending the plan and assignment types first, then teach publishers and browser applicators to pass them through. Do not hide new topology decisions inside `WorkspaceCanvas.ts`, provider routers, marker renderers, or branch-tree layout code.
