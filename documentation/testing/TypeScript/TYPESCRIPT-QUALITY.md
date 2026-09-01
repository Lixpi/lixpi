---
title: TypeScript Linting and Formatting
description: Docker-only dprint and Oxlint commands for checking or fixing one Lixpi service or shared package at a time.
---

# TypeScript Linting and Formatting

The `lixpi-typescript-quality-runner` container owns TypeScript formatting and linting. It uses dprint for deterministic formatting, Oxlint for explicitly enabled repository rules, and the repository import-layout checker for the exact named-import matrix that dprint cannot express. The container has its own pinned dependencies and does not reuse service, package, or test-runner dependencies.

Never run `node`, `npm`, `npx`, `pnpm`, `pnpx`, `dprint`, Oxlint, TypeScript files, package scripts, linters, or formatters on the host. Run every TypeScript quality command through Docker Compose from the repository root.

## Commands

The quality runner follows the TypeScript test runner's domain shape. Run a service independently:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner web-ui check
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner api check
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner nex check
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner ai-model-registry check
```

Run all shared packages or select one package by its directory name:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner shared check
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner shared canvas-engine check
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner shared canvas-components format
```

The runner also exposes `docs-site`, `infrastructure`, and `random-useful-things` domains because the TypeScript guide applies to every TypeScript file in the repository. Use `all` when a repository-wide change needs every configured domain:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner all check
```

The action is optional and defaults to `check`.

| Action | Behavior |
|--------|----------|
| `check` | Runs `dprint check`, Oxlint, and the named-import layout check. It does not modify source. |
| `fix` | Runs `dprint fmt`, applies Oxlint's safe fixes, and fixes named-import layout. |
| `format` | Runs `dprint fmt` and fixes named-import layout. |
| `format-check` | Runs `dprint check` and the named-import layout check. |
| `lint` | Runs Oxlint and the named-import layout check. |
| `lint-fix` | Applies Oxlint's safe fixes and fixes named-import layout. |

Run the runner's fixture test after changing its image, scripts, dprint configuration, or Oxlint configuration:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner self-test
```

The fixture test proves that invalid named-import formatting fails, formatting produces the exact expected source, the formatted source passes, Oxlint rejects a configured violation, React imports and JSX source files are rejected, and valid source passes.

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

## Container and Cache Model

[`docker-compose.typescript-quality-runner.yml`](../../../docker-compose.typescript-quality-runner.yml) defines a separate one-shot service. Its command dispatcher mirrors the test runner, so a normal edit checks or formats only the selected service or package. The current repository is bind-mounted once at `/usr/src/repository`, while the image keeps dprint, the TypeScript dprint plugin, and Oxlint at `/usr/src/quality-runner`. Keeping the tool runtime outside the repository mount prevents source edits from hiding the pinned dependencies and avoids stale single-file bind mounts.

dprint uses the `typescript-quality-runner-dprint-cache` volume for its compiled plugin and incremental file-state cache. Repeated commands skip unchanged files. Oxlint receives only the selected domain paths and uses its native parallel scanner.

The repository configuration lives in [`dprint.json`](../../../dprint.json) and [`.oxlintrc.json`](../../../.oxlintrc.json). The package and lockfile under [`services/typescript-quality-runner`](../../../services/typescript-quality-runner/) pin the toolchain. There is no TypeScript build step and the tools do not emit JavaScript.

Oxlint starts from an explicit rule baseline so adopting the runner does not silently turn unrelated existing findings into repository-wide failures. The quality runner rejects JSX source files, React imports, `debugger`, top-level `import type`, file imports without their TypeScript extension, duplicate module imports, CommonJS imports, `interface` declarations outside ambient `.d.ts` files, legacy own-property checks, JSON serialization used as a deep-clone substitute, restricted HTTP client packages, and restricted raw DOM construction in web-ui implementation files. Add broader rules deliberately and clean their existing findings in the same change.

## Future Oxlint Stylistic Plugin Review

Monitor Oxlint's JavaScript plugin support and `@stylistic/eslint-plugin` compatibility for a stable release. Once that integration is stable, re-evaluate the Oxlint plus `@stylistic` approach. Adopt it if measured startup time, fix speed, rule fidelity, maintenance cost, and editor support are better than the dprint rule without weakening deterministic formatting.
