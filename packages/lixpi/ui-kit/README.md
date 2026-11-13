# UI Kit

Dependency versions in `package.json` are generated from [the version registry](../../../dev-tools/versions-registry/README.md). Edit the central entry and synchronize before rebuilding a consuming service.

[Video controls](docs/VIDEO-PLAYER-CONTROLS.md) covers native media integration, scrubbing and accessibility. Other component guides stay beside their implementations.

Shared DOM templates come from `@lixpi/ui-primitives/dom`. Shared Sass transition helpers come from `@lixpi/ui-primitives/styles/transitions`; UI-kit does not keep private copies of either.

`@lixpi/ui-kit` owns Lixpi's framework-agnostic browser components and icon catalog. Shared DOM, SVG and animation utilities come from [UI Primitives](../ui-primitives/README.md). Consuming applications import public component or style subpaths from UI-kit.

```text
src/
  components/          DOM, SVG, and Sass component implementations
  styles/              Package-local tokens
  svg/                 SVG icons, textures and concrete animated icons (`@lixpi/ui-kit/svg`)
  runtime-settings.ts  Application-configurable component settings
styles/                Public Sass entry points and shared application styles
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
@use '@lixpi/ui-kit/styles/typography';
@use '@lixpi/ui-kit/styles/navigation-side-panel';
```

Applications import each ui-kit stylesheet once at the application root. Feature styles must not `@use` or `@import` the same stylesheet again, because each compiled copy becomes a separate CSS module and prevents one HMR update from being the only active component stylesheet.

UI-kit controls do not paint focus outlines. Applications use the shared Web Client Service Factory foundation to suppress browser-default outlines, including those on focusable SVG controls. Keyboard navigation, focus restoration and selected or checked state remain owned by each component.

Web UI and the canvas library call `configureUiKit(createLixpiUiSettings())` during startup. That package factory copies the complete light theme's component appearance into independent runtime settings alongside behavior and geometry. `configureUiKit` takes overrides: any section a host leaves out keeps the ui-kit default in `uiKitSettings`. Standalone primitives read the same theme-owned profiles; per-instance configuration remains supported.

`uiKitSettings.sidePanel` holds the motion every SidePanel shares: slide duration and easing from the theme, overlay opacity, and swipe-to-close thresholds. Its `placement` decides whether an open panel draws on top of the content (`overlay`, the default) or takes its own space and shrinks the content (`push`). Hosts do not pass these values, so the web UI and the canvas library open and close panels identically.

The navigation panel, right panel and canvas library read panel geometry and toggle sizes from `@lixpi/themes`. A library dock uses its own configured width and the same resize and toggle geometry. `CanvasLibraryLayout.setOpen` owns a panel's open and close: opening marks the panel open and slides it in, and closing slides it out before releasing it. A close that is overtaken by a reopen leaves the panel open. Panels overlay the stage unless the host passes `placements` to the layout constructor, for example `{ navigation: 'push' }`. A pushed panel claims a grid column, so the stage shrinks while it is open; an overlaid panel sits above the stage and never resizes it. Navigation headings and rows share the theme's sidebar roles. The navigation icon treatment applies only to the left navigation toggle.

The shared animated collapse/expand icon describes the available action: collapsed content shows outward expand chevrons, while expanded content shows inward collapse chevrons. Hosts provide the label and ARIA state; they do not reverse the icon state themselves.

Portaled sliding dropdowns reserve the overlay layer directly below the default help-tooltip layer, so help content rendered from a dropdown option covers the dropdown surface and chevron.

A sliding dropdown can inherit a local host's theme while its SVG and chevron are portaled to the document body. Set `portalStyleSource` to that host, or supply a getter when the control is constructed before mounting. The dropdown carries the source's custom properties to its original SVG and both portals through one shared generated class per distinct set of values, so a themed host with over a thousand properties costs a class switch rather than thousands of inline writes; dropdowns that sync in the same task share one read of a source. Typography, and any custom property the target also sets inline, are applied inline. The dropdown observes the original source and its ancestors for changes and restores owned SVG styles, attributes and classes on disposal. Optional `portalScopeAttributes` supplies an attribute map or getter for the caller's scoped styles. These settings are per instance and do not change UI-kit's global configuration. A positive `--sliding-dropdown-control-height` on the source updates the dropdown's native option geometry along with its inherited styles. Optional `--sliding-dropdown-control-height-offset` subtracts a numeric pixel inset from that height, allowing a host's smaller selector rows to follow a shared control size. Its default is zero; unthemed configured heights remain unchanged.

Import `@lixpi/ui-kit/styles/fonts` once to load the same bundled Söhne and Söhne Mono font faces used by the main web UI. The stylesheet defines the existing 200, 300, 400 and 500 normal and italic faces; application styles and theme settings choose the font family and size. Font URLs are package-relative and are handled by the consuming build.

`@lixpi/ui-kit/styles/typography` supplies the web UI's existing application typography, including those bundled fonts, body text, headings, links and code. The web UI and canvas library import this same stylesheet so their application text uses the same families and rules.

