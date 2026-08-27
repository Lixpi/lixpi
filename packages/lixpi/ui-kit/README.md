# UI Kit

`@lixpi/ui-kit` owns Lixpi's framework-agnostic browser UI primitives. It has no backend or shared-runtime layer: every implementation lives under `src/components`, and consuming applications import public component or style subpaths from the package.

```text
src/
  components/          DOM, SVG, and Sass component implementations
  dom/                 Internal DOM template helpers
  styles/              Package-local tokens and transition functions
  svg/                 SVG icons, textures, and path helpers (`@lixpi/ui-kit/svg`)
  runtime-settings.ts  Application-configurable component settings
styles/                Public Sass entry points forwarding to component-owned styles
```

Use public package imports:

```typescript
import { createProgressTimeline } from '@lixpi/ui-kit/components/progress-timeline'
import { createCanvasNodeFooter } from '@lixpi/ui-kit/components/canvas-node-footer'
import { createHelpTooltip, createHelpTooltipProvider } from '@lixpi/ui-kit/components/help-tooltip'
import { createMediaModelBadge } from '@lixpi/ui-kit/components/media-model-badge'
import { createSidePanel } from '@lixpi/ui-kit/components/side-panel'
import { createBlockCardTilesList } from '@lixpi/ui-kit/components/block-card-tiles-list'
import { appendSvgPathIcon, xIcon } from '@lixpi/ui-kit/svg'
```

```scss
@use '@lixpi/ui-kit/styles/progress-timeline';
@use '@lixpi/ui-kit/styles/canvas-node-footer';
@use '@lixpi/ui-kit/styles/help-tooltip';
@use '@lixpi/ui-kit/styles/side-panel';
@use '@lixpi/ui-kit/styles/block-card-tiles-list';
```

Applications import each ui-kit stylesheet once at the application root. Feature styles must not `@use` or `@import` the same stylesheet again, because each compiled copy becomes a separate CSS module and prevents one HMR update from being the only active component stylesheet.

The Web UI calls `configureUiKit(settings)` once during startup so package primitives receive the application-owned runtime values. Defaults keep the package usable in isolation and in component tests.

The shared animated collapse/expand icon describes the available action: collapsed content shows outward expand chevrons, while expanded content shows inward collapse chevrons. Hosts provide the label and ARIA state; they do not reverse the icon state themselves.

Portaled sliding dropdowns reserve the overlay layer directly below the default help-tooltip layer, so help content rendered from a dropdown option covers the dropdown surface and chevron.

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

## Components

- Bubble menu
- Canvas node footer
- Dropdown
- Help tooltip
- Info bubble
- Media model badge
- Progress timeline
- Side panel
- Block card tiles list
- Slider
- Sliding dropdown
- Sliding switch
- Sliding tabs switch
- Tag pill
- Toggle switch
- Video controls

Component implementations, styles, documentation, and component-scoped tests stay together in their `src/components/<component>` directory. The package must not import from `services/web-ui`.
