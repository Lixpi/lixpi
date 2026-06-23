# SidePanel

Reusable resizable side panel for canvas-hosted UI. "Rail" is the internal term for the vertical drag handle that resizes the panel.

## Renderer

TypeScript `html` DOM (no Svelte, no PIXI). The component is built to mount as a child of a canvas-hosted panel element, the same way the AI chat thread panel uses it. It owns the drag-to-resize gesture, the body cursor and text-selection management during a drag, the visible rail line, and the translucent glass backdrop. The rail line is a single unbroken line spanning the full panel height.

## Glass backdrop

The translucent glass backdrop is a feature of this component — its element and all glass styling (blur, tint, edges, reduced-transparency fallback) live here, not in any host. The component creates `backdropElement`; the host appends it into the same container as the panel, behind the panel (lower z-index). The backdrop is sized to the panel width and anchored to the panel's edge, so its inner edge sits flush with the panel edge.

## Resize ownership

The component owns the **entire** resize lifecycle:

- It is the single source of truth for the panel width.
- It tracks every drag and clamps the width to `minWidth` and the dynamic `getMaxWidth()`.
- It persists the width through the injected `loadState` / `persistState` adapter — storage stays host-owned, but the component decides *when* to load (on construction) and save (on drag end, or on `setWidth(..., { persist: true })`).
- It exposes the state to external sources that can both **modify** it (`setWidth`, `applyConstraints`) and **consume** it (`getWidth`, `getRawWidth`, `getState`, `subscribe`, `onResize`).

The host's only job is to reflect the reported width into its own DOM (CSS variables, dependent layout). It does not clamp, store, or decide width.

## Where it mounts

The host appends `instance.element` into its panel element. The rail positions itself absolutely against one edge of that panel:

- `side: 'right'` — the panel sits on the right of the screen, so the rail hugs the panel's left edge. Dragging left grows the panel.
- `side: 'left'` — the panel sits on the left of the screen, so the rail hugs the panel's right edge. Dragging right grows the panel.

## State ownership

The component does not own any product-domain width decision. It reports a candidate width through `onResize`; the host clamps, applies, and persists it. The host's panel width is the single source of truth, supplied through `getStartWidth` at the start of each drag.

## Public API

`createSidePanel(config)` returns a `SidePanelInstance`.

### Config

- `side`: `'left' | 'right'` — which screen edge the panel hugs.
- `offset`: distance in px from the panel edge to the rail center.
- `grabWidth`: screen-pixel width of the invisible drag hit target.
- `className`: optional extra class so a specific panel's rail can be styled separately.
- `styles`: optional `gradient` and `width` overrides for the rail line.
- `minWidth`, `defaultWidth`: resize constraints. `defaultWidth` is the resolved width before the user has ever resized.
- `getMaxWidth()`: dynamic upper bound (depends on available canvas/pane width).
- `measureWidth()`: optional measurement of the actual rendered panel width, used as the start width for the first drag before any width is stored.
- `loadState()` / `persistState(state)`: persistence adapter.
- `onResizeStart()`, `onResize(width)`, `onResizeEnd(width)`: drag lifecycle callbacks. `onResize` also fires for programmatic `setWidth`.

### Instance

- `element`: the rail's root element, appended by the host.
- `backdropElement`: the glass backdrop element, appended by the host behind the panel.
- `getWidth()`: resolved, clamped current width (always a number).
- `getRawWidth()`: stored width — `null` until the user resizes.
- `getState()`: the persistable `{ width }` snapshot.
- `setWidth(width, { persist?, silent? })`: modify the width from an external source; returns the clamped value.
- `applyConstraints()`: re-clamp the current width against the (possibly changed) constraints, e.g. after the pane resizes.
- `subscribe(listener)`: consume width changes; returns an unsubscribe function.
- `setSelected(selected)` / `setResizing(resizing)`: toggle state classes.
- `destroy()`: removes the rail element, the backdrop element, the `mousedown` listener, in-flight drag listeners on `document`, and all subscribers.

## Styling

Base presentation lives in [`side-panel.scss`](./side-panel.scss):

- The rail: `.side-panel-rail` and `.side-panel-rail-line`, driven by `--side-panel-rail-gradient` and `--side-panel-rail-width`. The line spans the full panel height.
- The glass backdrop: `.side-panel-backdrop` (+ `.side-panel-backdrop-left` / `.side-panel-backdrop-right`). Width comes from `--side-panel-backdrop-width` (falling back to the host panel-width var), the tint from `--side-panel-backdrop-fill` / `--side-panel-backdrop-fill-opaque`.

Pass `className` to add panel-specific rail overrides without touching the shared rules.

## Cleanup

`destroy()` removes the mounted element and all listeners, including the global `mousemove` / `mouseup` listeners added during an active drag. It leaves the host panel and any host-owned state untouched.
