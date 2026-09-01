---
title: Lixpi workspace canvas
description: Product canvas behavior, host ports, generated-output presentation and persistence ownership.
---

# Lixpi workspace canvas

This package renders Lixpi's workspace: Asset-backed documents, images, video, audio, document posters, registered Capability Artifacts and API-declared branch markers. The bottom-center composer submits prompts; the right panel hosts libraries and generated-output details. Conversations are Asset documents, not a required canvas node type.

The [package reference](../README.md) describes individual owners and public entrypoints. [Canvas Engine](../../canvas-engine/README.md) owns rendering, input, geometry and connectors. [Canvas Components](../../canvas-components/README.md) owns reusable media surfaces and effects. UI-kit retains general panels, menus, tooltips, playback controls, footers and icons; UI Primitives retains DOM, SVG and gradient utilities.

## Host composition

`WorkspaceCanvasSurface` mounts the toolbar, workspace shell and renderer through typed ports. `LixpiWorkspaceCanvas` composes nodes, geometry, generation presentation, menus, panels and effects. The application supplies store reads/subscriptions, authenticated transport, browser storage, catalogs, external navigation and generic editor construction.

Host adapters live in [web-ui canvas-adapters](../../../../services/web-ui/src/canvas-adapters). The [view](../../../../services/web-ui/src/components/workspaceCanvasView/workspaceCanvasView.ts) mounts and disposes the package. It does not implement collisions, node rendering or canvas persistence policy.

Concrete Capability schemas, tools and Artifact bodies remain in Capability System modules. The package resolves installed definitions through registries and typed editor/reference ports. It does not switch on a concrete Artifact type.

`createLixpiCanvasSettings` supplies per-instance product presets. Shared API geometry constants govern both server and browser layout. The host can override palette/theme values; component layout mechanics stay in package styles. Import `/styles/workspace`; other public style entries support smaller integrations.

## Nodes and interactions

| Surface | Behavior |
|---|---|
| Document | Asset content-role editor, top drag rail, free resize and independent editor lifetime per placement |
| Image | Engine-rendered pixels, whole-node drag, aspect-preserving resize, editable title and Asset details |
| Video | Engine poster/placeholder plus browser-composited playback and an external controls row |
| Audio/document media | Native audio metadata/playback or document poster and stable fallback geometry |
| Capability Artifact | Module-registered body/editor, full-content height measurement and shared generated-output review/history |
| Operation status | Upload/conversion or generation problem presentation with admitted retry/edit/dismiss actions |
| Branch marker | Submitted prompt atoms, reasoning/request progress, API lineage identity and stop/review actions |

Plain clicking non-editor content selects a node; modifier-click toggles membership. Empty-space interaction clears selection or starts marquee selection. Editor content retains text selection. Corner hover reveals only the relevant resize control. Selection remains runtime state.

Marquee completion adds eligible document/media/Artifact selections to explicit composer context. Moving through a node during the gesture does not add a chip. Branch markers can participate in marquee selection but never become context chips; native marker click opens details instead of ordinary node selection.

A group overlay appears for multiple selections or a marquee-origin single selection. A plain-click single selection has no group overlay. Drag threshold handling defers selection until movement or final click, avoiding an overlay intercepting the initiating mouseup. Group movement preserves relative spacing and suppresses the follow-up click that would collapse selection.

Menus appear only for a single eligible media node or edge. They hide during drag/resize and follow the node box or connector midpoint. UI-kit's BubbleMenu owns general menu layout; product actions and zoom scaling belong here. Editable content keeps normal Delete/Backspace behavior.

Image dimensions fit intrinsic proportions while preserving the resolved center. Pending media hit bounds use the visible circle, not its future rectangular envelope. Geometry, shadows, outlines and connector anchors switch to frame bounds together. Artifact height can grow or shrink after hydration/edits while preserving the user's width.

## Media and native playback