`@lixpi/ui-kit/styles/navigation-side-panel` supplies the production navigation drawer styles and a flat list's row treatment. Its `navigation-side-panel` and `navigation-side-panel-list` classes define the shared surface, and the `navigation-side-panel-row`, `navigation-side-panel-row-title` and `navigation-side-panel-row-active` classes style plain controls such as the design-system canvas library's brand and Reset button. The canvas library mounts its actual catalogue navigation through `@lixpi/prosemirror/frontend/nested-list`. The Lixpi workspace sidebar renders its tree with the navigation outline from `@lixpi/prosemirror`, whose stylesheet reads the same `components.navigation` theme values, including the per-level heading values. Hosts provide content and SidePanel behavior. A docked host can adapt the container's position and width without replacing its appearance or introducing a separate navigation palette.

The flat-list row styles follow the Gentelella sidebar layout used by AI Experiments, painted with Lixpi theme roles. Those plain rows run edge to edge with square corners and align their text with section headings. The ProseMirror navigation body owns its separate inset, rounded hover and active treatment, with the image/video switch colors. The canvas-library navigation wrapper has no padding around that editor, so its block spacing is controlled in one place. The theme's sidebar shadow marks the panel's edge. The resize-handle line is still rendered, but `navigation-resize-handle-width` sets its width to zero for navigation panels, so a theme can bring the line back by changing that one value. The header controls keep their own `components-navigation-header-*` spacing and radius, so the row geometry does not move them.

SlidingSwitch and SlidingTabsSwitch expose `setAppearance(Partial<SlidingSwitchAppearance>)` for track, indicator and state colors, shadows and label typography. ToggleSwitch exposes `setAppearance(Partial<ToggleSwitchAppearance>)` for track, knob and checkmark colors, stroke and disabled opacity, plus `resize`. Appearance changes retain selected or checked state, mounted content, handlers and positional animations. Constructor appearance options keep standalone defaults unchanged.

## Application themes

The standalone `@lixpi/themes` package owns theme values. Web UI and the canvas library use its `lixpi-light` preset; [One Dark Pro Mariana](../themes/src/presets/one-dark-pro-mariana/README.md) uses the same complete template. UI-kit consumes these values for its controls and styles.

All TypeScript consumers import from `@lixpi/themes`. That entrypoint owns the preset registry: `themePresets` and `themeNames` enumerate it, `getTheme(name)` returns the registered native preset, and `getThemeStylesheet(name)` returns its CSS projection. Unknown names throw instead of selecting another theme. The entrypoint has no browser component, editor, or Node tooling dependencies.

```typescript
import { lixpiLightTheme } from '@lixpi/themes'
import { createLixpiCanvasThemeFromPreset } from '@lixpi/canvas-components/workspace/settings'

const canvasTheme = createLixpiCanvasThemeFromPreset(lixpiLightTheme)
```

The package separates the values developers edit from their emitted stylesheets:

```text
src/
  template/       Complete TypeScript theme definitions, without default values
  palettes/       Raw color swatches named by appearance
  shared/         Component appearance values deliberately reused by both presets
  presets/        Each preset's role assignments and complete theme composition
  adapters/       CSS-variable and framework mappings
  projections/    SCSS role projection and value-free Sass helper
  index.ts        Public TypeScript API and preset registry
dist/scss/        Generated Sass palettes, preset stylesheets and framework output
tooling/         Generator and drift checks
```

Every preset has the same `roles.ts` and `theme.ts` structure and calls `defineTheme` with complete role and component values. The template supplies no defaults, and no preset falls back to another preset. Raw palettes remain separate from semantic roles such as `text.body`, `feedback.warning` and `editor.syntax.keyword`. Shared component values are copied independently for each preset.

Component appearance follows the same named domains for native controls and DOM styles. For example, `components.dropdown` owns `popover` and `menu`, `components.contextPreview` owns `styles` and `elements`, and `components.composer` owns its controls, input and references. Typography keeps body text, compact controls, panel content, headings, Markdown, introductory text and feedback tags separate. The light preset uses 15px body text, 12px regular control labels and 14px panel content. Reference chips select `editor.referenceChip.onLight` or `onDark` for their surface.

Import generated styles at the application root. The light stylesheet applies to an unthemed document. To switch a document or subtree, load both presets and set `data-color-theme` to its registered name and `data-theme` to its color scheme. The aggregate entrypoint includes every registered preset:

```scss
@use "@lixpi/themes/dist/scss";
```

Individual presets and their generated palette maps are also available at `@lixpi/themes/dist/scss/<name>/theme` and `@lixpi/themes/dist/scss/<name>/palette`. The value-free `@lixpi/themes/scope` helper reads a role from those maps. Configurable Sass mixins use generated `$value-roles` for calculations requiring concrete colors or numbers; CSS fallbacks use `$roles`. Both maps come from the same TypeScript definition.

Change appearance values in TypeScript, then regenerate the checked-in SCSS. The generator iterates the same public registry as consumers. From the repository root:

