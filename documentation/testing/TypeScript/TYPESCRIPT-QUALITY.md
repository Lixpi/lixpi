---
title: TypeScript and Stylesheet Linting and Formatting
description: Docker-only dprint, Oxlint, and Stylelint commands for checking or fixing one Lixpi service or shared package at a time.
---

# TypeScript and Stylesheet Linting and Formatting

The `lixpi-typescript-quality-runner` container owns TypeScript, Sass, and CSS formatting and linting. It uses dprint with its TypeScript and Malva plugins for deterministic formatting, Oxlint for explicitly enabled TypeScript rules, Stylelint with its SCSS plugin for stylesheet rules, and the repository import-layout checker for the exact named-import matrix that dprint cannot express. The container has its own pinned dependencies and does not reuse service, package, or test-runner dependencies.

Never run `node`, `npm`, `npx`, `pnpm`, `pnpx`, `dprint`, Oxlint, Stylelint, TypeScript files, package scripts, linters, or formatters on the host. Run every TypeScript and stylesheet quality command through Docker Compose from the repository root.

Update the quality runner's pinned dependencies from inside its Docker image. This command updates both `package.json` and `pnpm-lock.yaml` through the repository bind mount:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T --workdir /usr/src/repository/services/typescript-quality-runner --entrypoint pnpm lixpi-typescript-quality-runner add --save-dev dprint-plugin-malva@0.16.0 postcss-scss@4.0.9 stylelint@17.14.1 stylelint-scss@7.2.0
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
| `validate` | Validates dprint formatting, Oxlint rules, named-import layout, and Stylelint rules. It does not modify source. |
| `fix` | Runs `dprint fmt`, applies Oxlint's safe fixes, fixes named-import layout, and applies Stylelint's fixes. |
| `format` | Runs `dprint fmt` and fixes named-import layout. |
| `validate-formatting` | Validates dprint formatting and named-import layout. It does not modify source. |
| `lint` | Runs Oxlint, the named-import layout check, and Stylelint. |
| `lint-fix` | Applies Oxlint's and Stylelint's safe fixes and fixes named-import layout. |

Run the runner's fixture test after changing its image, scripts, dprint configuration, Oxlint configuration, or Stylelint configuration:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner self-test
```

The fixture test proves the named-import matrix, native TypeScript execution, Sass four-space formatting, configured Oxlint violations, configured Stylelint violations, shared transition enforcement, React import rejection, and JSX source-file rejection.

## Named Import Layout

The repository uses dprint plus the quality runner's named-import layout check. A named import list with two or more items uses one item per line:

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

## Sass and CSS Rules

dprint's Malva plugin formats first-party `.scss` and `.css` files with four spaces and the repository's shared formatting settings. Stylelint parses both formats through `postcss-scss` and enforces these parts of [`SASS-AND-CSS.md`](../../coding-style-guides/SASS-AND-CSS.md):

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

[`docker-compose.typescript-quality-runner.yml`](../../../docker-compose.typescript-quality-runner.yml) defines a separate one-shot service. Its command dispatcher mirrors the test runner, so a normal edit checks or formats only the selected service or package. The current repository is bind-mounted once at `/usr/src/repository`, while the image keeps dprint, its TypeScript and Malva plugins, Oxlint, Stylelint, and the SCSS parser at `/usr/src/quality-runner`. Keeping the tool runtime outside the repository mount prevents source edits from hiding the pinned dependencies and avoids stale single-file bind mounts.

dprint uses the `typescript-quality-runner-dprint-cache` volume for its compiled plugins and incremental file-state cache. Repeated commands skip unchanged files. Oxlint and Stylelint receive only the selected domain paths. The import and Stylelint wrappers are erasable TypeScript files executed directly by Node 24's stable type stripping; there is no generated JavaScript copy.

The repository configuration lives in [`dprint.json`](../../../dprint.json), [`.oxlintrc.json`](../../../.oxlintrc.json), and [`stylelint.config.mjs`](../../../stylelint.config.mjs). The package and committed lockfile under [`services/typescript-quality-runner`](../../../services/typescript-quality-runner/) pin the toolchain. There is no TypeScript build step and the tools do not emit JavaScript.

Oxlint starts from an explicit rule baseline so adopting the runner does not silently turn unrelated existing findings into repository-wide failures. The quality runner rejects JSX source files, React imports, `debugger`, top-level `import type`, file imports without their TypeScript extension, duplicate module imports, CommonJS imports, `interface` declarations outside ambient `.d.ts` files, legacy own-property checks, JSON serialization used as a deep-clone substitute, restricted HTTP client packages, and restricted raw DOM construction in web-ui implementation files. Add broader rules deliberately and clean their existing findings in the same change.

## GitHub Actions

The `CI` workflow runs the quality-runner self-test and every configured quality domain as independent matrix jobs. Each job builds and invokes `lixpi-typescript-quality-runner` through `docker-compose.typescript-quality-runner.yml`, so dprint, Oxlint, Stylelint, and the repository validation scripts never run on the GitHub host.

CI points Compose at the one-shot runner file directly. This keeps the same image, bind mounts, dispatcher, and domain commands used locally without parsing the unrelated application and deployment services from the root Compose graph. The matrix feeds one stable `Required CI gate` status after every quality and test job passes.

## Future Oxlint Stylistic Plugin Review

Monitor Oxlint's JavaScript plugin support and `@stylistic/eslint-plugin` compatibility for a stable release. Once that integration is stable, re-evaluate the Oxlint plus `@stylistic` approach. Adopt it if measured startup time, fix speed, rule fidelity, maintenance cost, and editor support are better than the dprint rule without weakening deterministic formatting.
