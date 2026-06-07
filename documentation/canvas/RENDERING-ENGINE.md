---
title: Rendering Engine
description: The workspace canvas renderer spine — the DOM interaction shell, the PIXI v8 visual layers, renderer ownership by workload, the viewport bridge, the sync pipeline, render scheduling, and the PIXI initialization contract.
---

# Rendering Engine

The workspace canvas is a **DOM interaction shell with PIXI v8 visual layers**. Two renderers cooperate, split by workload rather than by node type:

- **DOM** owns text-rich controls and interaction structure: ProseMirror, the workspace-owned AI Chat panel and Sessions surface, the right-side Media Library panel, prompt inputs, bubble menus, resize/drag/selection orchestration, parent-child containment, and handles. The AI Chat panel can be open with zero tabs; its UI state is persisted in canvas state.
- **PIXI v8** owns high-volume pixels, connector strokes, and canvas chrome: image pixel rendering, video poster/placeholder rendering, generated-image progress outlines, workspace connector pixels, image-node selection chrome, and marquee/group overlays.

This page covers that split and the machinery that keeps DOM and PIXI in lockstep: the layer stack, the viewport bridge, viewport state ownership, the sync pipeline, render scheduling, and the PIXI initialization contract.

{% callout type="note" %}
The canonical architectural rationale — *why* the canvas splits work between DOM and PIXI, and what the leading media-heavy canvases do — lives in [Rendering Architecture for a Media-Heavy Canvas](../knowledge/RENDERING-ARCHITECTURE-FOR-MEDIA-HEAVY-CANVAS.md). This page documents the *current implementation*; that page documents the *decision*.
{% /callout %}

The renderers map to concrete modules:

| Renderer | Owns | Module |
|----------|------|--------|
| PIXI media layer | Image pixels, video posters/placeholders, generated-image progress outlines, connector pixels, image-node selection chrome, marquee/group overlays | [`pixiMediaLayer.ts`](../../services/web-ui/src/infographics/workspace/pixiMediaLayer.ts) |
| DOM video chrome | Completed video playback and controls in the transformed chrome layer (browser-composited `<video>`) | See [Video Player Controls](../media-generation/VIDEO-PLAYER-CONTROLS.md) |
| Reusable PIXI outline | Traveling progress outlines | [`utils/animations/gradients/pixiTravelingOutlineRenderer.ts`](../../services/web-ui/src/utils/animations/gradients/pixiTravelingOutlineRenderer.ts) |

The current path is **renderer ownership by workload**: DOM owns text-rich controls and interaction structure; PIXI owns high-volume pixels, connector strokes, and canvas chrome.

## Why This Matters

When working on canvas code, you need to know two libraries:

1. **`@xyflow/system`** for pan/zoom and connection math (no Svelte/React wrappers). The Svelte layer (`WorkspaceCanvas.svelte`) is a thin binding.
2. **PIXI v8** for the media layer (`Application`, `Container`, `Sprite`, `Texture`). The PIXI documentation is the source of truth: <https://pixijs.com/8.x/guides/components/application>.

For everything about level-of-detail tiers, the texture cache, the decode pool, mipmaps, the edge renderer diff, and the performance tuning constants, see [Image Rendering Performance](./IMAGE-RENDERING-PERFORMANCE.md). This page covers ownership and the per-frame sync machinery; that page covers throughput and memory.

## Canvas implementation code

The active canvas implementation lives in `services/web-ui/src/infographics/`. Key files:

