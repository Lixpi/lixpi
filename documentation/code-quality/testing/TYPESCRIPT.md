---
title: TypeScript Testing
description: Shared TypeScript test commands, infrastructure, and test-writing conventions.
---

# TypeScript Testing

This guide owns TypeScript testing across services and shared packages. A service does not get another testing guide just to repeat its domain name, Vitest environment, or runner command.

Read the [`code-quality` skill](../../../skills/code-quality/SKILL.md) first. Never write, modify, or run tests unless the user explicitly asks for tests in the current thread; these conventions apply only once that test work is permitted.

## Test Runner Container

All TypeScript service and package tests run inside `lixpi-typescript-test-runner`, defined in `docker-compose.typescript-test-runner.yml` and included by the root `docker-compose.yml`. Application containers do not ship a test runner.

The test runner is invoked as a one-shot `docker compose run --rm` command. Each invocation gets the current Compose configuration and a generated container name, so concurrent runs do not collide.

The commands below assume `.env` is already symlinked via `./set-env.sh` (see the repository `README.md`). Docker Compose only auto-loads a file named `.env`; otherwise pass `--env-file .env.<your-env>`.

Every invocation runs `pnpm install` before the test command, but this is normally fast, not a full reinstall: a shared `typescript-test-runner-pnpm-store` volume caches downloaded package content, and a `typescript-test-runner-node-modules-*` volume per workspace directory (domain root plus each bind-mounted `packages/lixpi/*` member) persists the linked `node_modules` output across runs, so `pnpm install` is normally an incremental no-op ("Already up to date") rather than a from-scratch install. Both volume groups are declared in `docker-compose.typescript-test-runner.yml`.

If the cache is corrupt or keeps a stale workspace link after a dependency rename or removal, wipe it with `./dev-tools/typescript-test-runner/nuke-cache.sh`. The next run performs a clean install. Routine dependency changes do not need this because each invocation reconciles `node_modules` against the lockfile.

Each service uses its own `package.json`, `pnpm-workspace.yaml`, and `vitest.config.ts`. The workspace manifest is mounted read-only in a staging directory and copied into the disposable workspace before `pnpm install`, so pnpm can record dependency build decisions without trying to replace a bind mount. The runner does not duplicate service configuration. Shared packages use the same copy-before-install pattern with `packages/lixpi/pnpm-workspace.yaml` so `workspace:*` dependencies resolve.

Use the same command for every configured service. The optional test path is relative to that service:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner <domain> [test-path]
```

The domain dispatcher in `dev-tools/typescript-test-runner/run-tests.sh` lists the available domains. `init-config` runs the environment wizard's editor and prompt-flow tests against synthetic configuration contents. It copies the setup sources into the disposable container before installing dependencies. `all` runs service and shared-package suites; invoke `init-config` separately.

The `nex` domain includes `workloads/nats-admission.runtime.test.ts`. Its opt-in application-cluster checks require NATS and LocalAuth0; set `LIXPI_NATS_AUTH_RUNTIME_TEST=true` and mount the selected local environment file read-only at `/run/nats-test.env`. They create and remove a unique Object Store bucket. `shared nats-subject-registry` verifies endpoint permission boundaries, user-scoped events, queues and declaration validation. Isolated Go admission tests are covered in [Go Testing and Tooling](GO.md).

With NEX workloads running, add `LIXPI_NATS_WORKLOAD_RUNTIME_TEST=true` to verify request/reply through conversion and fidelity identities. These requests exercise input rejection without processing user media.

`--rm` removes the container after the run, `-T` disables pseudo-TTY allocation, and `--no-deps` prevents unrelated services from starting. Both profiles are required because Compose validates cross-profile dependencies before selecting the target service.

For `shared`, the optional package name comes before the optional test path:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner shared [package] [test-path]
```

Without a package name, `shared` runs every shared package that defines `test:run`. Package tests follow the same colocation rule as service tests.

## Vitest Configuration

The `infrastructure` domain copies the Pulumi sources into the disposable runner and uses Pulumi mocks and synthetic AWS responses. Run `docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner infrastructure`. It does not preview or deploy a stack, build or publish images, or contact AWS.

The [Go test runner](GO.md) covers snapshot and restore acceptance with disposable brokers, temporary filesystem directories and an in-memory snapshot store. It also verifies compatibility in both directions with the pinned NATS CLI. The broker production image contains no CLI or shell. The infrastructure suite separately verifies the deployment adapter with mocked provider APIs.

`TestLiveScaleInPreservesSingleReplicaAndConcurrentWrites` in the Go broker package runs four disposable brokers, fences placement, evacuates streams and consumers, verifies retained R1 data, and continues R3 writes. The TypeScript infrastructure domain verifies controller transitions, unsafe health and placement rejection, singleton-zone protection, configurable node bounds and DynamoDB PITR.