`WorkspaceMediaLayer` projects nodes into engine registrations and lists ready Asset renditions. The resolver port supplies actual rendition URLs and credentials; NEX/API materialization remains outside the renderer. Do not replace named renditions with cosmetic size query parameters.

Images have no duplicate DOM pixel loader. Source replacement retains decoded pixels until replacement succeeds. Asset refresh distinguishes descriptor changes from title-only changes, and explicit source retries reset remembered failures when materialization advances.

`WorkspaceVideoChrome` borrows the native video element from Canvas Components and mounts UI-kit controls below it. Double-click toggles playback; surface input preserves node drag/resize. Controls isolate their hit areas while empty strip space can pass canvas gestures through. Provider/info chrome follows below the control row. Removing chrome returns a borrowed video to its original host before releasing controls.

Playback position, rate, volume and fullscreen are not persisted canvas fields. Browser video frames are not sampled through a Pixi texture loop, so connector rendering remains independent of playback. [UI-kit controls](../../ui-kit/docs/VIDEO-PLAYER-CONTROLS.md) covers scrubbing and accessibility.

## Generation and lineage

The API owns request/output identities, durable branch topology, membership, cancellation and final geometry. The browser snapshots explicit context and submitted prompt atoms, displays transient preflight state and applies API projections. It does not infer a missing lineage plan from edges, model counts or DOM state.

Preflight markers and planned markers represent one request/run owner. Promotion replaces aliases and visible ownership atomically. Exact submitted reference atoms remain visible until the stored turn is available. Late events or partial marker preparation cannot create duplicate visible owners or affect another scene.

`WorkspaceMediaOperationRecovery` subscribes before replay, deduplicates sequences, follows replay pages and rejects stale revisions. Progress updates preserve mounted content. Hidden operation records identify pending outputs; a terminal failure can replace the same reserved output with an actionable operation card while preserving API lineage.

Trackers key runs by authoritative run identity. Empty partial heartbeats do not create pixels or topology. Repeated layout revisions update pixels without reapplying geometry. Final output handoff loads the ready original rendition before releasing the transient frame; a decode or bounded fallback ends the outline. Missing final geometry is reported as a projection error.

Request-level progress belongs inside branch markers. Per-output execution history belongs in the fixed details panel and does not change collision or connector bounds. Active footers show info followed by a progress ripple; terminal state removes the ripple while retaining info/history. Ready persisted outputs settle stale active presentation on hydration.

Completed sibling output does not settle another active run. Request completion removes obsolete temporary markers and aliases while retaining the API-planned scene. Closing a view releases editors and event subscriptions without cancelling backend generation; explicit stop/reject actions use authoritative cancellation ports.

## Geometry and connectors

`WorkspaceGeometry` supplies product footprints to the engine's [collision resolver](../../canvas-engine/docs/COLLISION-RESOLUTION.md). API and browser use the same branch-tree adapter and spacing contract.

Pending output reserves final horizontal width but uses the compact pre-frame vertical footprint. Finished content includes title, footer, video controls and marker envelopes where needed. Sidebar history never contributes to these measurements.

The rebalance pipeline substitutes pending/planned proxies, lays out API-declared trees, restores persisted geometry and separates each tree as a rigid bounding box. Roots keep their anchor; sibling order follows supplied variant/run metadata. Loose nodes push whole trees rather than independently moving their members. Parent-child containment is excluded and child positions remain parent-relative.

Insertion uses the visible world area. Reference-root placement considers explicit reference bounds and configured marker gaps. Drag-release policy preserves groups and manually positioned markers. A later structural add/remove can retidy the tree; progress heartbeats cannot.

Lixpi starts connections through node-menu actions and does not enable proximity connection. Engine named-port handles remain available to other consumers. Product policies align media anchors with the visible media/circle bounds and branch edges with the appropriate model circle. Message-level source anchors retain their supplied turn identity.

Edges describe relationships and lineage, not implicit AI context. Selected edges can be deleted or reconnected; accepted changes enter the workspace write session immediately. [Engine connectors](../../canvas-engine/docs/EDGES-AND-CONNECTIONS.md) covers routing and coordinate scaling.