| File | Purpose |
|------|---------|
| `workspace/WorkspaceCanvas.ts` | Main canvas orchestrator: DOM nodes, ProseMirror integration, drag/resize/selection, viewport, and PIXI media sync points |
| `workspace/aiChatPanelState.ts` | Persisted AI Chat panel defaults and context-chip sanitization |
| `workspace/mediaLibraryPanel.ts` | Framework-agnostic Media Library surface: Feature adapter, saved image/video browsing, scope filters, and insertion actions |
| `workspace/media-library-panel.scss` | Right-side Media Library layout and full-content wrapping rules |
| `utils/resolveCollisions.ts` | Shared geometry-agnostic rectangle collision resolver used by workspace insertion, generated image commit, and drag-release cleanup paths |
| `workspace/pixiMediaLayer.ts` | PIXI v8 media layer for image pixels, video posters/placeholders, and generated-image outline synchronization — sprite registry, texture cache, LoD-tier loader, visibility scanner, prefetch scheduler |
| `workspace/pixiMediaLayerLogic.ts` | Pure helpers: tier ranking, world-position math, src URL building, LoD-size param injection, world-rect math |
| `utils/animations/gradients/pixiTravelingOutlineRenderer.ts` | Reusable PIXI traveling outline renderer — rounded-path math, track/segment painting, shared easing, active-only animation loop |
| `workspace/pixiImageDecoder.ts` | Six-worker decode pool: round-robin dispatch with per-worker request tracking |
| `workspace/pixiImageDecodeWorker.ts` | Worker body: `fetch` → `createImageBitmap` and post the bitmap back |
| `workspace/rendering/pixiEdgeRenderer.ts` | PIXI edge renderer (diffed; reuses `Graphics`) |
| `workspace/rendering/viewportBridge.ts` | Single call site that applies a viewport to DOM CSS and PIXI media |
| `workspace/branchTreeLayout.ts` | Builds the generated-media branch forest, lays each lineage out as a balanced tidy tree, and feeds rigid per-tree boxes to the shared resolver (see [Collision Resolution](./COLLISION-RESOLUTION.md)) |
| `utils/layoutTree.ts` | Pure, geometry-agnostic block-allocation tidy-tree layout reused by `branchTreeLayout.ts` |
| `workspace/rendering/mediaNodeRegistry.ts` | Dispatches non-image media nodes to specialized handlers; video nodes are handled by `videoNodeHandler.ts` |
| `workspace/rendering/videoNodeHandler.ts` | Video node renderer that owns PIXI poster/placeholder sprites and the authenticated `HTMLVideoElement` consumed by DOM video chrome |
| `workspace/workspaceRenderStatePlan.ts` | Pure render-state reconciliation for pending local visual commits while store acknowledgements arrive |
| `workspace/workspaceViewportStatePlan.ts` | Pure stale viewport-only render guard; keeps delayed store viewport updates from overriding the live transform |
| `workspace/WorkspaceConnectionManager.ts` | Edge creation, proximity connect, candidate detection, and the data feed for `pixiEdgeRenderer` |
| `connectors/index.ts` | Connector exports for path helpers and connection utilities |
| `utils/zoomScaling.ts` | Zoom-compensated handle scaling |

Use the incremental canvas architecture documented here as the implementation recipe: preserve the existing `infographics/workspace` entrypoint, harden the PIXI media layer, and move one renderer responsibility at a time only after parity checks pass.

## Canvas Configuration Ownership

All configurable web UI settings belong in [`settings.ts`](../../services/web-ui/src/settings.ts). This includes feature flags, colors, shadows, dimensions, gaps, hit radii, animation timing, title sizing, generated-image placement spacing, and other values that product/design tuning may reasonably adjust without changing the interaction algorithm.

Do not add new configurable magic-number constants or UI behavior flags directly to [`WorkspaceCanvas.ts`](../../services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts), Svelte wrappers, PIXI rendering layers, or helper modules. Add them to `settings` first and read them from the consuming code. For example, the AI chat resize/drag rail hit target lives at `settings.aiChatThread.rail.dragGrabWidth`, and the Media Library uses `settings.mediaLibrary.panelWidthFraction`.

`settings` must stay organized by logical groups. Each top-level group is its own subsection, such as `aiChatThread`, `connector`, `selection`, or `imageNode`; a group may contain nested subsections when a domain has a clear child domain, such as `aiChatThread.rail`. Every group and nested group must have a blank line before and after it in the object literal. Every key must have a short comment explaining what the value means and how changing it affects the application. Do not create a second global web UI settings module.

