# Minimap

`XYMinimap` provides a birds-eye view of the canvas. It delegates all viewport manipulation to the main `XYPanZoom` instance — it never manages its own transform.

## How It Works

The minimap is an SVG element that shows scaled-down representations of all nodes and the current viewport rectangle. It uses D3 zoom to capture user interactions (pan and scroll) on the minimap surface, then translates them into operations on the main viewport.

## Zoom Handling

When the user scrolls over the minimap, the zoom handler:

1. Reads the current transform from the main viewport
2. Calculates a zoom delta from the wheel event (with macOS trackpad pinch-zoom detection)
3. Calls `panZoom.scaleTo(nextZoom)` on the main `XYPanZoom` instance

The `zoomStep` parameter controls zoom sensitivity — it's a multiplier on the wheel delta.

## Pan Handling

When the user drags on the minimap:

1. Pan deltas are calculated from mouse movement in screen pixels
2. The delta is scaled by `getViewScale() * Math.max(transform[2], Math.log(transform[2]))` — this compensates for the zoom level difference between the minimap and the main viewport
3. If `inversePan` is true, the direction is flipped (dragging the minimap viewport rectangle feels like dragging the content)
4. The new viewport position is applied via `panZoom.setViewportConstrained`, which respects `translateExtent`

The scaling formula ensures that a small drag on the minimap produces a proportionally correct pan on the main canvas, regardless of zoom level.

## Click Handling

Clicking on the minimap moves the viewport to center on the clicked point. This fires through the same D3 zoom handler as panning — click events produce a zero-delta pan that gets interpreted as a "jump to position."

## Configuration

- `pannable` — Whether the user can drag to pan (default: true)
- `zoomable` — Whether the user can scroll to zoom (default: true)
- `inversePan` — Flip the pan direction. When false (default), dragging right on the minimap moves the viewport right. When true, it feels like dragging the viewfinder
- `zoomStep` — Zoom sensitivity multiplier (default: 1)
- `translateExtent` — Inherits from the main viewport's extent constraints

## What It Doesn't Do

The minimap module only handles input. It does NOT render anything — no node shapes, no viewport rectangle, no styling. Rendering is entirely the wrapper's responsibility (Svelte/React components draw the SVG). The system module only translates minimap interactions into main viewport operations.
