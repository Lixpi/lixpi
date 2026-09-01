# UI Kit

[Video controls](docs/VIDEO-PLAYER-CONTROLS.md) covers native media integration, scrubbing and accessibility. Other component guides stay beside their implementations.

Shared DOM templates come from `@lixpi/ui-primitives/dom`. Shared Sass transition helpers come from `@lixpi/ui-primitives/styles/transitions`; UI-kit does not keep private copies of either.

`@lixpi/ui-kit` owns Lixpi's framework-agnostic browser components and icon catalog. Shared DOM, SVG and animation utilities come from [UI Primitives](../ui-primitives/README.md). Consuming applications import public component or style subpaths from UI-kit.

```text
src/
  components/          DOM, SVG, and Sass component implementations
  styles/              Package-local tokens
  svg/                 SVG icons, textures and concrete animated icons (`@lixpi/ui-kit/svg`)
  runtime-settings.ts  Application-configurable component settings
styles/                Public Sass entry points forwarding to component-owned styles
```

Use public package imports:

DOM templates use `html`, `createEl`, and `applyStyle` from `@lixpi/ui-primitives/dom`. That entrypoint has no Pixi dependency in its import graph and does not initialize a renderer.

```typescript
import { createProgressTimeline } from '@lixpi/ui-kit/components/progress-timeline'
import { createMediaModelBadge } from '@lixpi/ui-kit/components/media-model-badge'
import { createBlockCardTilesList } from '@lixpi/ui-kit/components/block-card-tiles-list'
import { xIcon } from '@lixpi/ui-kit/svg'
import { appendSvgPathIcon } from '@lixpi/ui-primitives/svg'
```

```scss
@use '@lixpi/ui-kit/styles/progress-timeline';
@use '@lixpi/ui-kit/styles/block-card-tiles-list';
```

Applications import each ui-kit stylesheet once at the application root. Feature styles must not `@use` or `@import` the same stylesheet again, because each compiled copy becomes a separate CSS module and prevents one HMR update from being the only active component stylesheet.

The Web UI calls `configureUiKit(settings)` once during startup so package primitives receive the application-owned runtime values. Defaults keep the package usable in isolation and in component tests.

The shared animated collapse/expand icon describes the available action: collapsed content shows outward expand chevrons, while expanded content shows inward collapse chevrons. Hosts provide the label and ARIA state; they do not reverse the icon state themselves.

Portaled sliding dropdowns reserve the overlay layer directly below the default help-tooltip layer, so help content rendered from a dropdown option covers the dropdown surface and chevron.

## Components

- Dropdown
- Info bubble
- Media model badge
- Progress timeline
- Block card tiles list
- Slider
- Sliding dropdown
- Sliding switch
- Sliding tabs switch
- Tag pill
- Toggle switch

Component implementations, styles, documentation, and component-scoped tests stay together in their `src/components/<component>` directory. The package must not import from `services/web-ui`.

Panels, menus, tooltips, media controls, footers, preview popovers, loading placeholders and ripple animation are UI-kit components. They do not require a canvas engine or canvas-components dependency.

## Controls and overlays

| Import | Contract | Styles |
|---|---|---|
| `/components/bubble-menu` | Context-sensitive floating toolbar with caller-owned items, selection bounds and visual scale. Position retries end on hide or disposal. | `/styles/bubble-menu` |
| `/components/side-panel` | Resizing, width state, drawer transitions, backdrop, outside close and optional swipe gestures. Pass `root` to scope its document and persistence callbacks for stored width. | `/styles/side-panel` |
| `/components/popover` | `InteractivePreviewPopover` coordinates pointer/focus activation, Escape, outside dismissal and disposal around explicit root, trigger and popover elements. | Caller surface |
| `/components/loading-placeholder` | Loading status or error/retry DOM, with optional document, theme, size and overlay. The class instance owns its listeners and element. | `/styles/loading-placeholder` |
| `/components/canvas-node-footer` | Details/progress controls plus caller-supplied content sections. Pass info markup and ripple artwork through `icons`. | `/styles/canvas-node-footer` and `/styles/progress-ripple` |
| `/components/progress-ripple` | Three-layer ripple animation over caller-supplied paths and view box. Disposing interrupts transitions and timers. | `/styles/progress-ripple` |
| `/components/help-tooltip` | Rich tooltips and delegated providers with explicit roots, portal roots, delays and visibility guards. | `/styles/help-tooltip` |
| `/components/video-controls` | Accessible SVG play, seek, volume, speed and fullscreen controls over a supplied native video. | SVG attributes plus host properties |
| `/components/preview` | Inline or floating preview surfaces with supplied content and explicit portal positioning. | `/styles/preview` |

