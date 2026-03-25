# @xyflow/system — Overview

## What It Is

`@xyflow/system` is the framework-agnostic engine that powers both React Flow and Svelte Flow. It is **not** a UI library. It provides three things:

1. **Interactive primitives** — pan/zoom, drag, resize, and connection state machines built on D3
2. **Spatial math** — coordinate conversion, edge path calculation, bounds computation, frustum culling
3. **Type definitions** — the shared vocabulary (Node, Edge, Handle, Viewport, Connection, etc.)

It does **not** render anything. It does not manage state. It does not provide components. Those are the jobs of the framework wrappers (`@xyflow/react`, `@xyflow/svelte`) — or, in Lixpi's case, custom code.

## What the Wrappers Add (and Why Lixpi Skips Them)

The React and Svelte wrappers each add ~4000–5000 lines on top of system. They provide:

- **State management** — a reactive store tracking ~155 properties (nodes, edges, viewport, selection, interaction state, configuration flags)
- **Component tree** — NodeWrapper, EdgeRenderer, Handle, ConnectionLine, Selection, KeyHandler, Background, Controls, Minimap
- **Event coordination** — wiring pointer events to the right system primitives at the right time
- **Change processing** — `applyNodeChanges()` / `applyEdgeChanges()` helpers for immutable state updates
- **Convenience hooks** — `useReactFlow()`, `useSvelteFlow()`, `useConnection()`, etc.
- **Accessibility** — ARIA labels, live regions, keyboard navigation

Lixpi uses `@xyflow/system` directly because the workspace canvas has requirements the wrappers don't support: ProseMirror editors embedded in nodes, a two-tier connection system (handle-based + menu-based), D3 data-join rendering for edges, custom coordinate spreading for parallel edges, and tight integration with NATS-backed state.

## What You Get from System (Concretely)

| Primitive | What It Does | D3 Dependency |
|-----------|-------------|---------------|
| `XYPanZoom` | Viewport pan/zoom state machine with constraints, easing, animation | `d3-zoom` |
| `XYDrag` | Multi-node drag state machine with snap-to-grid, auto-pan, extent clamping | `d3-drag` |
| `XYHandle` | Connection drawing state machine with proximity snapping and validation | None |
| `XYResizer` | Node resize state machine with aspect ratio lock and parent/child constraints | `d3-drag` |
| `XYMinimap` | Minimap pan/zoom that delegates to the main viewport | `d3-zoom` |

Plus utility functions for:
- Edge path calculation (Bézier, straight, smooth-step)
- Coordinate conversion (screen ↔ canvas)
- Spatial queries (nodes in rect, edge visibility, bounds)
- Graph traversal (incomers, outgoers, connected edges)
- Node state management (position clamping, parent lookups, z-index)

## What You Must Build Yourself

When using system directly (as Lixpi does), you are responsible for:

| Responsibility | What the Wrappers Would Do | What You Must Do |
|---------------|---------------------------|-----------------|
| **State** | Zustand / Svelte stores with ~155 properties | Your own store — track nodes, edges, viewport, selection, interaction flags |
| **Node rendering** | `<NodeWrapper>` component with positioning, classes, drag binding | Create and position DOM elements yourself |
| **Edge rendering** | `<EdgeRenderer>` with SVG paths and interaction zones | Call path functions, render SVG yourself |
| **Handle UI** | `<Handle>` component with visual feedback | Create handle DOM, wire `XYHandle.onPointerDown` |
| **Connection line** | `<ConnectionLine>` SVG overlay | Draw the in-progress connection line yourself |
| **Selection** | `<Selection>` component with box select | Build box-select UI and multi-select state |
| **Keyboard navigation** | `<KeyHandler>` with arrow keys, Delete, Escape | Wire keyboard events yourself |
| **Accessibility** | ARIA live regions, screen reader announcements | Add aria attributes yourself |
| **NodeLookup sync** | Automatic via store subscriptions | Call `adoptUserNodes()` + `updateAbsolutePositions()` after every node change |
| **Handle bounds** | Automatic via ResizeObserver | Call `getHandleBounds()` and update nodeLookup manually |

## Limitations

- **No rendering** — system has zero DOM awareness. It returns numbers and objects. You render.
- **No reactivity** — nothing is observable. You call functions and receive return values.
- **No event binding** — system provides state machine factories that return objects with methods. You call those methods from your event handlers.
- **No undo/redo** — no history support of any kind.
- **No layout algorithms** — no auto-layout, dagre, elk, or force simulation.
- **No serialization** — no save/load. The type system defines shapes but provides no persistence.
- **NodeLookup is your burden** — the internal `Map<string, InternalNode>` must be kept in sync with your actual node state. If it drifts, connection snapping breaks silently.
- **D3 version coupling** — system depends on specific D3 module versions. Upgrading D3 independently can break zoom/drag behavior.

## How Lixpi Uses It

Lixpi's canvas integration lives in `services/web-ui/src/infographics/`. The integration pattern:

1. **XYPanZoom** — Created once per canvas. Receives the pane DOM element. Transform changes are applied as CSS `translate/scale` on the viewport element. Expensive side effects (edge re-rendering, menu repositioning) are deferred to `requestAnimationFrame`.

2. **XYHandle** — Used for handle-based connections. Lixpi also has a menu-triggered connection flow that bypasses XYHandle entirely, creating synthetic handles and tracking the connection manually.

3. **Edge path functions** — Called by the D3-based ConnectorRenderer. Lixpi extends these with custom path types (orthogonal routing, horizontal Bézier) and a t-value spreading algorithm that fans out parallel edges to prevent overlap.

4. **`adoptUserNodes`** — Called after every node structure change to keep XYFlow's internal NodeLookup in sync. Node handles are defined synthetically (not from DOM measurement) with explicit positions.

5. **Node rendering** — Entirely manual DOM creation. Each node type (document, image, AI chat thread) has its own creation function that builds elements, attaches ProseMirror editors, and registers with the connection manager.

## Source Code Location

The vendored source lives at `packages-vendor/xyflow/packages/system/src/`. When you need implementation details beyond what this documentation covers, read the source directly — it's TypeScript, well-structured, and about 9000 lines across all modules.

## Documentation Index

| Document | Covers |
|----------|--------|
| **You are here** | What system is, what it isn't, how Lixpi uses it |
| [pan-zoom.md](src/pan-zoom.md) | How the viewport pan/zoom state machine works |
| [drag.md](src/drag.md) | How multi-node dragging works |
| [connections.md](src/connections.md) | How the connection/handle system works |
| [resize.md](src/resize.md) | How node resizing works |
| [minimap.md](src/minimap.md) | How the minimap delegates to the main viewport |
| [edge-routing.md](src/edge-routing.md) | How edge paths are calculated |
| [dom-contract.md](src/dom-contract.md) | Required CSS classes, z-index layers, DOM structure |
| [types-and-constants.md](src/types-and-constants.md) | Mental model for the type system |
| [utilities.md](src/utilities.md) | Utility functions — when and why to use each |
