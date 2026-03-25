# Node Resizing

`XYResizer` manages interactive node resizing. It's a constraint solver that balances minimum/maximum dimensions, aspect ratio, parent/child extent limits, and node origin — all coordinated through a unified clamping algorithm.

## Mental Model

Resizing is deceptively complex because changing a node's size often changes its position too. When you drag the top-left corner to make a node larger, the node's position moves up and to the left while its width and height increase. Dragging the bottom-right corner only affects dimensions (with default origin). The constraint solver must handle all eight control positions uniformly.

Additionally, if the resized node has children with `extent: 'parent'`, those children constrain how small the parent can shrink. And if the resized node itself has `extent: 'parent'`, it can't grow past its own parent.

## Control Positions

Eight resize handles are supported, each affecting different dimensions:

| Position | Horizontal | Vertical | Moves X | Moves Y |
|----------|-----------|----------|---------|---------|
| top-left | ✓ | ✓ | ✓ | ✓ |
| top | | ✓ | | ✓ |
| top-right | ✓ | ✓ | | ✓ |
| right | ✓ | | | |
| bottom-right | ✓ | ✓ | | |
| bottom | | ✓ | | |
| bottom-left | ✓ | ✓ | ✓ | |
| left | ✓ | | ✓ | |

Edge handles (top, right, bottom, left) resize in one direction only. Corner handles resize in both directions.

## The Constraint Solver

The core function `getDimensionsAfterResize` resolves all constraints in a single pass. Instead of clamping width, height, x, y independently (which would break aspect ratio), it works in **distance space** — tracking how far the mouse moved from the drag start (`distX`, `distY`) and finding the strongest restriction on that distance.

### Restriction Sources

The solver checks four restriction sources and takes the maximum restriction from each:

1. **Size boundaries** — `minWidth`, `maxWidth`, `minHeight`, `maxHeight`. If the new dimensions exceed these, the distance is clamped.

2. **Parent extent** — If the node has `extent: 'parent'`, it can't resize past its parent's bounds. The solver checks whether the new edges (top, left, right, bottom depending on which corner is dragged) would exceed the parent.

3. **Child extent** — If any child node has `extent: 'parent'` or `expandParent: true`, the parent can't shrink past the children's bounding box. The solver aggregates all such children into a single extent.

4. **Aspect ratio propagation** — If `keepAspectRatio` is true, clamping one dimension cascades to the other. If width is restricted by `maxWidth`, the corresponding height change is also restricted to maintain the ratio.

### After Clamping

Once the strongest restriction is found, `distX` and `distY` are adjusted. Then, if `keepAspectRatio` is enabled, the distances are locked together:
- Diagonal handles: the dominant axis (whichever produces a larger dimension) drives the other
- Edge handles: the resized dimension drives the perpendicular one

## Child Compensation

When the top or left edge of a node moves (because a top/left handle is dragged), all child nodes must be offset to maintain their visual positions. Without this, children would appear to shift within the parent.

The resizer emits `XYResizerChildChange` objects alongside the main `XYResizerChange`, specifying position adjustments for each child. It's the consumer's responsibility to apply these changes.

## Node Origin Impact

Node origin (`[xFactor, yFactor]`) adds a wrinkle. A node with origin `[0.5, 0.5]` has its position at its center, not its top-left. The solver compensates by temporarily shifting to `[0, 0]` origin for the constraint math, then converting back. Without this, extent boundaries and aspect ratio calculations would be off by `originFactor × dimension` pixels.

## Snap to Grid

Like dragging, resizing respects snap-to-grid. The pointer position is snapped before entering the constraint solver, so dimensions and positions align to the grid. The snapping happens in `getPointerPosition`, the same utility used by the drag system.
