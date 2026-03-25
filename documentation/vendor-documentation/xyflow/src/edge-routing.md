# Edge Routing

The system provides three edge path functions. Each takes source/target handle positions and returns an SVG path string plus a recommended label position.

## Path Types

### Straight

`getStraightPath` — A single line segment from source to target. Label is placed at the midpoint. Simple and fast, but edges cross over nodes freely. Use when connections are short or the layout is sparse.

### Bezier

`getBezierPath` — A cubic Bézier curve controlled by the handle positions (source/target direction). The curvature parameter (default 0.25) controls how much the curve bows outward — higher values produce wider arcs.

How control points work:
- Each handle has a direction (top/right/bottom/left) that determines which way the curve exits
- The control point extends from the handle in that direction
- When source and target are far apart, the control point offset is `0.5 × distance` — a gentle curve
- When source and target are close (or the curve is going backward against the handle direction), the offset uses `curvature × 25 × √distance` — this prevents the curve from collapsing into a straight line on U-turns

The label position is computed at t=0.5 on the cubic curve (not the true geometric midpoint, but close and computationally cheap).

### Smooth Step

`getSmoothStepPath` — An orthogonal path (only horizontal and vertical segments) with rounded corners. This resembles traditional flowchart routing. The `borderRadius` parameter (default 5) controls the corner rounding, and `offset` (default 20) controls how far the path extends before turning.

The routing algorithm handles several cases based on handle positions:
- **Opposite handles** (e.g., right → left) — Two segments with one bend in the middle. The `stepPosition` parameter (default 0.5) controls where the bend occurs: 0 = at the source, 1 = at the target
- **Same-side handles** (e.g., right → right) — Three segments with two bends, routing around to avoid crossing through nodes
- **Perpendicular handles** (e.g., right → bottom) — Two segments with one bend at the corner

When handles on the same side are very close together, the algorithm adds gap offsets to prevent overlapping path segments.

## Return Values

All three functions return the same tuple: `[path, labelX, labelY, offsetX, offsetY]`

- `path` — SVG path string for use in a `<path d="...">` element
- `labelX`, `labelY` — Recommended position for an edge label (center of the path)
- `offsetX`, `offsetY` — Distance from the source to the label position (useful for positioning)

## Edge Z-Index

`getElevatedEdgeZIndex` determines where an edge renders in the stacking order. By default, edges render below nodes. When `elevateOnSelect` is enabled, selected edges move to z-index 1000. Edges connected to nodes with parents render above the parent to avoid being hidden.

## Frustum Culling

Edges outside the visible viewport can be skipped. The system provides `getOverlappingArea` which calculates pixel overlap between two rectangles. Wrappers use this to check if an edge's bounding box intersects the current viewport. If overlap is zero, the edge is outside the view and can be culled.

## How Lixpi Uses Edge Routing

Lixpi uses `getBezierPath` for all connections between nodes. The edge rendering is done with D3 data joins — SVG `<path>` elements are created/updated/removed based on the current edge data. Lixpi also implements t-value spreading for parallel edges between the same pair of nodes so they don't overlap visually.
