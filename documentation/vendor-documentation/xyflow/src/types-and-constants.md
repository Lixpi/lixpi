# Types and Constants

This document explains the key type hierarchies and constant conventions in `@xyflow/system`, focusing on the mental model rather than specific fields.

## Node Type Hierarchy

Nodes go through a transformation pipeline:

**`NodeBase`** → **`InternalNodeBase`** → (stored in `NodeLookup`)

`NodeBase` is what the user provides: position, data, type, parent, extent, dimensions. These are the "user nodes."

`InternalNodeBase` wraps a user node with computed internal state:
- `internals.positionAbsolute` — The node's absolute position (accounting for parent offset)
- `internals.handleBounds` — Measured handle positions (source/target arrays)
- `internals.z` — Computed z-index (from selection state, parent hierarchy, elevation settings)
- `internals.userNode` — Reference back to the original user node (for equality checks)

The `adoptUserNodes` function performs this transformation. It's called whenever the node array changes, converting user nodes into internal nodes, updating the `NodeLookup` (a `Map<string, InternalNodeBase>`), and building the `ParentLookup` for hierarchy traversal.

## Edge Types

Similar structure: `EdgeBase` is the user-provided edge (source, target, type, data). There's no deep internal transformation like nodes — edges are stored directly in an `EdgeLookup` Map.

The `Connection` type is the minimal form: `{ source, target, sourceHandle, targetHandle }`. A `Connection` is what `onConnect` receives — it's up to the consumer to create an `EdgeBase` from it.

`ConnectionInProgress` extends this with real-time drag state: the `from`/`to` positions, the pointer position, validity state, and handle metadata. This is what the connection line component renders from.

## Handle Types

A `Handle` has: `id`, `nodeId`, `type` (source/target), `position` (which side of the node: Top/Right/Bottom/Left), and absolute `x`/`y` coordinates.

The `position` determines the default direction for edge routing — a handle at `Position.Right` means edges leave going rightward.

## Change Types

The system uses a discriminated union of change types to batch node and edge updates:

Node changes: `NodeDimensionChange`, `NodePositionChange`, `NodeSelectionChange`, `NodeRemoveChange`, `NodeAddChange`, `NodeReplaceChange`

Edge changes: `EdgeSelectionChange`, `EdgeRemoveChange`, `EdgeAddChange`, `EdgeReplaceChange`

Each has a `type` discriminator field. The wrappers' `onNodesChange` / `onEdgesChange` callbacks receive arrays of these, and `applyNodeChanges` / `applyEdgeChanges` apply them immutably.

When using `@xyflow/system` directly, you handle changes yourself — this change system is a convenience provided by the wrapper layer.

## Transform

The viewport transform is a triple: `[x, y, zoom]` (type alias `Transform`). This maps directly to the CSS transform applied to the viewport element: `translate(x, y) scale(zoom)`.

`Viewport` is the object form: `{ x, y, zoom }`. These are interchangeable — utility functions accept both.

## Coordinate Spaces

Two coordinate spaces matter:

- **Screen space** — Pixel coordinates relative to the container's top-left corner
- **Canvas space** (renderer space) — The infinite coordinate system that nodes live in

`pointToRendererPoint` converts screen → canvas: `canvasPos = (screenPos - [tx, ty]) / zoom`

`rendererPointToPoint` converts canvas → screen: `screenPos = canvasPos × zoom + [tx, ty]`

## Extent

Node movement boundaries. Three forms:
- `undefined` — No constraint (infinite canvas)
- `CoordinateExtent` — `[[minX, minY], [maxX, maxY]]` in absolute coordinates
- `'parent'` — Constrained to the parent node's bounds (only valid for child nodes)

The system's `infiniteExtent` constant is `[[-Infinity, -Infinity], [Infinity, Infinity]]` — a no-op extent.

## Error Messages

Error messages are defined in `constants.ts` as numbered functions (`error001` through `error015`). They only fire in development mode via `devWarn`. Key ones to know:

- **error004** — Container has no width/height (most common setup mistake)
- **error005** — `extent: 'parent'` used on a node without a parent
- **error013** — Styles not loaded (CSS import missing)

## Z-Index Mode

Three modes for controlling node stacking:
- **`basic`** (default) — Selected nodes elevate to z-index 1000
- **`auto`** — Like basic, but parent nodes get incrementing z-index bases so child nodes always render above their parents
- **`manual`** — No automatic z-index management; you set z-index on each node yourself
