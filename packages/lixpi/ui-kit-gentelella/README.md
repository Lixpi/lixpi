# Gentelella UI Kit

Dependency versions in `package.json` are generated from [the version registry](../../../versions-registry/README.md). Edit the central entry and synchronize before rebuilding a consuming service.

`@lixpi/ui-kit-gentelella` is the reusable boundary around the [Gentelella](https://github.com/ColorlibHQ/gentelella) admin theme. It exposes the complete v4 Sass theme, typed runtime modules, stable class contracts, and framework-free DOM components built with `@lixpi/ui-primitives/dom`.

Applications depend on this package instead of importing `gentelella` directly. That keeps the upstream dependency, markup contracts, and upgrade work in one place.

## Use the package

Import the theme and any package-owned component styles once at the application root:

```scss
@use '@lixpi/ui-kit-gentelella/styles/theme';
@use '@lixpi/ui-kit-gentelella/styles/application-shell';
```

Import components through their public subpaths so a consumer only takes the modules it uses:

```typescript
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { createGentelellaCard } from '@lixpi/ui-kit-gentelella/components/card'

const saveButton = createGentelellaButton({
    label: 'Save',
    variant: 'primary',
})
const card = createGentelellaCard({
    content: saveButton.el,
    title: 'Settings',
})
```

Every factory returns an instance that owns its root element and a `destroy()` method. Stateful components expose focused methods such as `setBusy()`, `setActiveValue()`, or `setActivePath()`. Configuration accepts caller-owned content and optional application class names, so components can be composed without depending on a service.

Buttons attach their spinner only while `setBusy(true)` is active and remove it on `setBusy(false)`. This keeps the theme's explicit spinner display rule from making an idle button appear busy.

## Public surfaces

- `components/*` covers the complete reusable component vocabulary from the upstream production demos: foundation, navigation, layouts, feedback, forms, tables, charts and maps, widgets, app surfaces, commerce, admin, auth, media, marketing, theme controls, and overlays. It does not copy complete demo pages.
- `class-names` exposes the stable theme class contract and class-name builders for dynamic markup that does not need a component instance.
- `runtime/*` re-exports each Gentelella v4 runtime module. The package supplies explicit types for the upstream product image and mockup modules, which Gentelella ships without declarations. Consumers import one module at a time so unrelated browser initializers do not enter their bundle.
- `styles/theme` compiles the complete Gentelella v4 Sass theme.
- `styles/tokens`, `styles/layout`, `styles/components`, `styles/forms`, `styles/widgets`, `styles/pages`, `styles/rtl`, `styles/datatable`, `styles/auth`, and `styles/apps` expose the upstream Sass modules separately. Each focused entrypoint loads the design tokens it needs, so applications can mix modules without importing the complete theme.
- `styles/application-shell` adds the package-owned layout rules used by `createGentelellaApplicationShell()`.

Do not import Gentelella's root JavaScript entrypoint from this package. The root entrypoint initializes document-wide behavior as a side effect. Use the focused runtime facades instead.

Read [Component Coverage](documentation/COMPONENT-COVERAGE.md) for the module map, [Using the Gentelella UI Kit](documentation/USING-GENTELELLA-UI-KIT.md) for composition rules, and [Keeping the Package in Sync](documentation/SYNCING-WITH-GENTELELLA.md) before changing the upstream version or public surface.

## Verify changes

Run the package tests and quality checks through the repository's Docker runners:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner shared ui-kit-gentelella
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner shared ui-kit-gentelella validate
```
