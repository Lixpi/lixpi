---
title: TypeScript and Stylesheet Linting and Formatting
description: Architecture, enforced syntax rules, and Docker-only commands for the TypeScript quality runner.
---

# TypeScript and Stylesheet Linting and Formatting

The `lixpi-typescript-quality-runner` container owns TypeScript, HTML, Sass, and CSS formatting and linting. It uses Oxfmt for production TypeScript, standalone HTML, and tagged HTML templates; Oxc for TypeScript syntax; parse5 for HTML syntax; dprint with Malva for stylesheet formatting; PostCSS and postcss-value-parser for stylesheet syntax; Oxlint for TypeScript rules and safe fixes; Stylelint for stylesheet rules; and the repository import/export-layout checker for the exact named-specifier matrix. The container has its own dependencies and does not reuse service, package, or test-runner dependencies.

Never run `node`, `npm`, `npx`, `pnpm`, `pnpx`, `dprint`, Oxlint, Stylelint, TypeScript files, package scripts, linters, or formatters on the host. Run every TypeScript and stylesheet quality command through Docker Compose from the repository root.

Every direct quality-runner dependency uses `"*"` in `package.json`. Each invocation resolves the latest available versions with `pnpm install --no-lockfile` inside the isolated tool workspace. The pnpm store and every `node_modules` directory are named Docker volumes; the runner never creates a lockfile, package store, or `node_modules` directory in the host checkout. Rebuild the base image only when its Dockerfile changes:

```bash
docker compose --profile dev --profile main build --no-cache lixpi-typescript-quality-runner
```

## Commands

The quality runner follows the TypeScript test runner's domain shape. Run a service independently:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner web-ui validate
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner api validate
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner nex validate
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner ai-model-registry validate
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner quality-runner validate
```

Run all shared packages or select one package by its directory name:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner shared validate
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner shared canvas-engine validate
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner shared canvas-components format
```

The runner also exposes `docs-site`, `infrastructure`, `random-useful-things`, and `quality-runner` domains. TypeScript rules apply to every TypeScript file, while Sass and CSS rules apply to every first-party stylesheet. Use `all` when a repository-wide change needs every configured domain:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner all validate
```

The action is optional and defaults to `validate`.

| Action | Behavior |
|--------|----------|
| `validate` | Validates Oxfmt and dprint formatting, Oxlint rules, named-import/export layout, and Stylelint rules. It does not modify source. |
| `fix` | Applies Oxlint fixes, formats production TypeScript and HTML with Oxfmt, formats stylesheets with dprint, fixes named-import/export layout, and applies Stylelint fixes. |
| `format` | Formats production TypeScript and HTML with Oxfmt, formats stylesheets with dprint, and fixes named-import/export layout. |
| `validate-formatting` | Validates Oxfmt, dprint, and named-import/export formatting. It does not modify source. |
| `lint` | Runs Oxlint and Stylelint. |
| `lint-fix` | Applies Oxlint and Stylelint fixes, then formats changed production TypeScript and HTML. |

## TypeScript and HTML formatting contracts

The quality runner treats parser nodes as the only authority for syntax boundaries. Oxc identifies TypeScript declarations, expressions, function parameters, call arguments, tagged-template quasis, and `${...}` interpolation bodies. parse5 identifies elements and attribute locations inside standalone HTML and `html` tagged templates. PostCSS supplies stylesheet declarations, and postcss-value-parser supplies the declaration-value tree used by custom Stylelint rules. Formatter and linter rules must not discover language constructs with regular expressions or raw source-text searches.

Oxfmt provides the baseline layout, but repository rules run through AST-addressed replacements after that baseline:

- A function, method, constructor, arrow function, call, or `new` expression with two or more parameters or arguments is multiline. The shared delimited-list formatter puts one item on each line and adds the trailing comma.
- A nested conditional expression keeps each level visibly nested. Each nested `?` and `:` is indented one level beyond its parent conditional instead of being flattened into the parent branch.
- TypeScript inside an `html` interpolation follows the same control-flow, conditional, argument, and expression rules as TypeScript outside a template. The HTML merge copies only parsed template quasis, so HTML formatting cannot replace an interpolation body with Oxfmt's uncanonicalized TypeScript output.
- An HTML start tag with two or more attributes is multiline, with one attribute per line. This applies to standalone `.html` files and `html` tagged templates, including attributes whose values contain TypeScript interpolations.
- String concatenation is prohibited by Oxlint's `prefer-template` rule. Use template interpolation. `validate` and `lint` reject concatenation even when Oxlint cannot safely fix it; `fix` applies the safe fixes Oxlint provides before the formatter runs.

The formatter preserves deliberately expanded types, arrays, objects, destructuring, expressions, and call chains. Repository canonicalizers may expand a structure when a rule requires it, but Oxfmt must not collapse a structure that the source intentionally expanded.

Run the runner's fixture test after changing its image, scripts, dprint configuration, Oxlint configuration, or Stylelint configuration:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner self-test
```

