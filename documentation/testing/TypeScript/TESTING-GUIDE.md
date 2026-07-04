# TypeScript Testing Guide

Shared conventions for writing TypeScript tests across Lixpi services. Service-specific setup, runners, path aliases, and verification commands live in the per-service guides below this one, such as [`web-ui`](web-ui/TESTING-GUIDE.md).

Read `documentation/testing/USING-TESTING-GUIDES.md` first. Never write, modify, or run tests unless the user explicitly asks for tests in the current thread; these conventions apply only once that test work is permitted.

## Test Runner Container

All TypeScript tests — across `services/web-ui`, `services/api`, `services/nex`, and the individual `packages/lixpi/*` packages — run inside one image, `lixpi-typescript-test-runner`, defined in `docker-compose.typescript-test-runner.yml` and pulled into the root `docker-compose.yml` via its top-level `include:`. The app-runtime containers (`lixpi-web-ui`, `lixpi-api`, `lixpi-nex`) do not ship a test runner; tests are never executed there.

The test runner is invoked as a one-shot `docker compose run --rm` command, never a long-lived container — each invocation gets a fresh container (so it always reflects the current compose config) with a Compose auto-generated unique name (so concurrent invocations never collide).

The commands below assume `.env` is already symlinked via `./set-env.sh` (see the repo root `README.md`) — Docker Compose only auto-loads a file literally named `.env`, and without it every variable in `docker-compose.yml` comes back unset. If you haven't run `./set-env.sh`, either run it once or add `--env-file .env.<your-env>` to each command below.

Every invocation runs `pnpm install` before the test command, but this is normally fast, not a full reinstall: a shared `typescript-test-runner-pnpm-store` volume caches downloaded package content, and a `typescript-test-runner-node-modules-*` volume per workspace directory (domain root plus each bind-mounted `packages/lixpi/*` member) persists the linked `node_modules` output across runs, so `pnpm install` is normally an incremental no-op ("Already up to date") rather than a from-scratch install. Both volume groups are declared in `docker-compose.typescript-test-runner.yml`.

If that cache itself is ever suspect (corrupted store, a stale `node_modules` link surviving a dependency rename/removal), wipe it with `./services/typescript-test-runner/nuke-cache.sh` — it removes every `lixpi_typescript-test-runner-*` volume, so the next run does a full install from scratch. This is not needed for routine dependency changes; `pnpm install` already reconciles `node_modules` against the lockfile on every run.

