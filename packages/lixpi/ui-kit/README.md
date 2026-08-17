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
import { createMediaModelBadge } from '@lixpi/ui-kit/components/media-model-badge'
import { createSidePanel } from '@lixpi/ui-kit/components/side-panel'
import { createBlockCardTilesList } from '@lixpi/ui-kit/components/block-card-tiles-list'
import { appendSvgPathIcon, xIcon } from '@lixpi/ui-kit/svg'
```

```scss
@use '@lixpi/ui-kit/styles/progress-timeline';
@use '@lixpi/ui-kit/styles/side-panel';
@use '@lixpi/ui-kit/styles/block-card-tiles-list';
```

The Web UI calls `configureUiKit(settings)` once during startup so package primitives receive the application-owned runtime values. Defaults keep the package usable in isolation and in component tests.

The shared animated collapse/expand icon describes the available action: collapsed content shows outward expand chevrons, while expanded content shows inward collapse chevrons. Hosts provide the label and ARIA state; they do not reverse the icon state themselves.

## Components

- Bubble menu
- Dropdown
- Help tooltip
- Info bubble
- Media model badge
- Progress timeline
- Side panel
- Block card tiles list
- Sliding switch
- Sliding tabs switch
- Tag pill
- Toggle switch
- Video controls

Component implementations, styles, documentation, and component-scoped tests stay together in their `src/components/<component>` directory. The package must not import from `services/web-ui`.
