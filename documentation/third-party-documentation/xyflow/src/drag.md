# Node Dragging

`XYDrag` manages node movement. It handles multi-selection dragging, snap-to-grid, auto-panning near edges, extent constraints, and parent/child relationships — all via D3's drag behavior.

## Mental Model

Dragging sounds simple but gets complex fast. When a user grabs a node and moves it:

- If other nodes are selected, they all move together, maintaining relative positions
- If snap-to-grid is on, the group snaps as a unit (not each node independently)
- If a node has `extent: 'parent'`, it can't leave its parent's bounds
- If a node has `expandParent: true`, the parent grows instead of constraining the child
- If the mouse gets close to the canvas edge, the viewport auto-pans
- A drag threshold prevents accidental moves when the user just clicks

`XYDrag` coordinates all of this into a single state machine.

## Lifecycle

**Creation** — Call `XYDrag({ getStoreItems, onDragStart, onDrag, onDragStop })`. The `getStoreItems` callback is key — it provides lazy access to current state (nodes, transform, snap settings, etc.) without the drag system holding references to external objects.

**Binding** — Call `instance.update({ domNode, nodeId })` to attach D3 drag handlers to a specific element for a specific node. This is called per-node.

## The Drag Sequence

### Start

When the user begins dragging:
1. The dragged node is identified
2. `getDragItems()` collects all nodes that should move — the dragged node plus any other selected nodes
3. For each drag item, the `distance` from mouse to the node's absolute position is recorded. This offset keeps nodes from "jumping" to the cursor on drag start
4. If a selected node's parent is also selected, the child is excluded (it'll move with the parent)

### Move

On each mouse move:
1. **Threshold check** — Movement must exceed `nodeDragThreshold` pixels before anything happens. Below this threshold, nothing moves. This prevents accidental drags when the user intended to click
2. **Position calculation** — For each drag item: new position = mouse position − saved distance offset
3. **Snap-to-grid** — If enabled, `calculateSnapOffset` finds the grid-aligned offset for the primary node, then applies the same offset to all nodes. The group moves as a unit to the nearest grid intersection
4. **Extent clamping** — Each node's position is clamped within its extent (`'parent'` for parent bounds, or absolute coordinate extent). Nodes with `expandParent` grow their parent instead
5. **Auto-pan** — If `autoPanOnNodeDrag` is enabled, `calcAutoPan()` checks if the mouse is near the canvas edge. If so, a `requestAnimationFrame` loop continuously pans the viewport and adjusts node positions to compensate. The pan velocity increases as the mouse gets closer to the edge

### End

When the user releases:
1. Auto-pan loop stops
2. Positions are finalized with `dragging: false`
3. Callbacks fire with the final state

## Multi-Selection

The grouping behavior is worth understanding in detail. When three nodes A, B, C are selected and the user drags B:

- All three are in the `dragItems` Map
- Each has its own `distance` offset from the mouse (calculated at drag start)
- When the mouse moves, A and C move by the same delta as B — they don't follow the mouse directly, they follow the primary node's movement
- Snap-to-grid aligns B to the grid, then A and C shift by the same offset
- If A is B's parent and both are selected, A's position changes directly from the drag. B is excluded from dragItems because `isParentSelected` returns true — B's absolute position updates automatically when A moves

## Extent Constraints

Three modes control where nodes can go:

**No extent** — default. Nodes can be anywhere on the infinite canvas.

**Coordinate extent** — `extent: [[x1, y1], [x2, y2]]`. Pins the node within absolute world coordinates. The node's dimensions are factored in so no part of the node leaves the box.

**Parent extent** — `extent: 'parent'`. The node is confined within its parent node's bounds. If the parent hasn't been measured yet, clamping does nothing (avoiding incorrect initial positions).

**`expandParent: true`** — An escape hatch for parent extent. Instead of clamping the child, the parent grows to accommodate the child's new position. The parent's dimensions increase; other children don't move.

## Node Origin

Node origin `[xFactor, yFactor]` determines what point the position refers to. `[0, 0]` means position is the top-left corner (default). `[0.5, 0.5]` means position is the center. `[1, 1]` means bottom-right.

This affects drag and extent calculations — the clamping math adjusts the extent boundaries by `originFactor × nodeDimension` so the visual node (not just the origin point) stays within bounds.

## Auto-Pan Details

Auto-panning is a feedback loop: the mouse approaches the edge → the canvas pans → this changes what's visible, but the node positions are in canvas coordinates, so the nodes would appear to drift if not compensated → the drag system adjusts node positions to account for the pan delta.

The pan speed accelerates as the mouse gets closer to the edge. The `autoPanSpeed` parameter controls the maximum velocity. The loop runs via `requestAnimationFrame` and stops when the drag ends or the mouse moves away from the edge zone.