The fixture test proves the named-import matrix, native TypeScript execution, Sass four-space formatting, configured Oxlint violations, configured Stylelint violations, shared transition enforcement, React import rejection, and JSX source-file rejection.

## Named Import And Export Layout

The repository uses Oxfmt plus the quality runner's named-import layout check for production TypeScript. A named import list with two or more items uses one item per line:

```typescript
import {
    applyNodeGeometry,
    type CanvasEngineRect,
} from '@lixpi/canvas-engine/shared'
```

A named import list with one value stays inline:

```typescript
import { applyNodeGeometry } from '@lixpi/canvas-engine/shared'
```

A default import combined with one named value also stays inline:

```typescript
import CanvasEngine, { applyNodeGeometry } from '@lixpi/canvas-engine'
```

Type-only imports also use inline `type` specifiers so adding a future value import changes only the new line:

```typescript
import {
    type CanvasEngineRect,
} from '@lixpi/canvas-engine/shared'
```

Top-level `import type` declarations are rejected by Oxlint.

When a declaration contains both value and type imports, all values come first and all inline `type` specifiers come last. The quality runner's import-order check rejects interleaved groups and its `fix` or `lint-fix` action moves the type specifiers to the end while preserving the order inside each group.

Named exports use the same layout. A single exported item remains inline, while two or more exported items use one item per line. The same rule applies to `export type` declarations:

```typescript
export { createCertificateHelper } from './certificate-helper.ts'

export {
    createLambdaCertificateHelper,
    createLambdaCertificateManager,
} from './lambda-certificate-manager.ts'

export type {
    LambdaCertificateManagerArgs,
    LambdaCertificateManagerResult,
} from './lambda-certificate-manager.ts'
```

## Sass and CSS Rules

dprint's Malva plugin formats first-party `.scss` and `.css` files with four spaces and the repository's shared formatting settings. Stylelint parses both formats through `postcss-scss` and enforces these parts of [`SASS-AND-CSS.md`](../../../documentation/coding-style-guides/SASS-AND-CSS.md):

- Lixpi-owned classes use flat kebab-case names. BEM `__` and `--` punctuation, underscores, camelCase, and PascalCase are rejected. Explicit external contracts such as ProseMirror classes are exempt without weakening the application-class pattern.
- CSS custom properties use kebab-case.
- Nesting is limited to three levels. Blockless at-rules and nested pseudo-class qualifications do not consume the limit.
- Component transition values must use `hoverTransition`, `standardTransition`, `pupOutTransition`, `overlayVisibilityTransition`, `panelSlideTransition`, or a custom property populated by one of those helpers. Raw transition durations, timing functions, and mixed helper/raw lists are rejected. The shared transition implementation file is the only rule exception.
- Duplicate selectors, declarations, custom properties, Sass variables, Sass loads, Sass mixins, invalid properties, invalid units, invalid selectors, malformed calculations, invalid hex colors, and other deterministic CSS errors fail linting.

