# Connections

`XYHandle` manages the entire connection-drawing lifecycle — from the moment a user presses on a handle to when they release over a valid target (or cancel). It handles proximity detection, drag thresholds, validation, auto-panning, and visual feedback.

## Mental Model

A connection is drawn by dragging from a handle on one node to a handle on another. During the drag, the system continuously searches for the closest compatible handle within `connectionRadius` pixels and validates whether a connection to it would be allowed.

The user sees one of three visual states during dragging:
- **Neutral** (gray) — no handle nearby, line follows the cursor
- **Valid** (green) — closest handle passes validation, line snaps to it
- **Invalid** (red) — closest handle exists but fails validation

## Connection Lifecycle

### Pointer Down

When the user presses on a handle element:

1. The handle's `nodeId`, `handleId`, and `type` (source/target) are identified
2. The starting handle is looked up in the `NodeLookup` to get its absolute position
3. A `ConnectionInProgress` object is created with the `from` position and handle info, and `to` set to the cursor position
4. If `dragThreshold > 0`, the connection doesn't start immediately — the cursor must move beyond that distance first
5. If `dragThreshold === 0`, `updateConnection` and `onConnectStart` fire immediately

### Pointer Move

On each mouse move after the threshold is cleared:

1. The cursor position is converted from screen to canvas coordinates via `pointToRendererPoint`
2. `getClosestHandle` searches for the nearest handle within `connectionRadius`
3. The closest handle is validated via `isValidHandle`
4. The `ConnectionInProgress` is updated — if valid, `to` snaps to the handle's position; otherwise, `to` follows the cursor
5. Auto-panning kicks in if the cursor approaches the canvas edge

### Pointer Up

When the user releases:

1. If a valid closest handle exists, `onConnect` fires with the complete `Connection` object
2. `onConnectEnd` fires regardless (with the connection state)
3. If this was an edge update (reconnect), `onReconnectEnd` fires
4. The connection state is cleared via `cancelConnection`
5. Event listeners are removed

## Handle Proximity Search

`getClosestHandle` is the spatial search function. It works in canvas coordinates (not screen):

1. `getNodesWithinDistance` pre-filters nodes by rough proximity (within `connectionRadius + 250px` of the cursor). The extra 250px buffer accounts for large nodes whose handles might be far from their center
2. For each nearby node, all source and target handles are iterated
3. The starting handle is skipped (you can't connect a handle to itself)
4. Each handle's absolute position is calculated via `getHandlePosition`
5. Euclidean distance is measured. Handles beyond `connectionRadius` are discarded
6. If multiple handles tie at the same distance (overlapping handles), the opposite type is preferred — if dragging from a source, a target handle wins over another source handle

## Validation

Validation happens in two layers:

**`isValidConnection`** — A user-provided function that receives the proposed `Connection` (sourceId, targetId, sourceHandle, targetHandle) and returns true/false. This is where custom rules live (no self-connections, type checking, cardinality limits, etc.). Default: always valid.

**`isConnectionValid`** — An internal function that combines proximity and validation results:
- If the handle passes `isValidConnection` → `isValid = true` (green)
- If inside `connectionRadius` but fails validation → `isValid = false` (red)
- If not inside `connectionRadius` → `isValid = null` (neutral)

This three-state result lets the UI show distinct feedback for "no handle nearby" vs "handle nearby but incompatible."

## Connection Modes

The `connectionMode` parameter controls which handles are candidates:

- **Strict** — Only handles of the opposite type are considered. A source handle can only connect to a target handle, and vice versa. This is the default and matches the typical flow-chart model.
- **Loose** — Any handle is a candidate regardless of type. This enables source-to-source or target-to-target connections, useful for undirected graphs.

## Auto-Pan During Connection

Same mechanics as node drag auto-panning. When `autoPanOnConnect` is enabled and the cursor is near the canvas edge, a `requestAnimationFrame` loop continuously pans the viewport. The `autoPanSpeed` parameter controls maximum velocity.

## Edge Reconnection

`XYHandle` also handles edge reconnection — when a user grabs an existing edge's endpoint and moves it to a different handle. This reuses the same machinery but with an `edgeUpdaterType` parameter that flips which end is the "from" handle. On completion, `onReconnectEnd` fires in addition to the normal callbacks.

## How Lixpi Uses Connections

Lixpi implements a two-tier connection system:

1. **XYHandle-based connections** — Standard handle-to-handle connections using `XYHandle.onPointerDown` directly. Lixpi creates synthetic handle objects (not DOM-measured) with explicit positions and dimensions, then delegates pointer events to `XYHandle`.

2. **Menu-based connections** — An alternative flow where clicking a connector opens a menu to select the target node/handle, bypassing the drag gesture entirely.

The synthetic handle pattern is important: Lixpi doesn't use the wrapper's automatic handle measurement. Instead, it calculates handle bounds manually and injects them into the `NodeLookup`, making the proximity search work without ever having `<Handle>` components in the DOM.
