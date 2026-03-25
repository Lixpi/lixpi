# Canvas Engine

The workspace canvas is built directly on top of `@xyflow/system` — the framework-agnostic core package. It does **not** use `@xyflow/svelte` or `@xyflow/react`. All pan/zoom, drag, resize, and connection logic is wired manually to vanilla TypeScript classes that receive DOM elements and callbacks.

## Why This Matters

When working on canvas code, you must understand `@xyflow/system` directly — not the Svelte or React wrapper APIs. The Svelte layer (`WorkspaceCanvas.svelte`) is a thin binding that passes DOM elements into the framework-agnostic engine.

## Documentation Navigation

### Canvas feature documentation

For the workspace feature itself — node types, stores, services, data flow, architecture diagrams — see `documentation/features/WORKSPACE-FEATURE.md`.

### @xyflow/system reference

The vendored `@xyflow/system` package has its own documentation set stored in `documentation/vendor-documentation/xyflow/` (persistent, not inside the vendored submodule). Start from the top-level guide and follow its links to per-module docs:

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

### Canvas implementation code

The framework-agnostic canvas engine lives in `services/web-ui/src/infographics/`. Key files:

- `WorkspaceCanvas.ts` — Main canvas class, wires `@xyflow/system` primitives
- `WorkspaceConnectionManager.ts` — Edge creation, proximity connect, candidate detection
- `ConnectorRenderer.ts` — Edge/connector SVG rendering