Style ownership, shared tooltip selection, external-contract classification, and selector/DOM lockstep still require code review because a stylesheet parser cannot determine those contracts safely.

When a Sass import changes the AI model registry's build graph, verify its standalone image as well as the quality runner:

```bash
docker compose --profile dev --profile main build lixpi-ai-model-registry
```

## Container and Cache Model

[`docker-compose.typescript-quality-runner.yml`](../../../docker-compose.typescript-quality-runner.yml) defines a separate one-shot service. Its command dispatcher mirrors the test runner, so a normal edit checks or formats only the selected service or package. Source paths are mounted selectively under `/usr/src/repository`; the repository root and package manifests are never bind-mounted there. Tool manifests, scripts, configuration, and wrappers are mounted separately under `/usr/src/quality-runner`, while tool dependencies use named Docker volumes. This prevents pnpm from writing installation artifacts into the host checkout.

dprint uses the `typescript-quality-runner-dprint-cache` volume for its compiled plugins and incremental file-state cache. pnpm uses `typescript-quality-runner-pnpm-store`, and both the tool workspace and its local debug-tools workspace have dedicated `node_modules` volumes. Oxlint and Stylelint receive only the selected domain paths. The formatter, import/export, Oxlint-plugin, and Stylelint wrappers are erasable TypeScript files executed directly by Node 24's stable type stripping; there is no generated JavaScript copy.

All linter and formatter configuration lives beside this documentation: [`oxfmt.json`](../oxfmt.json), [`dprint.json`](../dprint.json), [`oxlint.json`](../oxlint.json), and [`stylelint.config.ts`](../stylelint.config.ts). The wildcard package manifest is resolved without a lockfile on every invocation. There is no TypeScript build step and the tools do not emit JavaScript.

Oxlint starts from an explicit rule baseline so adopting the runner does not silently turn unrelated existing findings into repository-wide failures. The quality runner rejects JavaScript and JSX source files, React imports, `debugger`, top-level `import type`, file imports without their TypeScript extension, duplicate module imports, CommonJS imports, `interface` declarations outside ambient `.d.ts` files, plain function declarations, unnecessary arrow-body blocks, expression-bodied arrows longer than 150 characters whose body remains on the signature line, unnecessary braces around simple `if` bodies, `if` conditions with more than two logical evaluations that remain inline, simple brace-less `if` bodies that are not on the following indented line, comma-separated declarations and sequence expressions, semicolons that are not ASI guards, inline object destructuring with multiple properties, inline multi-value Map/Set-style initializers, inline multi-attribute D3/SVG chains, string concatenation, legacy own-property checks, JSON serialization used as a deep-clone substitute, restricted HTTP client packages, restricted raw DOM construction in web-ui implementation files, and native console logging outside frontend code and the debug-tools implementation. Named exports follow the same one-versus-many layout as named imports. Fix actions migrate JavaScript source files to TypeScript, remove unused imports without deleting unused local variables, and replace native backend console calls with `@lixpi/debug-tools` imports and calls.

The `lixpi/require-ast-formatter-rules` guard runs against every TypeScript implementation file in this service. It rejects regular expressions and raw source-string syntax searches so formatter and linter changes cannot bypass the parser boundary.

## GitHub Actions

The `CI` workflow runs the quality-runner self-test and every configured quality domain as independent matrix jobs. Each job builds and invokes `lixpi-typescript-quality-runner` through `docker-compose.typescript-quality-runner.yml`, so dprint, Oxlint, Stylelint, and the repository validation scripts never run on the GitHub host.

CI points Compose at the one-shot runner file directly. This keeps the same image, bind mounts, dispatcher, and domain commands used locally without parsing the unrelated application and deployment services from the root Compose graph. The matrix feeds one stable `Required CI gate` status after every quality and test job passes.
