# Utilities

`@xyflow/system` provides utility functions for coordinate conversion, spatial math, node management, and viewport calculation. This document explains when to reach for each group.

## Coordinate Conversion

**`pointToRendererPoint(screenPos, transform, snapToGrid?, snapGrid?)`** — Convert a screen-space position (relative to the canvas container) to canvas-space coordinates. Essential whenever you need to map a mouse event to a node position. If `snapToGrid` is true, the result snaps to the nearest grid intersection.

**`rendererPointToPoint(canvasPos, transform)`** — The reverse: convert canvas-space coordinates to screen-space. Use when positioning DOM overlays (tooltips, menus) at a canvas position.

**`snapPosition(position, snapGrid)`** — Snap a position to the nearest grid point. The grid is defined as `[xStep, yStep]`.

## Viewport Calculation

**`getViewportForBounds(bounds, width, height, minZoom, maxZoom, padding)`** — Given a bounding rectangle in canvas space, calculate the viewport transform that fits those bounds into the given container dimensions. Supports asymmetric padding (per-side, in pixels or percentages). This powers "fit to view" functionality.

The padding system is flexible:
- A number like `0.1` means 10% of the viewport on each side
- A string like `"20px"` means 20 pixels
- An object `{ top, right, bottom, left }` or `{ x, y }` for per-side control

## Spatial Math

**`getNodesBounds(nodes, { nodeOrigin?, nodeLookup? })`** — Calculate the bounding rectangle that encloses all given nodes. Accepts node objects or node IDs (if `nodeLookup` is provided). The returned `Rect` is in canvas coordinates.

**`getBoundsOfRects(rect1, rect2)`** — Merge two rectangles into one that encloses both.

**`getOverlappingArea(rectA, rectB)`** — Calculate the pixel area of overlap between two rectangles. Returns 0 if they don't overlap. Used for frustum culling (skip rendering edges outside the viewport) and intersection detection.

**`nodeToRect(node, nodeOrigin?)`** / **`nodeToBox(node, nodeOrigin?)`** — Convert a node to a `Rect` or `Box` (internal representation). `Rect` uses `{ x, y, width, height }`, `Box` uses `{ x, y, x2, y2 }`.

## Position and Clamping

**`clampPosition(position, extent, dimensions?)`** — Clamp a position within a `CoordinateExtent`, optionally accounting for node dimensions so the entire node stays within bounds.

**`clampPositionToParent(childPos, childDimensions, parentNode)`** — Clamp a child node's position within its parent's bounds. Convenience wrapper over `clampPosition` that extracts the parent's absolute position and dimensions.

**`getNodePositionWithOrigin(node, nodeOrigin)`** — Adjust a node's position by its origin offset. A node with origin `[0.5, 0.5]` has its position at its center; this function returns the top-left corner position.

## Node Adoption

**`adoptUserNodes(nodes, nodeLookup, parentLookup, options?)`** — The main function for converting user-provided node arrays into the internal representation. It:
1. Creates or updates `InternalNodeBase` entries in the `NodeLookup`
2. Computes absolute positions (accounting for parent chains)
3. Parses handle bounds from the node's `handles` array (if provided)
4. Calculates z-index based on selection state and z-index mode
5. Builds the `ParentLookup` for hierarchy traversal
6. Returns whether all nodes are initialized (have measured dimensions)

Equality checking: if `checkEquality` is true (default), the function compares user node references. If a user node hasn't changed (`===` reference equality), its internal node is reused without recalculation.

**`updateAbsolutePositions(nodeLookup, parentLookup, options?)`** — Recalculate absolute positions for all nodes without re-adopting. Use after position changes that don't add/remove nodes.

## Handle Utilities

**`getHandleBounds(type, nodeElement, nodeBounds, zoom, nodeId)`** — Measure handle positions from the DOM. Queries `.source` or `.target` class elements within the node and calculates their positions relative to the node bounds. Returns an array of `Handle` objects.

**`getHandlePosition(node, handle, fallbackPosition, useAbsolute?)`** — Get the absolute position of a handle on a node. Combines the node's position with the handle's relative offset. If `useAbsolute` is true, uses `positionAbsolute` instead of `position`.

## Auto-Pan

**`calcAutoPan(position, bounds, speed?, distance?)`** — Given a position within a container, return `[xVelocity, yVelocity]` for auto-panning. Returns `[0, 0]` if the position is far from edges. The velocity ramps up as the position gets closer to the edge, up to `speed` pixels per frame. The `distance` parameter defines how many pixels from the edge the auto-pan zone starts.

## DOM Helpers

**`getHostForElement(element)`** — Returns the host document or shadow root for an element. Important for shadow DOM compatibility — event listeners and element queries need to use the correct root.

**`isInputDOMNode(event)`** — Check if a keyboard event originated from an input element (INPUT, SELECT, TEXTAREA, or contenteditable). Used to suppress canvas keyboard shortcuts when the user is typing.

**`getEventPosition(event, bounds?)`** — Extract `{ x, y }` from a mouse or touch event, optionally relative to a bounding rect. Handles both mouse and touch events transparently.

## Platform Detection

**`isMacOs()`** — Check if the user is on macOS. Used internally to differentiate trackpad pinch-zoom behavior (macOS sends ctrl+wheel for pinch gestures).