```sh
docker run --rm --network none -v "$PWD/packages/lixpi/themes:/workspace" -w /workspace node:24.22.2-alpine node tooling/generate.ts
docker run --rm --network none -v "$PWD/packages/lixpi/themes:/workspace:ro" -w /workspace node:24.22.2-alpine node tooling/generate.ts --check
```

The package scripts `themes:generate` and `themes:check` run those same operations. Generated files carry a provenance header and must not be edited directly. `typecheck` checks the complete definitions; package tests cover preset shape, registry identity, shared-value isolation and CSS adaptation.

The [Gentelella adapter](../ui-kit-gentelella/README.md#shared-color-themes) projects these roles into Gentelella variables and selectors. Its TypeScript functions use the package root; its generated Sass is `@lixpi/themes/dist/scss/adapters/gentelella`.

The canvas library uses `@lixpi/ui-kit/canvas-library` for panel dimensions and `@lixpi/ui-kit/styles/canvas-library` for layout and navigation. The canvas package owns node presentation and the transparent drawing surface. `CanvasLibraryLayout.mountPanel(name, element, panel)` attaches the native SidePanel resize element and glass backdrop. Call it before mounting or reopening a panel; repeated calls reuse the same elements. Library styles align the backdrops with their docks and hide them with the corresponding navigation, inspector or theme-panel state.

## Components

- Auth panel, a responsive split layout for authentication and account setup with caller-owned actions and content. Import `/components/auth-panel` and `/styles/auth-panel`. Its brand panel matches the company website's intro: the four-color sage palette, initial freeform gradient phase, translucent canvas and white glow, charcoal logo, and adjacent translucent white Herculanum wordmark. The gradient uses `ui-primitives`; the caller supplies the SVG logo. Call `destroy()` when replacing or removing it to release the gradient canvas and observers.
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

Panels, menus, tooltips, media controls, footers, preview popovers, error placeholders and ripple animation are UI-kit components. They do not require a canvas engine or canvas-components dependency. Application loading indicators use Canvas Components' shared traveling-outline layer.

The [dropdown](src/components/dropdown/README.md) accepts custom trigger content and an accessible label for avatar or icon menus. It owns keyboard navigation, outside dismissal, focus restoration and portaled menu cleanup; applications provide the options and their actions.

## Controls and overlays

| Import | Contract | Styles |
|---|---|---|
| `/components/bubble-menu` | Context-sensitive floating toolbar with caller-owned items, selection bounds and visual scale. Position retries end on hide or disposal. | `/styles/bubble-menu` |
| `/components/side-panel` | Resizing, width state, drawer transitions, backdrop, outside close and optional swipe gestures. Pass `root` to scope its document and persistence callbacks for stored width. | `/styles/side-panel` |
| `/components/popover` | `InteractivePreviewPopover` coordinates pointer/focus activation, Escape, outside dismissal and disposal around explicit root, trigger and popover elements. | Caller surface |
| `/components/loading-placeholder` | Error/retry DOM, with optional document, theme and overlay. The class instance owns its listeners and element. | `/styles/loading-placeholder` |
| `/components/canvas-node-footer` | Details/progress controls plus caller-supplied content sections. Pass info markup and ripple artwork through `icons`. | `/styles/canvas-node-footer` and `/styles/progress-ripple` |
| `/components/progress-ripple` | Three-layer ripple animation over caller-supplied paths and view box. Disposing interrupts transitions and timers. | `/styles/progress-ripple` |
| `/components/help-tooltip` | Rich tooltips and delegated providers with explicit roots, portal roots, delays and visibility guards. | `/styles/help-tooltip` |
| `/components/video-controls` | Accessible SVG play, seek, volume and speed controls over supplied native audio or video, plus fullscreen for video. | SVG attributes plus host properties |
| `/components/preview` | Inline or floating preview surfaces with supplied content and explicit portal positioning. | `/styles/preview` |

Import the required styles once per application surface. Footers expose `--canvas-node-footer-icon-size`, `--canvas-node-footer-color`, `--canvas-node-footer-hover-color` and `--canvas-node-footer-separator-gradient`. Tooltip presentation uses `--help-tooltip-*` variables. Shared transition functions come from UI Primitives.

Video controls accept `icons` and optional complete `settings`. `createDefaultVideoControlsSettings()` returns fresh defaults; each control copies the supplied settings on construction. `applyVideoControlsHostStyleProperties(host, settings.styles)` applies the matching native host treatment. SVG filter/clip IDs are unique across instances even when their logical node IDs match. The host owns native media pixels and source resolution.

UI-kit's SVG catalog exports `progressRippleArtwork` and `videoControlIcons` for the footer, ripple and video controls. Callers may supply other artwork through component configuration. Tooltip triggers fall back to a text question mark when no icon or custom trigger content is supplied.

`createArrowRightMarker()` returns the native arrow artwork as parsed paths, width, line reference point and body-length fraction. The workspace and embedded diagrams pass this artifact to their renderer; UI-kit owns the artwork and does not depend on a canvas package.

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
