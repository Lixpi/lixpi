# DOM Contract

The system expects specific CSS classes and DOM structure. Whether you use the Svelte/React wrappers or build your own integration (like Lixpi), these conventions define how the system interacts with the DOM.

## Required DOM Structure

The system expects a container structure with specific class names and z-index layering:

```
.xy-flow                          ← root container
  .xy-flow__container             ← position: absolute, fills parent
    .xy-flow__pane                ← z-index: 1, captures background clicks
    .xy-flow__viewport            ← z-index: 2, transform-origin: 0 0, pointer-events: none
      .xy-flow__renderer          ← z-index: 4, contains nodes and edges
    .xy-flow__selection           ← z-index: 6, selection rectangle
    .xy-flow__panel               ← z-index: 5, overlays (controls, minimap)
```

The root `.xy-flow` container MUST have explicit width and height. The system checks for this and warns (error004) if missing.

## Z-Index Layers

| Layer | Z-Index | Purpose |
|-------|---------|---------|
| Pane | 1 | Background — captures clicks for deselection and box selection |
| Viewport | 2 | Transform container — the CSS transform for pan/zoom is applied here |
| Renderer | 4 | Content — nodes and edges live inside this |
| Panel | 5 | Overlays — controls, minimap, any docked UI |
| Selection | 6 | Selection rectangle — drawn above everything |

Within the renderer, individual nodes use z-index for stacking. Selected nodes get z-index 1000. Nodes with parents get elevated z-index based on parent hierarchy depth.

## Interaction CSS Classes

These classes are placed on elements to opt them out of specific interactions. The system checks for these by traversing up the DOM tree with `element.closest()`.

### `nopan` / `noPanClassName`
Applied to elements that should not trigger canvas panning when dragged. The pane's filter function checks if the event target (or any ancestor up to the container) has this class. If it does, the pan gesture is suppressed.

Use case: scrollable panels, sliders, drag handles for node resizing — anything where a mouse drag should do something other than pan.

### `nowheel` / `noWheelClassName`
Applied to elements that should not trigger canvas zooming on scroll. The wheel handler checks for this class and, if present, lets the browser's default scroll behavior happen instead.

Use case: scrollable text areas within nodes, dropdown menus, any element with its own scroll behavior.

Exception: pinch-zoom (ctrl+wheel) on `nowheel` elements is prevented via `event.preventDefault()` to stop the browser from zooming the whole page, even though canvas zoom is suppressed.

### `nodrag` / `noDragClassName`
Applied to elements within a node that should not initiate node dragging. The drag filter checks if the target has this class.

Use case: interactive controls inside nodes — buttons, inputs, text editors, resize handles.

### `nokey`
Applied to elements where keyboard events should not trigger canvas actions. When focus is inside a `.nokey` element, keyboard shortcuts (delete, arrow keys, etc.) are suppressed.

Use case: text inputs, contenteditable areas, ProseMirror editors inside nodes.

## State CSS Classes

The pane element receives state classes:

- `.draggable` — Pan is enabled, shows `cursor: grab`
- `.dragging` — Actively panning, shows `cursor: grabbing`
- `.selection` — Box selection is active, shows `cursor: pointer`. Also disables `pointer-events` on `.xy-flow__panel` so panels don't intercept the selection gesture

## CSS Custom Properties

The system defines a theming layer via CSS custom properties. Each property has a `*-default` fallback so the system works without any configuration:

```
--xy-node-color                    → --xy-node-color-default
--xy-node-border                   → --xy-node-border-default
--xy-node-background-color         → --xy-node-background-color-default
--xy-node-boxshadow-hover          → --xy-node-boxshadow-hover-default
--xy-node-boxshadow-selected       → --xy-node-boxshadow-selected-default
--xy-node-border-radius            → --xy-node-border-radius-default
--xy-handle-background-color       → --xy-handle-background-color-default
--xy-handle-border-color           → --xy-handle-border-color-default
--xy-selection-background-color    → --xy-selection-background-color-default
--xy-selection-border              → --xy-selection-border-default
--xy-edge-label-background-color   → --xy-edge-label-background-color-default
--xy-edge-label-color              → --xy-edge-label-color-default
```

A `.dark` class on the root element switches defaults to dark theme values.

## Style Loading

The system ships two CSS files:
- `init.css` — Structure-only styles (positioning, z-index, pointer-events). Required.
- `style.css` — Visual theming (colors, borders, shadows). Optional — load it for the default look, or replace it with your own.
- `base.css` — Minimal visual styles without the full theme. An alternative to `style.css`.

The system checks (error013) whether styles are loaded and warns if it detects they aren't. Use `@xyflow/{lib}/dist/style.css` or `base.css` as the import path.

## Handle DOM Measurement

When using the wrappers, handles are measured from the DOM:
- `getHandleBounds` queries all elements with class `.source` or `.target` within a node element
- Each handle's position relative to the node is recorded in `handleBounds`
- The `data-handleid`, `data-nodeid`, and `data-handlepos` attributes are used for identification

When using `@xyflow/system` directly (like Lixpi), you can bypass DOM measurement by providing handle bounds programmatically through the node's `handles` array property.
