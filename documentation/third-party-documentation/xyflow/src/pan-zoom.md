# Pan & Zoom

`XYPanZoom` is the viewport state machine. It wraps D3's zoom behavior to provide constrained panning and zooming with animation support, scroll/pinch handling, and configurable event filtering.

## Mental Model

The viewport defines what slice of the infinite canvas is visible. It's represented as three numbers: `{ x, y, zoom }` — the translation offset and scale factor. Every pixel on screen maps to a canvas coordinate via:

```
canvasX = (screenX - viewportX) / zoom
canvasY = (screenY - viewportY) / zoom
```

`XYPanZoom` owns this transform. You create an instance by giving it a DOM element (the "pane" — the background area users pan on), and it installs D3 zoom handlers on that element. When the user scrolls, pinches, or drags, D3 updates the transform internally, and XYPanZoom notifies you via callbacks.

## Lifecycle

**Creation** — Call `XYPanZoom({ domNode, minZoom, maxZoom, translateExtent, viewport, ... })`. This:
- Creates a D3 zoom behavior with scale/translate extent constraints
- Selects the DOM node and attaches zoom handlers
- Applies the initial viewport (clamped to min/max zoom)
- Returns the instance API

**Configuration** — Call `instance.update(options)` whenever settings change. This reconfigures all event handlers, wheel behavior, and the D3 filter function. Must be called after any config change — the instance does not observe external state.

**Teardown** — Call `instance.destroy()` to remove D3 event handlers. Used temporarily during user selection mode, then reinstalled via `update()`.

## Event Filtering

Not every mouse/touch/wheel event should trigger pan/zoom. The system uses a filter function that D3 calls before processing each event. The filter chain (in evaluation order):

1. Middle mouse button on nodes/edges — always allowed
2. All interactions disabled — block everything
3. User selection active — block everything
4. Active connection in progress — block non-wheel events (allow scroll-zoom during connection)
5. Element has `noWheelClassName` — block wheel events
6. Element has `noPanClassName` — block pan events
7. `zoomOnPinch` disabled + ctrl+wheel — block (prevent accidental pinch-zoom)
8. Multi-touch start without `zoomOnPinch` — block and prevent native zoom
9. No scroll handling enabled — block wheel
10. `panOnDrag` disabled — block mousedown/touchstart
11. Specific buttons not in `panOnDrag` array — block

This filter is why certain CSS classes (like `nopan` or `nowheel`) can prevent interactions on specific elements — the filter checks ancestors for these classes before allowing events.

## Two Wheel Modes

The wheel event can do two different things, controlled by `panOnScroll`:

**Zoom mode** (default) — Wheel scrolls zoom in/out. The `wheelDelta` function calculates zoom amount from the raw wheel event, accounting for deltaMode (pixel vs line vs page units) and macOS trackpad behavior (ctrl+wheel gets 10× factor for pinch gestures).

**Scroll-pan mode** (`panOnScroll: true`) — Wheel scrolls pan the viewport instead of zooming. Can be constrained to `'vertical'`, `'horizontal'`, or `'free'` via `panOnScrollMode`. When in scroll-pan mode, holding the zoom activation key temporarily switches back to zoom behavior.

## Animation

`setViewport()`, `scaleTo()`, and `scaleBy()` accept `duration` and `ease` options. When duration > 0, D3 transitions animate the transform change with the specified easing function (default: cubic in/out). These return Promises that resolve when the animation completes.

`syncViewport()` is the non-animated alternative — it directly sets D3's internal transform state without triggering events or transitions. Used when external code changes the viewport and needs to keep D3 in sync without feedback loops.

## Important Behaviors

**Transform callback frequency** — `onPanZoom` fires on every animation frame during active pan/zoom. Any DOM work in this callback must be cheap. Lixpi defers expensive operations (edge re-rendering, menu repositioning) to `requestAnimationFrame` to avoid layout thrashing.

**Click distance** — D3 needs to distinguish clicks from drags. `setClickDistance(n)` sets the movement threshold in pixels. Below that threshold, a mousedown+mouseup is a click, not a drag. When `selectionOnDrag` is true, click distance is set to `Infinity` so all drags create selection boxes instead of panning.

**Right-click pan** — Configured via `panOnDrag: [0, 2]` (array of allowed mouse buttons). Button 2 = right click. When right-click panning is active and the user right-clicks without moving, it opens the context menu instead of panning.

**Scale extent vs translate extent** — Scale extent `[minZoom, maxZoom]` limits zoom range. Translate extent `[[x1, y1], [x2, y2]]` limits pan range. The default translate extent is `infiniteExtent` (no pan limits). D3 enforces both constraints during transform changes.

## How Lixpi Uses This

`WorkspaceCanvas.ts` creates one `XYPanZoom` instance per workspace. The pane element is the full-size background div. On transform change, the callback:
1. Writes CSS `transform: translate(Xpx, Ypx) scale(Z)` directly to the viewport element
2. Schedules deferred side effects (edge re-rendering, floating menu repositioning)

No Svelte store is involved in the hot path — the CSS transform is applied synchronously for smooth rendering, and the store is updated later for UI that depends on viewport state.
