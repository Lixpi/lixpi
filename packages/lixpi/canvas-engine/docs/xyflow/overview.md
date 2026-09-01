# XYFlow System reference

`@xyflow/system` supplies low-level viewport interaction, graph/handle geometry and path helpers. It is a runtime dependency of Canvas Engine, not a framework wrapper or a node skin. Its DOM-bound primitives do install and manage event handlers; it is not a DOM-free math library.

## Engine integration

Canvas Engine uses XYPanZoom behind ViewportController and uses structural node/handle projections for connector geometry. It owns registered node views, selection, cancellable gestures, resize policy, connector drawing and lifecycle. Public consumers do not need React Flow or Svelte Flow.

The wrappers supply component trees, state coordination, styles and accessibility facilities. Using system directly does not mean those facilities are impossible with a wrapper; the engine supplies its own composition to fit its resource and host contracts.

Scene persistence, product data and application authorization remain outside system. Layout uses separate engine geometry/tree helpers and optional ELK routing. Do not mistake the low-level dependency reference for a promise that CanvasController enables every upstream option.

## Reference pages

| Page | Concern |
|---|---|
| [Pan and zoom](src/pan-zoom.md) | Transform state, wheel filtering and viewport constraints |
| [Dragging](src/drag.md) | Upstream drag groups, extents and auto-pan |
| [Connections](src/connections.md) | Handle geometry, admission and reconnect semantics |
| [Resizing](src/resize.md) | Upstream size/parent/aspect constraints |
| [Minimap](src/minimap.md) | Upstream input mapping, not rendering |
| [Edge routing](src/edge-routing.md) | Path and label geometry |
| [DOM contracts](src/dom-contract.md) | Wrapper structure versus engine-owned styling |
| [Types](src/types-and-constants.md) | Internal node lookups and coordinate spaces |
| [Utilities](src/utilities.md) | Position conversion, bounds and node adoption |

## Maintaining the reference

Check the dependency version and its actual source when changing integration. The repository's optional vendored reference is under `packages-vendor/xyflow`; the installed dependency is resolved by the engine manifest. Avoid freezing line counts or treating a vendored snapshot as the installed version.

Review the affected primitive and engine adapter together, update the focused page, and retain [rendering lifecycle](../RENDERING-ENGINE.md) and [connector](../EDGES-AND-CONNECTIONS.md) links. Product integration belongs in the consuming package, not in this reference.