Import the required styles once per application surface. Loading placeholders expose `--loading-placeholder-primary-color` and `--loading-placeholder-secondary-color`; footers expose `--canvas-node-footer-icon-size`, `--canvas-node-footer-color`, `--canvas-node-footer-hover-color` and `--canvas-node-footer-separator-gradient`. Tooltip presentation uses `--help-tooltip-*` variables. Shared transition functions come from UI Primitives.

Video controls accept `icons` and optional complete `settings`. `createDefaultVideoControlsSettings()` returns fresh defaults; each control copies the supplied settings on construction. `applyVideoControlsHostStyleProperties(host, settings.styles)` applies the matching native host treatment. SVG filter/clip IDs are unique across instances even when their logical node IDs match. The host owns native media pixels and source resolution.

UI-kit's SVG catalog exports `progressRippleArtwork` and `videoControlIcons` for the footer, ripple and video controls. Callers may supply other artwork through component configuration. Tooltip triggers fall back to a text question mark when no icon or custom trigger content is supplied.

The catalog also exports `operationStatusDismissIcon`, the dismiss artwork used by Lixpi's operation-status canvas card. The card implementation lives in the Lixpi canvas package; the artwork stays in this catalog.

`createContextPreviewPopover()` accepts trigger content, preview content and an optional `getPortal(element)` callback returning an explicit root and scale. `contentCssVariableNames` selects the theme properties copied from the trigger to portaled content. Inline previews manage focus, Escape and outside interaction; floating previews use the tooltip surface. Each instance owns its portal tracking and cancels it on hide or disposal. The component does not resolve Assets, documents or application routes.

## Help Tooltips

Initialize one delegated provider for the application surface. Controls opt in by naming the attribute that supplies their simple text:

```typescript
const helpTooltipProvider = createHelpTooltipProvider({
    root: document,
    shouldShow: trigger => trigger.getAttribute('aria-expanded') !== 'true',
})

button.setAttribute('aria-label', 'Add to library')
button.dataset.helpTooltip = 'aria-label'
```

`data-help-tooltip="aria-description"` reads a changing description instead. A literal `data-help-tooltip` value is also supported when the visible help differs from the accessible name. Use `data-help-tooltip-placement="top"`, `"bottom"`, `"left"`, or `"right"` only when the surface requires a fixed side. Otherwise the component chooses a side that fits.

Provider-managed tooltips and directly created text tooltips share one default presentation for padding, typography, color, radius, shadow, width, and arrow geometry. Provider-managed tooltips use the configured show delay, so ordinary control labels do not appear during brief pointer movement. They do not inherit feature-local tooltip variables from their triggers. Tooltips created directly with `createHelpTooltip()` open immediately and can retain local styling for rich-content surfaces. A trigger click cancels its pending tooltip and suppresses another activation until the pointer or focus leaves that trigger. The provider calls `shouldShow(trigger)` before displaying a tooltip and whenever the active trigger's attributes change, so controls can use state such as `aria-expanded="true"` to suppress help while their menu, popover, or dialog is open.

Use `createHelpTooltip()` directly when the tooltip owns its trigger or needs rich HTML content:

```typescript
const content = document.createElement('span')
content.append(summary, details)

const tooltip = createHelpTooltip({
    label: 'Model details',
    content,
    interactive: true,
})
```

Both paths use the same portaled content and default directional-arrow geometry. The arrow is one surface-color triangle, follows the selected side, and stays aligned to the trigger when the tooltip is clamped to the viewport. Direct text help fits its content until it reaches the configured maximum width. Destroy directly created tooltips and the provider when their owning surface is disposed.
