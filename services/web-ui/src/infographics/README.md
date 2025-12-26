# Infographics Module

This module provides framework-agnostic rendering primitives for interactive canvas-based UI components. The core idea is simple: keep the heavy lifting (pan, zoom, drag, resize, connections) in vanilla TypeScript, and let framework-specific wrappers (like Svelte components) handle only what they're good at—reactivity and lifecycle.

## Why Framework-Agnostic?

We don't want to rewrite canvas logic every time we switch frameworks or need to support multiple ones. By isolating rendering and interaction code here, we can:

- Swap out Svelte for React or vanilla JS without touching core logic
- Test canvas behavior independently of UI framework quirks
- Keep components thin—they just wire up DOM refs and callbacks

## How It Uses @xyflow/system

We leverage `@xyflow/system` as the interaction engine. It provides:

- **XYPanZoom** — handles viewport transformations (pan, zoom, pinch)
- **Coordinate math** — converts between screen and canvas coordinates
- **Event filtering** — respects `.nopan` and `.nowheel` class markers

We do NOT use React Flow or Svelte Flow components directly. Instead, we call the low-level `@xyflow/system` APIs and manage our own DOM. This gives us full control over rendering while benefiting from battle-tested interaction logic.

```
┌─────────────────────────────────────────────────────────────┐
│                     Svelte Component                        │
│  (WorkspaceCanvas.svelte)                                   │
│  - Binds DOM refs                                           │
│  - Subscribes to stores                                     │
│  - Passes callbacks                                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              infographics/workspace/                        │
│  (WorkspaceCanvas.ts)                                       │
│  - Creates DOM nodes                                        │
│  - Wires XYPanZoom                                          │
│  - Handles drag/resize                                      │
│  - Instantiates ProseMirror editors                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    @xyflow/system                           │
│  - XYPanZoom for viewport control                           │
│  - Transform math utilities                                 │
│  - Event filtering (.nopan, .nowheel)                       │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
infographics/
├── animationConstants.ts   # Shared animation timing values
├── connectors/             # Edge/connection rendering (future)
├── shapes/                 # Shape primitives (rectangles, etc.)
└── workspace/              # Workspace canvas implementation
    ├── WorkspaceCanvas.ts  # Core canvas logic
    └── workspace-canvas.scss
```

## Design Principles

1. **No framework imports in core logic** — `WorkspaceCanvas.ts` doesn't import Svelte. It receives DOM elements and callbacks.

2. **Callbacks over stores** — The canvas doesn't know about `workspaceStore`. It calls `onCanvasStateChange()` and lets the caller decide what to do.

3. **Styles live with logic** — SCSS files sit next to their TypeScript counterparts, not scattered across component folders.

4. **Class-based interaction markers** — Elements with `.nopan` don't trigger viewport panning. Elements with `.nowheel` don't trigger zoom. This lets embedded editors work naturally.