Use object getters in `settings` only when a setting must compute its value from sibling keys with `this`, such as a `styles` list referencing sibling `palettes`. Static values must remain plain properties; do not use getters just to organize or label settings.

## `@xyflow/system` reference

The vendored `@xyflow/system` package has its own documentation set stored in [`../vendor-documentation/xyflow/`](../vendor-documentation/xyflow/overview.md). Start from the top-level guide and follow its links to per-module docs:

```text
documentation/vendor-documentation/xyflow/
  overview.md                    ← start here (system vs wrappers, limitations, Lixpi integration)
  src/
    ├── pan-zoom.md              — Viewport pan & zoom (XYPanZoom)
    ├── drag.md                  — Node dragging (XYDrag)
    ├── connections.md           — Connection handles (XYHandle)
    ├── resize.md                — Node resizing (XYResizer)
    ├── minimap.md               — Minimap (XYMinimap)
    ├── edge-routing.md          — Edge path calculation (bezier, smoothstep, straight)
    ├── dom-contract.md          — CSS classes, DOM structure, z-index layers, theming
    ├── types-and-constants.md   — Type hierarchies, coordinate spaces, error IDs
    └── utilities.md             — Coordinate conversion, spatial math, node adoption
```

## Rendering Architecture

### Layer Stack