## Details, libraries and context

Each canvas owns one right panel. Its persisted state contains open/mode/width, context chips and a selected output or branch-marker target. Hydration validates that the selected node still exists and has the expected kind. UI-kit SidePanel owns generic resizing, toggle motion and backdrop behavior; the package owns workspace content.

Generated-output details combine editable Asset metadata, description/tags, scope, identity, storage/renditions, Artifact metrics and immutable producing-turn provenance. The history starts below metadata and uses one vertical scroll body. Media info, active progress, accepted history and branch clicks open the same entrypoint.

Candidate review requires the appropriate completed content and sealed provenance. Accept/reject/regenerate actions send authoritative mutations. Variant regeneration can preserve a candidate and continue from it; prompt regeneration replaces the candidate set through normal submission. The package applies returned geometry only to the captured workspace/scene.

Capability library lists authorized Tools; internal implementation Skills are not independent catalog entries. Artifact content is resolved by registry. Media library lists attachable Workspace/user/Organization Assets, pages lightweight metadata and creates references without copying bytes.

Reference previews share a Lixpi projection over UI-kit popovers. Canvas previews mount in the owning pane at its scale; ordinary application previews use viewport-clamped portals. Each trigger and popover owns its media lifetime. Preserve inline mention order while deduplicating separately supplied canonical Asset IDs.

The composer snapshots only explicit chips and inline prompt-reference atoms. Edges, adjacency, unselected nodes and ambient generated outputs do not expand a request. The API authorizes those coordinates and resolves model inputs. Drafts use workspace-specific storage and never enter canvas geometry persistence.

## Asset hydration and editor lifetime

`WorkspaceAssetProjection` loads Assets reachable from canvas nodes, generated conversation metadata, markers and active conversation, then follows lineage source IDs. It prioritizes conversations and batches document snapshots; opening a workspace does not enumerate entire catalogs.

`WorkspaceAssetSynchronization` refreshes already-loaded Assets through instance subscriptions and periodic reconciliation. Older fetches cannot resurrect deleted Assets or overwrite a newer refresh. Hydration mounts newly available editors in place without destroying unrelated nodes.

Editor factories supply the shared ProseMirror authority driver. Each placement owns its editor scope and lease callbacks. Detached conversation editors own streaming projection and queued submission; connect transport before activation because activation can submit synchronously. Scene replacement closes admission before releasing callbacks and pending activation.

## Persistence and disposal

`WorkspaceCanvasSessionHub` retains one write session per workspace. Canvas saves and attach/detach operations share that session's ordered lane. Accepted replies update their originating session even after navigation; direct UI callbacks still require the original view/scene. Store adapters publish only to the matching active workspace and distinguish authoritative from local state.

Viewport persistence owns leading/trailing commits, pending intent, unload stash and restoration. Ordinary metadata or node saves preserve the stored viewport unless they explicitly carry viewport intent. Live pan/zoom remains visible through delayed same-workspace acknowledgments.

View disposal submits pending viewport work and releases its lease without cancelling accepted writes. Application shutdown flushes/drains/closes the session hub and reports failures. Hard page unload cannot guarantee asynchronous network completion, so the stash includes in-flight viewport intent.

Destroying a renderer closes new callback admission and attempts all cleanup even if a child throws. Scene replacement invalidates catalogs, library requests, generation callbacks, timers, editors and media owners. Two canvases retain independent rendering lifetimes; same-workspace views deliberately share persistence ordering.

## Product documentation

The [workspace model](../../../../documentation/canvas/WORKSPACE-MODEL.md), [user flows](../../../../documentation/canvas/USER-FLOWS.md), [lineage semantics](../../../../documentation/media-generation/BRANCH-LINEAGE.md) and [explicit context](../../../../documentation/ai-chat/CONTEXT-RELEVANCE.md) document product/storage contracts. Engine implementation and component manuals remain in their packages.
