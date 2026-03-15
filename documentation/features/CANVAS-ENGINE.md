# Canvas Engine

The workspace canvas is built directly on top of `@xyflow/system` — the framework-agnostic core package. It does **not** use `@xyflow/svelte` or `@xyflow/react`. All pan/zoom, drag, resize, and connection logic is wired manually to vanilla TypeScript classes that receive DOM elements and callbacks.

## Why This Matters

When working on canvas code, you must understand `@xyflow/system` directly — not the Svelte or React wrapper APIs. The Svelte layer (`WorkspaceCanvas.svelte`) is a thin binding that passes DOM elements into the framework-agnostic engine.

## Documentation Navigation

### Canvas feature documentation

For the workspace feature itself — node types, stores, services, data flow, architecture diagrams — see `documentation/features/WORKSPACE-FEATURE.md`.

### @xyflow/system reference

The vendored `@xyflow/system` package has its own documentation set. Start from the top-level guide and follow its links to per-module docs:

```
packages-vendor/xyflow/packages/system/xyflow-DOCUMENTATION.md    ← start here
  └── src/xypanzoom/DOCUMENTATION.md       — Pan & zoom
  └── src/xydrag/DOCUMENTATION.md          — Node dragging
  └── src/xyhandle/DOCUMENTATION.md        — Connection handles
  └── src/xyresizer/DOCUMENTATION.md       — Node resizing
  └── src/xyminimap/DOCUMENTATION.md       — Minimap
  └── src/utils/DOCUMENTATION.md           — General utilities
  └── src/utils/edges/DOCUMENTATION.md     — Edge path utilities
  └── src/types/DOCUMENTATION.md           — Types
  └── src/constants.DOCUMENTATION.md       — Constants
  └── src/styles/DOCUMENTATION.md          — Styles & DOM contract
```

### Canvas implementation code

The framework-agnostic canvas engine lives in `services/web-ui/src/infographics/`. Key files:

- `WorkspaceCanvas.ts` — Main canvas class, wires `@xyflow/system` primitives
- `WorkspaceConnectionManager.ts` — Edge creation, proximity connect, candidate detection
- `ConnectorRenderer.ts` — Edge/connector SVG rendering
