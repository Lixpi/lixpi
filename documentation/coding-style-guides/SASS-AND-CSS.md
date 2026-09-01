# Sass and CSS Coding Style Guide

This guide applies to `.scss` files and TypeScript code that creates or selects styled DOM elements.

## Style Ownership

- Keep component styles next to the component or framework-agnostic UI module that owns them.
- `services/web-ui/src/settings.ts` is for product configuration and theme tokens, not a mirror of CSS. Keep behavior flags, interaction thresholds, semantic sizing knobs, colors, shadows, borders, border radii, line styles, and line thicknesses there only when changing the value is meant to be supported.
- Put theme-only values under a nested `styles` key inside the relevant settings group. Keep non-style configuration at the group root.
- Keep CSS mechanics in CSS: `display`, `position`, offsets, z-index, grid templates, background repeat/size, layout padding/gaps that exist only to make the component work, typography metrics that would break fitting, and fallback values for local CSS custom properties.
- Reuse existing variables, mixins, and shared component styles before introducing new equivalents.
- Follow the local import pattern in the stylesheet you are editing. Migrating deprecated Sass imports is separate work and should not be mixed into an unrelated UI change.

## Transitions

- All transition timing and easing must come from `@lixpi/ui-primitives/styles/transitions` (`packages/lixpi/ui-primitives/src/styles/_transitions.scss`). Import that file and reuse its shared Sass helpers or mixins; never hand-write custom transition durations or curves in component CSS.
- Hover and hover-equivalent focus state changes must use `hoverTransition(...)`. Do not write raw hover transitions such as `transition: background 150ms ease`.
- If a component needs a transition pattern that is not covered by the existing helpers or mixins, add or update the shared transition API in `_transitions.scss` first, then reuse it from the component stylesheet.

## Class Names

Use flat, single-hyphen kebab-case for Lixpi-owned CSS class names:

```scss
.media-library-header-close { ... }
.media-library-tab-active { ... }
.workspace-thread-rail-boundary-circle { ... }
```

Do not introduce BEM element or modifier punctuation in application-owned class names:

```scss
// Do not add new classes in these forms.
.media-library-header__close { ... }
.media-library-tab--active { ... }
```

Always write each Lixpi-owned class selector in full at the declaration site. The source code must be searchable by the same complete class name used in the DOM:

```scss
.workspace-floating-toolbar { ... }
.workspace-floating-toolbar-button { ... }
.workspace-floating-toolbar-image-wrapper { ... }
```

This applies to every application-owned class declaration, including child elements and state classes. While editing a styling contract, leave each class visible in its complete, searchable form.

## Tooltips

Do not create feature-local hover labels, arrows, positioning rules, or tooltip CSS. Native `title` tooltips are forbidden, and every visible hover or focus tooltip must use the shared custom tooltip component and its owned stylesheet. Follow the complete rule in [`UI-COMPONENTS.md`](./UI-COMPONENTS.md#tooltips).

## External Class Contracts

Leave third-party or externally defined class names unchanged, even when they use a different naming system. For example, `xyflow__viewport` and `xy-flow__handle` are `@xyflow/system` integration contracts, not Lixpi naming decisions.

Before renaming a selector, determine whether it is:

- A Lixpi-owned class that may be renamed together with every consumer.
- A library, embedded widget, browser, or API contract that must retain its exact spelling.
- A non-class identifier, such as a temporary node ID, that is outside CSS naming rules.

## Selector And DOM Lockstep

CSS class names form a contract across styles, templates, code, tests, and documentation. Rename the full contract in one change:

- Sass or CSS selectors, each written as a complete class name.
- TypeScript template attributes and bindings.
- TypeScript `className`, `classList`, `querySelector`, and test fixture strings.
- Dynamically generated variants such as `` `media-library-toast-${variant}` ``.
- Tests and nearby documentation that state the DOM or styling contract.

Before finishing a rename, exact-search every class in the edited contract and confirm its declaration and uses agree. Dynamic class construction still needs separate review because it may leave a styled element disconnected from its rule during a rename.

## CSS Custom Properties

CSS custom properties are not modifier classes. Their required `--` prefix must remain intact:

```scss
.media-library-panel {
    width: var(--media-library-panel-width);
}
```

```typescript
panelEl.style.setProperty('--media-library-panel-width', width)
```

- Never apply a class-name punctuation migration to `--property-name` definitions or `var(--property-name)` references.
- Prefer kebab-case for newly introduced custom properties.
- Preserve existing public or local custom-property names unless renaming that property is explicitly part of the task.
- In TypeScript UI code, follow `TYPESCRIPT.md` for setting custom properties and applying ordinary inline styles.

## Nesting And Selectors

- Keep nesting shallow enough that the emitted selector is obvious when reading the source.
- Keep each application-owned class rule flat and visible under its complete class selector.
- A state, pseudo-element, or attribute qualification may live inside an already complete class rule.
- When styling a child with its own class, write its full selector, such as `.media-library-header-close`.
- Prefer semantic component prefixes over generic global class names.
- Avoid styling by implementation-only DOM shape when a stable class can state the intent.

## Verification

When a change renames or introduces shared styled DOM contracts:

1. Search `.scss` and `.ts` files for old full selectors and dynamic class strings.
2. Check that CSS custom properties and external class contracts were not swept into application-class changes.
3. Update relevant tests and the nearest existing README or feature documentation when it describes affected classes or behavior.