The API's native storage acceptance uses a disposable NATS 2.15 server. It verifies permanent organization Blob bytes in native Object Store, JetStream event sequencing and deduplication, replay, purge and workqueue acknowledgements. It refuses application broker addresses and skips unless `NATIVE_NATS_TEST_SERVER` is supplied. Execute these commands in order and stop the disposable broker after the test, including after a failure:

```bash
docker run --rm -d --name lixpi-nats-native-storage-test --network nats nats:2.15.0-alpine@sha256:017eb6d9ec0eda3b7ba4d7858298ef58e4ccebdf7257692b97059dadf29d4552 --jetstream --store_dir /tmp/native-storage-test
docker compose --profile dev --profile main run --rm --no-deps -T -e NATIVE_NATS_TEST_SERVER=nats://lixpi-nats-native-storage-test:4222 lixpi-typescript-test-runner api src/services/native-nats-storage.runtime.test.ts
docker stop lixpi-nats-native-storage-test
```

Each domain owns its Vitest environment, include patterns, setup files, and aliases in `vitest.config.ts`. Browser clients use Happy DOM where their tests need DOM APIs. Add configuration to the domain rather than copying it into this guide or the shared runner.

## GitHub Actions

The `CI` workflow groups TypeScript checks under `typescript-tests` and `typescript-quality`, with `TypeScript / Tests` and `TypeScript / Formatting and linting` status names. Each configured service and shared-package test domain runs as an independent matrix job. Each test job invokes the same test-runner image through `docker-compose.typescript-test-runner.yml`; the GitHub host does not install pnpm, service dependencies, or Vitest.

CI sets non-secret local placeholder values for the Vite variables required by the test-runner Compose service and still uses `--no-deps`, so no application, NATS, auth, or database service starts. Pointing Compose at the one-shot runner file preserves the local image, mounts, dispatcher, and domain boundary without requiring a developer `.env` file or parsing the root application graph. Both TypeScript matrices and the separate Go quality, test, and build jobs must succeed for the stable `Required CI gate` status used by branch rules.

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

## Testing Classes with DOM Dependencies

When a class requires DOM elements but the behavior under test does not render, create the smallest DOM-backed config that satisfies its constructor. Inject state through the class's public methods, then assert the resulting values and callbacks instead of testing unrelated rendering.

```typescript
const createMockConfig = () => {
    const paneElement = document.createElement('div')
    const viewportElement = document.createElement('div')

    return {
        paneElement,
        viewportElement,
        getTransform: () => [0, 0, 1] as [number, number, number],
        panBy: vi.fn().mockResolvedValue(true),
        onChange: vi.fn(),
    }
}
```

Creating DOM elements directly is allowed in tests. Production UI code remains governed by the DOM templating rules in the TypeScript coding guide.

## Testing ProseMirror Code

Use `prosemirror-test-builder` for ProseMirror documents and position tracking. Shared builders and helpers live under `services/web-ui/src/components/proseMirror/plugins/testUtils/`; extend those helpers instead of calculating node positions by hand in each test.

```typescript
import {
    type NodeSelection,
} from 'prosemirror-state'
import {
    aiImg,
    createEditorState,
    createStateWithNodeSelection,
    doc,
    img,
    p,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'

const testDocument = doc(p('Hello world'), img({ src: 'cat.jpg' }))
const state = createEditorState(testDocument)
```

Builder defaults are separate from schema defaults. If a test checks a schema default, pass that value explicitly because omitting the attribute uses the builder's default.

```typescript
const node = aiImg({
    imageData: 'data:image/png;base64,test',
    responseId: '',
})
const state = createStateWithNodeSelection(
    doc(node),
    0,
)
const selection = state.selection as NodeSelection

expect(selection.node.attrs.responseId).toBe('')
```

Use parameterized cases when several node types share behavior:

```typescript
const imageNodeCases = [
    {
        name: 'image',
        createNode: () => img({ src: 'test.jpg' }),
    },
    {
        name: 'aiGeneratedImage',
        createNode: () => aiImg({ imageData: 'data:image/png;base64,test' }),
    },
] as const

for (const testCase of imageNodeCases) {
    it(`treats ${testCase.name} as a block node`, () => {
        const state = createStateWithNodeSelection(
            doc(testCase.createNode()),
            0,
        )
        const selection = state.selection as NodeSelection

        expect(selection.node.isBlock).toBe(true)
    })
}
```

## What NOT To Do

- **Don't create `__tests__/` directories** — colocate. Always.
- **Don't use JSDoc comments** — project-wide rule, tests included.
- **Don't import with `.js` extensions** — always use `.ts` imports.
