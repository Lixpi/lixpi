# SidePanel

Reusable resizable side panel for canvas-hosted UI. "Rail" is the internal term for the vertical drag handle that resizes the panel.

## Renderer

TypeScript `html` DOM (no Svelte, no PIXI). The component is built to mount into a canvas-hosted panel system, the same way the AI chat thread panel uses it. It owns the drag-to-resize gesture, the body cursor and text-selection management during a drag, the visible rail line, the translucent glass backdrop, the optional open/collapse toggle button, and the drawer open/close slide animation. The rail line is a single unbroken line spanning the full panel height.

The resize gesture is driven by Pointer Events, so it works with mouse, touch, and pen. The rail sets `touch-action: none` and captures the pointer for the duration of a drag, so the drag keeps tracking on touch devices and past the window edge.

## Glass backdrop

The translucent glass backdrop is a feature of this component — its element and all glass styling (blur, tint, edges, reduced-transparency fallback) live here, not in any host. The component creates `backdropElement`; the host appends it into the same container as the panel, behind the panel (lower z-index). The backdrop is sized to the panel width and anchored to the panel's edge, so its inner edge sits flush with the panel edge.

## Open / close animation

The component plays a drawer-style slide when the panel enters and leaves. It is a positional reveal only — the panel, glass backdrop, and optional toggle button translate in from (or out to) the edge they hug. The surrounding canvas is never dimmed or faded.

- `prepareOpen(panelElement)` puts the panel, backdrop, and toggle in their off-edge start transform before the host appends panel DOM.
- `mountOpen(panelElement)` mounts a panel that should appear already open, including persisted open state on page load and rebuilt panel DOM while already open.
- `playOpen(panelElement)` slides the component surfaces in from the edge and resolves when the transform transition settles. The host calls it once, right after mounting the panel; re-renders (tab switches, content updates) that rebuild the panel while it is already on screen must not call it again.
- `playClose()` slides them back out and resolves once the transform transition settles, so the host can wait before detaching panel DOM.

The slide writes `transform` directly on the panel, backdrop, and toggle so the start and end positions cannot be lost during host re-renders. The transition value comes from `.side-panel-slide` and the shared `panelSlideTransition` easing in [`_transitions.scss`](../../sass/_transitions.scss). `playOpen` and `playClose` resolve through a timeout fallback when no `transitionend` fires.

## Resize ownership

The component owns the **entire** resize lifecycle:

- It is the single source of truth for the panel width.
- It tracks every drag and clamps the width to `minWidth` and the dynamic `getMaxWidth()`.
- It persists the width through the injected `loadState` / `persistState` adapter — storage stays host-owned, but the component decides *when* to load (on construction) and save (on drag end, or on `setWidth(..., { persist: true })`).
- It exposes the state to external sources that can both **modify** it (`setWidth`, `applyConstraints`) and **consume** it (`getWidth`, `getRawWidth`, `getState`, `subscribe`, `onResize`).

The host's only job is to reflect the reported width into its own DOM (CSS variables, dependent layout). It does not clamp, store, or decide width.

## Where it mounts

The host appends `instance.element` into its panel element and appends `instance.backdropElement` into the same pane behind the panel. If `toggle` is configured, the host appends `instance.toggleElement` into the pane once and keeps the `SidePanel` instance alive while panel DOM is opened, rebuilt, closed, and detached.

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
- `toggle`: optional component-owned open/collapse button config: SVG markup, ARIA labels, positioning offsets, travel distance, class name, and `onToggle()`.
- `minWidth`, `defaultWidth`: resize constraints. `defaultWidth` is the resolved width before the user has ever resized.
- `getMaxWidth()`: dynamic upper bound (depends on available canvas/pane width).
- `measureWidth()`: optional measurement of the actual rendered panel width, used as the start width for the first drag before any width is stored.
- `loadState()` / `persistState(state)`: persistence adapter.
- `onResizeStart()`, `onResize(width)`, `onResizeEnd(width)`: drag lifecycle callbacks. `onResize` also fires for programmatic `setWidth`.

### Instance

- `element`: the rail's root element, appended by the host.
- `backdropElement`: the glass backdrop element, appended by the host behind the panel.
- `toggleElement`: optional component-owned open/collapse button, appended once by the host into the pane.
- `getWidth()`: resolved, clamped current width (always a number).
- `getRawWidth()`: stored width — `null` until the user resizes.
- `getState()`: the persistable `{ width }` snapshot.
- `setWidth(width, { persist?, silent? })`: modify the width from an external source; returns the clamped value.
- `applyConstraints()`: re-clamp the current width against the (possibly changed) constraints, e.g. after the pane resizes.
- `subscribe(listener)`: consume width changes; returns an unsubscribe function.
- `setSelected(selected)` / `setResizing(resizing)`: toggle state classes.
- `setOpen(open)`: sync toggle classes and ARIA labels to the panel open state.
- `mountOpen(panelElement)`: attach a rebuilt panel while the side panel is already open.
- `prepareOpen(panelElement)`: put the panel and backdrop in the off-edge start position before append.
- `playOpen(panelElement)`: slide the panel and backdrop in from the hugged edge.
- `playClose()`: slide them back out; resolves when the transition settles.
- `detachPanel()`: remove the rail/backdrop and cancel in-flight panel motion while keeping the toggle and width state alive.
- `destroy()`: removes the rail element, the backdrop element, the `pointerdown` listener, in-flight pointer drag listeners on `document`, any pending slide cleanup, and all subscribers.

## Styling

Base presentation lives in [`side-panel.scss`](./side-panel.scss):

- The rail: `.side-panel-resize-handle` and `.side-panel-resize-handle-line`, driven by `--side-panel-resize-handle-gradient` and `--side-panel-resize-handle-width`. The line spans the full panel height.
- The toggle: `.side-panel-toggle` (+ `.side-panel-toggle-left` / `.side-panel-toggle-right` / `.side-panel-toggle-open`), driven by `--side-panel-toggle-closed-travel`.
- The glass backdrop: `.side-panel-backdrop` (+ `.side-panel-backdrop-left` / `.side-panel-backdrop-right`). Width comes from `--side-panel-backdrop-width` (falling back to the host panel-width var), the tint from `--side-panel-backdrop-fill` / `--side-panel-backdrop-fill-opaque`.
- The slide animation: `.side-panel-slide` provides the transform transition; the component applies the current transform inline to the panel element, backdrop, and toggle.

Pass `className` to add panel-specific rail overrides without touching the shared rules.

## Cleanup

`detachPanel()` removes panel-owned rail/backdrop DOM and cancels any in-flight slide cleanup while leaving the toggle available for reopening. `destroy()` removes every mounted element and listener, including the global `pointermove` / `pointerup` / `pointercancel` listeners added during an active drag. It leaves the host panel and any host-owned state untouched.
