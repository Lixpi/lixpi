# Infographics Module

This module provides framework-agnostic rendering primitives for interactive canvas UI. Pan, zoom, drag, resize, and connection behavior stays in the canvas core. The TypeScript view host owns application stores, services, DOM mount points, and lifecycle.

## Why Framework-Agnostic?

The canvas core should not depend on application state wiring. Isolating rendering and interaction code here lets us:

- Change the view host without rewriting canvas behavior
- Test canvas behavior independently of application state wiring
- Keep the view host thin by wiring DOM refs and callbacks

## How It Uses @xyflow/system

We leverage `@xyflow/system` as the interaction engine. It provides:

- **XYPanZoom** — handles viewport transformations (pan, zoom, pinch)
- **Coordinate math** — converts between screen and canvas coordinates
- **Event filtering** — respects `.nopan` and `.nowheel` class markers

We call the low-level `@xyflow/system` APIs and manage our own DOM. This gives us full control over rendering while reusing its interaction logic.

```
┌─────────────────────────────────────────────────────────────┐
│                   TypeScript View Host                      │
│  (workspaceCanvasView.ts)                                   │
│  - Creates DOM refs                                         │
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
├── shapes/                 # Shape primitives (rectangles, etc.)
└── workspace/              # Workspace canvas implementation
    ├── WorkspaceCanvas.ts  # Core canvas logic
    └── workspace-canvas.scss
```

## Design Principles

1. **No application-view imports in core logic** — `WorkspaceCanvas.ts` receives DOM elements and callbacks.

2. **Callbacks over stores** — The canvas doesn't know about `workspaceStore`. It calls `onCanvasStateChange()` and lets the caller decide what to do.

3. **Styles live with logic** — SCSS files sit next to their TypeScript counterparts, not scattered across component folders.

4. **Class-based interaction markers** — Elements with `.nopan` don't trigger viewport panning. Elements with `.nowheel` don't trigger zoom. This lets embedded editors work naturally.
