# Canvas Engine

The workspace canvas is a **DOM/SVG interaction renderer with a PIXI v8 media layer**. The proven `services/web-ui/src/infographics/workspace/WorkspaceCanvas.ts` stack still owns all user interaction and rich UI: ProseMirror, AI chat threads, prompt inputs, bubble menus, resize/drag/selection, context regions, and SVG connectors. PIXI v8 (WebGPU with WebGL fallback) is introduced through `services/web-ui/src/infographics/workspace/pixiMediaLayer.ts` to own image pixel rendering.

The canonical architecture document is `documentation/knowledge/RENDERING-ARCHITECTURE-FOR-MEDIA-HEAVY-CANVAS.md`. Its Phase 2 guidance is important: introduce PIXI for **media nodes first**, while document/chat-thread DOM and SVG connectors remain until profiling proves they need migration.

## Why This Matters

When working on canvas code, you need to know two libraries:

1. **`@xyflow/system`** for pan/zoom and connection math (no Svelte/React wrappers). The Svelte layer (`WorkspaceCanvas.svelte`) is a thin binding.
2. **PIXI v8** for the media layer (`Application`, `Container`, `Sprite`, `Texture`). The PIXI documentation is the source of truth: <https://pixijs.com/8.x/guides/components/application>.

## Documentation Navigation

### Canvas feature documentation

For the workspace feature itself — node types, stores, services, data flow, architecture diagrams — see `documentation/features/WORKSPACE-FEATURE.md`.

### Canvas implementation code

The active canvas implementation lives in `services/web-ui/src/infographics/`. Key files:

- `workspace/WorkspaceCanvas.ts` — main canvas orchestrator, DOM nodes, ProseMirror integration, drag/resize/selection, and PIXI media-layer sync points
- `workspace/pixiMediaLayer.ts` — PIXI v8 media layer for image pixels only
- `workspace/WorkspaceConnectionManager.ts` — edge creation, proximity connect, candidate detection
- `connectors/renderer.ts` — SVG connector rendering
- `utils/zoomScaling.ts` — zoom-compensated handle scaling

Do not follow the historical full-replacement PIXI notes in `documentation/memory/pixi-refactoring.md` as an implementation recipe. The active migration path is incremental: preserve the existing `infographics/workspace` entrypoint, harden the PIXI media layer, and move one renderer responsibility at a time only after parity checks pass.

### @xyflow/system reference

The vendored `@xyflow/system` package has its own documentation set stored in `documentation/vendor-documentation/xyflow/`. Start from the top-level guide and follow its links to per-module docs:

```
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
