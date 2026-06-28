# TypeScript Testing Guide

Shared conventions for writing TypeScript tests across Lixpi services. Service-specific setup, runners, path aliases, and verification commands live in the per-service guides below this one, such as [`web-ui`](web-ui/TESTING-GUIDE.md).

Read `documentation/testing/USING-TESTING-GUIDES.md` first. Never write, modify, or run tests unless the user explicitly asks for tests in the current thread; these conventions apply only once that test work is permitted.

## Test Runner

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