Each service is fully self-contained and bind-mounted into the test-runner container exactly as it is — same `package.json`, `pnpm-workspace.yaml`, and `vitest.config.ts` the service itself owns, nothing duplicated. `packages/lixpi/*` packages are tied together by `packages/lixpi/pnpm-workspace.yaml` so `workspace:*` dependencies between them resolve. A single universal entrypoint script dispatches by domain:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner web-ui
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner api
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner nex
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner shared
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner all
```

(`--rm` removes the container once it exits; `-T` disables pseudo-TTY allocation for non-interactive shells; `--no-deps` prevents Compose from starting unrelated services; both `--profile dev` and `--profile main` are required because the compose file has a cross-profile `depends_on` elsewhere that Compose validates regardless of which service you're targeting.)

Pass a specific test file after the domain to target it (for `api`/`web-ui`/`nex` only — `shared` runs every `packages/lixpi/*` package that defines a `test:run` script):

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner web-ui src/infographics/utils/zoomScaling.test.ts
```

For `shared`, an optional first argument selects a single package by its directory name under `packages/lixpi` (e.g. `auth-service`, or `debug-tools`/`nats-service` as shorthand for their nested `ts/` subfolder); any remaining arguments are passed through to vitest:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner shared auth-service
```

`shared` runs tests colocated inside whichever `packages/lixpi/*` package they belong to — the same colocation rule below applies there too, so a package's tests live right next to its source, not in a separate `tests/` directory. A `packages/lixpi/*` package only needs `vitest` as a devDependency and a `test:run` script once it actually has tests to run.

Tests use **Vitest**. Globals are enabled, so you can use `describe`, `it`, `expect`, `vi` etc. without importing them, but we **do import them explicitly** for clarity.

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
```

## File Naming

Test files are **colocated** with their source files. Put `MyThing.test.ts` right next to `MyThing.ts`. No separate `__tests__` directories, no `tests/` folder — the test lives where the code lives.

```
src/
  utils/
    formatDuration.ts
    formatDuration.test.ts       ← right here
  services/
    RetryQueue.ts
    RetryQueue.test.ts           ← right here
  parsers/
    config/
      parseConfig.ts
      parseConfig.test.ts        ← right here
```

## Test Structure

We use `describe` blocks with section comment banners to organize tests visually. Each major area gets a banner:

```typescript
// =============================================================================
// SOME LOGICAL GROUP OF TESTS
// =============================================================================

describe('SomeThing — behavior name', () => {
    let manager: SomeThing

    beforeEach(() => {
        manager = createSomeThing()
    })

    it('does X when Y', () => {
        // ...
    })
})
```

Nested `describe` blocks are fine for sub-grouping, but keep nesting shallow (2 levels max).

## Testing Pure Functions

The easiest tests — no mocking needed. Import the function, call it, assert the result.

```typescript
import { describe, it, expect } from 'vitest'
import { clamp } from './clamp.ts'

describe('clamp', () => {
    it('returns the value when it is within range', () => {
        expect(clamp(5, 0, 10)).toBe(5)
    })

    it('clamps to the upper bound', () => {
        expect(clamp(15, 0, 10)).toBe(10)
    })
})
```

Always prefer testing pure, exported functions. If a class has complex logic buried in a method that reads only its own in-memory fields, you can still construct the class with minimal stubbed collaborators to get at the logic.

## Source-Shape Tests

Some regression tests inspect source text directly when a behavior depends on code structure that is hard to exercise through a small unit test. Keep these assertions terse on failure.

Never use direct `.toContain(...)` or `.not.toContain(...)` assertions on whole files or large extracted function/block strings. Vitest prints the entire received source when these fail, which makes failures noisy and hard to read.

Required pattern:

- If you are inspecting source text, wrap assertions through `.includes(...)` with a targeted error message.
- Use dedicated helper functions for this style of check.

Use this shape:

```typescript
function expectSourceToContain(source: string, snippet: string, label = 'source excerpt'): void {
    expect(
        source.includes(snippet),
        `${label} should contain:\n${snippet}`
    ).toBe(true)
}

function expectSourceNotToContain(source: string, snippet: string, label = 'source excerpt'): void {
    expect(
        source.includes(snippet),
        `${label} should not contain:\n${snippet}`
    ).toBe(false)
}
```

Use these helpers for extracted handlers, function bodies, config blocks, and full-file source strings. This keeps failures focused on the missing or unexpected snippet instead of dumping the entire source excerpt.
If a test can be written as a runtime behavior test, prefer that over source-shape checks.

## Test Noise Hygiene

When tests hit expected failure paths, do **not** let `console` spam leak into test output.

Use per-test spies with strict restore in `beforeEach`/`afterEach`, and restore every spy before the test suite exits.

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let consoleWarnSpy: ReturnType<typeof vi.spyOn> | null = null
let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null

describe('AiChatThreadService', () => {
    beforeEach(() => {
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    })

    afterEach(() => {
        consoleWarnSpy?.mockRestore()
        consoleWarnSpy = null
        consoleErrorSpy?.mockRestore()
        consoleErrorSpy = null
    })

    it('logs and returns null when backend transport fails', () => {
        // ...
    })
})
```

If the behavior under test expects specific warnings or errors, assert against those spies instead of printing to stdout/stderr.

For noisy external side effects (Auth/token refresh, fetch retries, third-party SDK logs), mock the underlying dependency so the test controls the failure mode and does not generate real environment noise.

## Helper Factory Patterns

For tests that need structured input data, create typed factory functions that build it with sensible defaults:

```typescript
type Job =
    | { jobId: string; type: 'email'; recipient: string; retries: number }
    | { jobId: string; type: 'export'; format: string; retries: number }

function makeJob(overrides: Partial<Job> & { jobId: string; type: Job['type'] }): Job {
    const base = { retries: 0 }

    if (overrides.type === 'email') {
        return { ...base, recipient: 'user@example.com', ...overrides } as Job
    }

    return { ...base, format: 'json', ...overrides } as Job
}
```

The `overrides` pattern forces you to provide required discriminant fields (`jobId`, `type`) while giving everything else a default. This keeps tests focused on what matters.

## What NOT To Do

- **Don't create `__tests__/` directories** — colocate. Always.
- **Don't use JSDoc comments** — project-wide rule, tests included.
- **Don't import with `.js` extensions** — always use `.ts` imports.
