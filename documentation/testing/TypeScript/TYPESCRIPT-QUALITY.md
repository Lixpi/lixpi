---
title: TypeScript Linting and Formatting
description: Docker-only dprint and Oxlint commands for checking or fixing one Lixpi service or shared package at a time.
---

# TypeScript Linting and Formatting

The `lixpi-typescript-quality-runner` container owns TypeScript formatting and linting. It uses dprint for deterministic formatting and Oxlint for explicitly enabled repository rules. The container has its own pinned dependencies and does not reuse service, package, or test-runner dependencies.

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
| `check` | Runs `dprint check`, then Oxlint. It does not modify source. |
| `fix` | Runs `dprint fmt`, then applies Oxlint's safe fixes. |
| `format` | Runs `dprint fmt` only. |
| `format-check` | Runs `dprint check` only. |
| `lint` | Runs Oxlint only. |
| `lint-fix` | Runs Oxlint with safe fixes only. |

Run the runner's fixture test after changing its image, scripts, dprint configuration, or Oxlint configuration:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner self-test
```

The fixture test proves that invalid named-import formatting fails, formatting produces the exact expected source, the formatted source passes, Oxlint rejects a configured violation, and valid source passes.

## Named Import Layout

The repository uses dprint's `importDeclaration.forceMultiLine: "whenMultiple"` rule. A named import list with two or more items uses one item per line:

```typescript
import {
    applyNodeGeometry,
    type CanvasEngineRect
} from '@lixpi/canvas-engine/shared'
```

A named import list with one item may stay inline:

```typescript
import { applyNodeGeometry } from '@lixpi/canvas-engine/shared'
```

The threshold applies to items inside `{ ... }`. A default import combined with one named item still has a one-item named list:

```typescript
import CanvasEngine, { applyNodeGeometry } from '@lixpi/canvas-engine'
```

## Container and Cache Model

[`docker-compose.typescript-quality-runner.yml`](../../../docker-compose.typescript-quality-runner.yml) defines a separate one-shot service. Its command dispatcher mirrors the test runner, so a normal edit checks or formats only the selected service or package. Each shared package has its own source mount. The container image owns dprint, the TypeScript dprint plugin, and Oxlint; source directories remain bind-mounted from the repository.

dprint uses the `typescript-quality-runner-dprint-cache` volume for its compiled plugin and incremental file-state cache. Repeated commands skip unchanged files. Oxlint receives only the selected domain paths and uses its native parallel scanner.

The repository configuration lives in [`dprint.json`](../../../dprint.json) and [`.oxlintrc.json`](../../../.oxlintrc.json). The package and lockfile under [`services/typescript-quality-runner`](../../../services/typescript-quality-runner/) pin the toolchain. There is no TypeScript build step and the tools do not emit JavaScript.

Oxlint starts from an explicit rule baseline so adopting the runner does not silently turn unrelated existing findings into repository-wide failures. Add broader rules deliberately and clean their existing findings in the same change.

## Future Oxlint Stylistic Plugin Review

Monitor Oxlint's JavaScript plugin support and `@stylistic/eslint-plugin` compatibility for a stable release. Once that integration is stable, re-evaluate the Oxlint plus `@stylistic` approach. Adopt it if measured startup time, fix speed, rule fidelity, maintenance cost, and editor support are better than the dprint rule without weakening deterministic formatting.