The canvas is a stack of three layers inside `.workspace-pane`. Two are CSS-transformed DOM viewports and one is a PIXI canvas; all three share one viewport transform every frame (see [Viewport Bridge](#viewport-bridge)).

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#F6C7B3', 'primaryTextColor': '#5a3a2a', 'primaryBorderColor': '#d4956a', 'secondaryColor': '#C3DEDD', 'secondaryTextColor': '#1a3a47', 'secondaryBorderColor': '#4a8a9d', 'tertiaryColor': '#DCECE9', 'tertiaryTextColor': '#1a3a47', 'tertiaryBorderColor': '#82B2C0', 'lineColor': '#d4956a', 'textColor': '#5a3a2a'}}}%%
flowchart TB
    subgraph Pane[".workspace-pane"]
        subgraph Viewport[".workspace-viewport (z-index 1, CSS-transformed)"]
            DOC[Document Nodes]
            THR[AI Chat Thread Nodes]
            IMG_DOM[Image Node DOM shells<br/>data-node-id + interaction chrome]
            HANDLE[Handles, drag overlays, resize handles]
        end
        subgraph PixiCanvas[".workspace-pixi-media-layer (z-index 2, PIXI canvas)"]
            WORLD[Pixi world Container<br/>scale = viewport.zoom<br/>position = viewport.x, y]
            EDGE_PIXI[edgeLayer: PIXI Graphics edges]
            IMG_SPR[image sprites + colorRect placeholders]
            GEN_BORDER[generatingBorderLayer: traveling generation progress paths]
            FG[fgLayer: selection outlines, marquee, group overlay]
        end
        subgraph ImageChrome[".workspace-image-chrome-viewport (z-index 3, CSS-transformed)"]
            IMG_CHROME[Generated-image provider badge<br/>info button + provenance panel]
            VIDEO_CHROME[Visible video surface<br/>shared SVG controls]
        end
    end

    Viewport --> PixiCanvas
    WORLD --> EDGE_PIXI
    WORLD --> IMG_SPR
    WORLD --> GEN_BORDER
    WORLD --> FG
    PixiCanvas --> ImageChrome
```

The PIXI media canvas sits **above** the DOM viewport. Generated-image provider badges, info buttons, full-width provenance panels, and completed video DOM surfaces sit in `.workspace-image-chrome-viewport`, a separate CSS-transformed DOM overlay above the PIXI media canvas. Provenance panels use the exact image-node width and expand to their full content height, so long prompts and reference metadata are not cropped. Video chrome uses the same viewport transform but is positioned over the PIXI poster sprite so browser playback, seeking, Picture-in-Picture, fullscreen, and the shared SVG controls documented in [Video Player Controls](../media-generation/VIDEO-PLAYER-CONTROLS.md) stay independent from connector rendering. Image/video node DOM shells are kept as `<div data-node-id>` elements for two reasons:

1. They host core interaction chrome — drag overlay and resize handles.
2. They provide stable DOM geometry for selection, drag, resize, and bubble-menu integration.

Canvas image nodes create no DOM `<img>` element. Stored, external, data-URL, and generated partial image sources all go through the PIXI media layer, so there is no duplicate hidden loader or fallback pixel surface. Completed video nodes are the deliberate exception: PIXI renders the poster/placeholder and stable geometry, while the actual MP4 frames come from the visible DOM `<video>` element in chrome. Generated-image partial pixels and the traveling in-progress outline are rendered by PIXI, not by a DOM/SVG overlay.

There is no separate branch-origin layer: a branch lineage's first generated image **is** the branch root, carries its own provenance (originating prompt + references on `generatedBy`), and renders through the normal media + chrome path. How a lineage is placed as a balanced tidy tree is documented in [Branch Lineage & Provenance](../media-generation/BRANCH-LINEAGE.md) and [Collision Resolution](./COLLISION-RESOLUTION.md).

### Viewport Bridge

Pan/zoom flows through a single call site so DOM and the media PIXI world stay in exact agreement on every frame.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#F6C7B3', 'primaryTextColor': '#5a3a2a', 'primaryBorderColor': '#d4956a', 'secondaryColor': '#C3DEDD', 'secondaryTextColor': '#1a3a47', 'secondaryBorderColor': '#4a8a9d', 'tertiaryColor': '#DCECE9', 'tertiaryTextColor': '#1a3a47', 'tertiaryBorderColor': '#82B2C0', 'lineColor': '#d4956a', 'textColor': '#5a3a2a'}}}%%
flowchart LR
    XY[XYPanZoom<br/>onTransformChange] --> CB[onTransformChange callback<br/>WorkspaceCanvas.ts]
    CB --> VB[viewportBridge.applyViewport]
    VB --> CSS[viewport CSS transform<br/>translate + scale]
    VB --> CHROME[image chrome overlay CSS transform<br/>translate + scale]
    VB --> PIXI[pixiMediaLayer.setViewport]
    PIXI --> WORLD[world.position / world.scale]
    PIXI --> VIS[scheduleVisibilityUpdate<br/>rAF-coalesced]
    PIXI --> PRE[schedulePrefetch<br/>idle-coalesced]
    PIXI --> RND[scheduleRender<br/>rAF-coalesced]
```

This gives DOM and the media PIXI world a single, consistent transform every frame. PIXI renders stay owned by their layer schedulers instead of being triggered from unrelated viewport acknowledgement paths.

### Viewport State Ownership

During active pan, zoom, drag, and resize, the live viewport in [`WorkspaceCanvas.ts`](../../services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts) is the rendering source of truth. The Svelte/store viewport is an acknowledgement and persistence path, not an authority that can replay over the live transform while the canvas is already on screen.

This rule exists because stale viewport-only renders can look exactly like node-position bugs. The failure signature is:

- `viewportChanged: true`
- `visualStateChanged: false`
- `needsRerender: false`
- `oldViewport` and `newViewport` differ by a large pan delta
- no drag commit, node upsert, edge sync, or PIXI live-transform event explains the visual move

In that state, applying the incoming store viewport through `viewportBridge.applyViewport(...)` teleports the DOM viewport and PIXI media world together. The user sees media jump even though no node changed position. The effect is easiest to reproduce after panning far enough that a node leaves the visible area and then dragging or revealing it again, because the stale viewport delta is large and PIXI culling makes the transform replay visually obvious.

Keep these ownership rules intact:

1. `XYPanZoom` `onTransformChange` must update `lastTransform`, `currentCanvasState.viewport`, and any pending local visual commit viewport immediately before calling `viewportBridge.applyViewport(...)`.
2. [`WorkspaceCanvas.svelte`](../../services/web-ui/src/components/WorkspaceCanvas.svelte) must persist canvas state with the current live `viewport`, even when the caller passes a `CanvasState` object captured before the latest pan.
3. Debounced viewport saves must capture the scheduled viewport and abort if a newer viewport arrives before the timer fires.
4. Store renders that only change viewport, do not change visual node/edge state, do not require a full rerender, and disagree with the live viewport must preserve the live viewport. That guard is isolated in [`workspaceViewportStatePlan.ts`](../../services/web-ui/src/infographics/workspace/workspaceViewportStatePlan.ts).
5. Do not call `viewportBridge.applyViewport(...)` from stale-render acknowledgement paths. Use `panZoom.syncViewport(liveViewport)` to keep XYFlow's internal state aligned with the live transform without repainting a stale transform onto DOM and PIXI.

{% callout type="warning" %}
Regression coverage lives in [`workspaceViewportStatePlan.test.ts`](../../services/web-ui/src/infographics/workspace/workspaceViewportStatePlan.test.ts), [`workspaceRenderStatePlan.test.ts`](../../services/web-ui/src/infographics/workspace/workspaceRenderStatePlan.test.ts), and the viewport ownership source-shape tests in [`workspace-canvas.test.ts`](../../services/web-ui/src/infographics/workspace/workspace-canvas.test.ts). If you change viewport persistence, render-state reconciliation, or PIXI viewport sync, update those tests in the same change.
{% /callout %}

### Sync Pipeline

`pixiMediaLayer.sync(canvasState)` is called from the canvas orchestration points that actually need visual layer reconciliation: initial create, full DOM node rerenders, local `commitCanvasState`, and incoming store renders whose node/edge visual sync key changed. Viewport-only renders do not resync media entries; they go through the viewport bridge or the stale viewport guard. Each media sync:

1. Removes deleted entries: `releaseTexture` → `spatialIndex.remove` → destroys sprite + colorRect.
2. Calls `upsertAllEntries` → image nodes update directly and video nodes route through `mediaNodeRegistry` to `videoNodeHandler`; each changed entry updates only what actually changed:
   - **Sprite transform** (position + width/height): always updated; cheap matrix update.
   - **Color-rect geometry** (`Graphics.clear()` + `roundRect()` + `fill()`): rebuilt only when width or height changed since last upsert.
   - **Spatial index entry**: removed and re-inserted only when the world rect actually changed.
   - **Video chrome attachment**: the handler owns the authenticated `HTMLVideoElement`; `WorkspaceCanvas.ts` positions that same element in `.workspace-video-chrome` when the node is complete.
3. Reconciles `generatingBorderLayer` from the transient generating-node set by synchronizing bounds into `PixiTravelingOutlineRenderer`; each active generated image gets its PIXI track and traveling segment until completion or failure clears it.
4. Single `updateVisibleImages()` pass to mark renderable flags and fire texture loads for newly-visible entries.
5. Schedules an idle prefetch tick.
6. Schedules a render via rAF.

### Render Scheduling

PIXI's auto-ticker is **disabled** (`autoStart: false` + `app.ticker.stop()`). Every render goes through `scheduleRender()`, which coalesces multiple call sites into one `requestAnimationFrame(() => app.render())`. `PixiTravelingOutlineRenderer` runs a bounded rAF loop only while an outline datum is active; when no generation is active, the media layer has no continuous render cost.

`updateVisibleImages` is also rAF-coalesced (`scheduleVisibilityUpdate`), so a 60 Hz wheel-zoom that triggers `setViewport` on every tick performs the spatial-index scan + entry iteration **once per frame**, not 60 times.

## PIXI Initialization Contract

`createPixiMediaLayer` accepts an `onHealthChange(health)` callback for `initializing → ready → destroyed`. PIXI initialization errors are fatal: the app logs the initialization error and rethrows it. Canvas image nodes do not create a DOM pixel fallback.

Stored, external, and generated-image partial sources are resolved and rendered through PIXI only. Video nodes resolve the poster through PIXI, but completed playback uses the browser-composited `<video>` element created by `videoNodeHandler.ts` and hosted by `WorkspaceCanvas.ts`. `WorkspaceCanvas.ts` publishes active generating node IDs to `pixiMediaLayer`, which supplies bounds to `PixiTravelingOutlineRenderer` until completion or failure.

## Source-of-Truth Diagram

A single pan or zoom gesture flows from the input device through `XYPanZoom`, into the viewport bridge, and out to all viewport consumers in one frame; texture fetches happen only for entries that actually need a higher tier.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant XY as XYPanZoom
    participant WC as WorkspaceCanvas.ts
    participant VB as viewportBridge
    participant PIXI as pixiMediaLayer
    participant Pool as Decode Pool (6 workers)
    participant API as Image API

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: PAN OR ZOOM
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over User, API: PHASE 1 - PAN OR ZOOM
        User->>XY: wheel / drag / pinch
        activate XY
        XY->>WC: onTransformChange(transform)
        activate WC
        WC->>VB: applyViewport(viewport)
        activate VB
        VB->>VB: viewportEl.style.transform
        VB->>PIXI: setViewport(viewport)
        deactivate VB
        deactivate WC
        deactivate XY
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: COALESCED VISIBILITY + RENDER
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over User, API: PHASE 2 - COALESCED VISIBILITY + RENDER (one rAF)
        activate PIXI
        PIXI->>PIXI: world.position / world.scale
        PIXI->>PIXI: scheduleVisibilityUpdate (rAF)
        PIXI->>PIXI: updateVisibleImages — RBush search
        PIXI->>PIXI: ensureTextureForEntry per visible
        PIXI->>PIXI: schedulePrefetch (idle, capped 20)
        PIXI->>PIXI: scheduleRender (rAF)
        PIXI->>PIXI: app.render()
        deactivate PIXI
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 3: TEXTURE FETCH (only for entries that need a higher tier)
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(242, 234, 224)
        Note over User, API: PHASE 3 - TEXTURE FETCH
        activate PIXI
        PIXI->>Pool: decodeImageInWorker(url)
        activate Pool
        Pool->>API: GET /api/images/:workspaceId/:fileId?size=...
        activate API
        API-->>Pool: image bytes
        deactivate API
        Pool->>Pool: createImageBitmap
        Pool-->>PIXI: ImageBitmap (transferred)
        deactivate Pool
        PIXI->>PIXI: Texture.from(bitmap)<br/>autoGenerateMipmaps = true
        PIXI->>PIXI: sprite.texture = texture<br/>scheduleRender
        deactivate PIXI
    end
```

The level-of-detail tier selection, the texture-loading rules behind `ensureTextureForEntry`, the decode pool, and the texture cache that this diagram references are all documented in [Image Rendering Performance](./IMAGE-RENDERING-PERFORMANCE.md).

## Related pages

- [Image Rendering Performance](./IMAGE-RENDERING-PERFORMANCE.md) — LoD tiers, texture cache, decode pool, mipmaps, edge renderer, optimizations, known issues, tuning constants.
- [Rendering Architecture for a Media-Heavy Canvas](../knowledge/RENDERING-ARCHITECTURE-FOR-MEDIA-HEAVY-CANVAS.md) — the canonical rationale for the DOM/PIXI split.
- [Video Player Controls](../media-generation/VIDEO-PLAYER-CONTROLS.md) — the DOM video chrome layer and the shared SVG control bar.
- [Branch Lineage & Provenance](../media-generation/BRANCH-LINEAGE.md) — how generated media gets parentage, branch identity, and provenance (carried on the branch-root image), and how a lineage is laid out as a balanced tree.
- [`@xyflow/system` reference](../vendor-documentation/xyflow/overview.md) — pan/zoom and connection math.
