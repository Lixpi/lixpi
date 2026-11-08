# One Dark Pro Mariana

A TypeScript theme with a generated SCSS stylesheet in `@lixpi/themes`, based on [One Dark Pro Flat Mariana](https://github.com/myaaghubi/OneDarkPro-Mariana/blob/3811dee855519f81d12102f054024f432942e8cc/themes/OneDark-Pro-flat-Mariana.json) by Mohammad Yaghobi, derived from One Dark Pro by Binaryify. This is the Flat variant selected by the [VSColors reference](https://vscolors.com/themes/c5db5b0c-a63c-477b-8212-baedb9194739-7a74eb06). The editor background is `#282c34` and its foreground is `#abb2bf`.

## Use the theme

Add `@lixpi/themes` as a `workspace:*` dependency and include it in the consumer's pnpm workspace and Docker build context. Load the theme from a Sass stylesheet:

```scss
@use "@lixpi/themes/dist/scss/one-dark-pro-mariana/theme";
```

Apply the theme to the document or a subtree:

```html
<html data-color-theme="one-dark-pro-mariana" data-theme="dark">
```

Use `var(--theme-background)`, `var(--theme-surface-secondary)`, `var(--theme-text)`, `var(--theme-heading)`, `var(--theme-text-muted)`, `var(--theme-border)`, and `var(--theme-accent)` in components. Status roles are `--theme-success`, `--theme-warning`, `--theme-danger`, and `--theme-info`. Code uses `--theme-code-text` and `--theme-code-background`. Syntax roles are `--theme-syntax-comment`, `--theme-syntax-string`, `--theme-syntax-number`, `--theme-syntax-constant`, `--theme-syntax-keyword`, `--theme-syntax-operator`, `--theme-syntax-function`, and `--theme-syntax-property`; a consumer's syntax highlighter can assign them to its token classes. Formula roles are `--theme-math-variable`, `--theme-math-greek`, `--theme-math-number`, `--theme-math-operator`, and `--theme-math-function`.

Import `oneDarkProMarianaTheme` from the single TypeScript entrypoint, `@lixpi/themes`, or retrieve it with `getTheme('one-dark-pro-mariana')`. This preset assigns the swatches in `src/palettes/mariana.ts` to the complete shared template through its `roles.ts` and `theme.ts`. It uses the same composition path as `lixpi-light`, with explicitly shared component values and no fallback preset. The separate CSS adapter preserves upstream `--mariana-*` overrides in the generated stylesheet; native TypeScript colors remain concrete. Setting `data-theme="light"` on the Mariana scope disables its dark styles.

## Gentelella consumers

```scss
@use "@lixpi/themes/dist/scss/one-dark-pro-mariana/theme" as mariana;
@use "@lixpi/themes/dist/scss/adapters/gentelella";

@include gentelella.apply(mariana.$selector);
```

IDBD Explorer loads this stylesheet from its HTML head so its first paint already uses the Mariana theme.

Navigation section headings use the shared `components.navigation.sectionHeading` profile: 14px text with a 1.5 line height, weight 500, normal letter spacing, no text transform, and 16px 20px 4px padding. The theme supplies their font family and section-label color. The Gentelella adapter and canvas library read the same profile, while Mariana keeps its apricot labels and existing font stack.

Panel widths, resize targets, toggle geometry and slide timing live in the shared panel values. Web UI settings project those values into their runtime configuration, and the canvas library consumes the same settings. The library's information panel retains its separate 416px initial width.

## Color mapping and attribution

The raw values come from upstream revision `3811dee855519f81d12102f054024f432942e8cc`. The reading canvas keeps the charcoal editor background `#282c34`. Prose uses the selection foreground `#d7dae0`, headings use terminal white `#e6e6e6`, and code uses the activity foreground `#c7ccd6` alongside its syntax colors. Supporting text uses the editor foreground `#abb2bf`. Chart series and status colors come from the theme's bright terminal palette: cyan, blue, green, amber, red, and purple. Code and formula syntax retain their own Mariana colors. These web mappings are defined separately from the copied palette so consumers can change a role without changing the source colors.

This directory contains Mariana's role assignments, preset composition and upstream MIT notices in `LICENSE` and `LICENSE.OneDarkPro.txt`. Its raw palette lives in `src/palettes/mariana.ts`, its CSS-variable mapping in `src/adapters/mariana-scss.ts`, and generated styles in `dist/scss/one-dark-pro-mariana/`. The package does not include the VS Code extension runtime or build tools.
