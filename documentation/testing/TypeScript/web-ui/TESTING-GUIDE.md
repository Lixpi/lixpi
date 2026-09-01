# Web-UI Testing Guide

Everything in `services/web-ui` runs inside a Docker container (`lixpi-web-ui`).
Tests are the exception — they run inside the shared
`lixpi-typescript-test-runner` container instead, never inside `lixpi-web-ui`
and never locally.

Follow the shared [`TypeScript Testing Guide`](../TESTING-GUIDE.md) for test structure, file naming, pure-function tests, source-shape helpers, and factory patterns. This guide covers what is specific to `services/web-ui`.

## Agent Verification Commands

For web-ui changes, agents may run tests only after the user explicitly asks
for tests in the current thread. When tests are requested, verify test behavior
only through the Dockerized test-runner:

```bash
# Run all tests
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner web-ui

# Run a specific test file
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner web-ui src/canvas-adapters/workspace-canvas.test.ts
```

## Prohibited Verification

- Never load the application in a browser or use browser automation, screenshots, or manual visual inspection to verify an agent's work.
- Never replace a missing test with one of these prohibited checks. State the uncovered behavior in the completion report.

## Test Infrastructure

Tests use **Vitest** with the `happy-dom` DOM environment. The configuration lives in `vitest.config.ts`, separate from the application build configuration in `vite.config.ts`.

### Path Aliases

One alias is available in tests, same as in app code:

- `$src` → `./src`

## Testing Classes with DOM Dependencies

Some classes like `WorkspaceConnectionManager` need DOM elements in their constructor but their interesting methods don't actually touch the DOM. Create minimal mock configs:

```typescript
function createMockConfig() {
    const paneEl = document.createElement('div')
    const viewportEl = document.createElement('div')
    const edgesLayerEl = document.createElement('div')

    return {
        paneEl,
        viewportEl,
        edgesLayerEl,
        getTransform: () => [0, 0, 1] as [number, number, number],
        panBy: vi.fn().mockResolvedValue(true),
        onEdgesChange: vi.fn(),
        onSelectedEdgeChange: vi.fn(),
    }
}
```

Then use the class's public sync methods to inject state:

```typescript
manager.syncNodes([imageNode, chatNode])
manager.syncEdges([existingEdge])
```

The trick is to avoid testing DOM rendering — test the **logic** (what candidates are found, what edges are created, what callbacks fire).

## Testing ProseMirror Code

ProseMirror tests **must** use the `prosemirror-test-builder` package. This is non-negotiable — it's purpose-built for creating test documents with position tracking and it saves you from the nightmare of manually calculating node positions.

### Test Utilities

All ProseMirror test helpers live in:

```
src/components/proseMirror/plugins/testUtils/
    testSchema.ts            ← shared schema for tests
    prosemirrorTestUtils.ts  ← builders, helpers, exports
    testHelpers.ts           ← mock EditorView, etc.
```

### Node Builders

Import the builders from `prosemirrorTestUtils.ts`. These are constructed with `prosemirror-test-builder`'s `builders()` function and come with sensible defaults:

```typescript
import {
    doc,
    p,
    h1,
    img,
    aiImg,
    thread,
    response,
    createEditorState,
    createStateWithNodeSelection,
    createStateWithTextSelection,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'
```

Build documents naturally:

```typescript
const myDoc = doc(p('Hello world'), img({ src: 'cat.jpg' }))
const state = createEditorState(myDoc)
```

Select a node and inspect it:

```typescript
const state = createStateWithNodeSelection(doc(aiImg({ imageData: 'data:...' })), 0)
const selection = state.selection as NodeSelection
expect(selection.node.type.name).toBe('aiGeneratedImage')
```

### Builder Defaults vs Schema Defaults

This is a gotcha that will bite you. The `prosemirror-test-builder` builders have their **own** default attribute values, separate from the schema defaults. When you call `aiImg({ imageData: '...' })` without specifying `responseId`, you get the **builder** default (`'test-response-id'`), not the **schema** default (`''`).

Check the builder config in `prosemirrorTestUtils.ts` to see what defaults are set:

```typescript
aiImg: {
    nodeType: 'aiGeneratedImage',
    imageData: 'data:image/png;base64,test',
    isPartial: false,
    fileId: 'test-file-id',
    revisedPrompt: 'Test prompt',
    responseId: 'test-response-id',
    aiModel: 'dall-e-3',
    // ...
}
```

If you want to test the actual schema defaults, you must explicitly override with the schema default values:

```typescript
// WRONG: this uses the builder default, not the schema default
const node = aiImg({ imageData: '...' })
expect(node.attrs.responseId).toBe('')  // FAILS — it's 'test-response-id'

// RIGHT: explicitly pass the schema default
const node = aiImg({ imageData: '...', responseId: '' })
expect(node.attrs.responseId).toBe('')  // passes
```

### Parameterized Tests

When both `image` and `aiGeneratedImage` nodes share behavior, use parameterized test cases:

```typescript
const imageNodeCases = [
    {
        name: 'image',
        createNode: (attrs: Record<string, unknown> = {}) =>
            img({ src: 'test.jpg', alt: 'test', ...attrs }),
    },
    {
        name: 'aiGeneratedImage',
        createNode: (attrs: Record<string, unknown> = {}) =>
            aiImg({ imageData: 'data:image/png;base64,abc', ...attrs }),
    },
] as const

for (const { name, createNode } of imageNodeCases) {
    describe(`${name}`, () => {
        it('is a block node', () => {
            const state = createStateWithNodeSelection(doc(createNode()), 0)
            const selection = state.selection as NodeSelection
            expect(selection.node.isBlock).toBe(true)
        })
    })
}
```

## What NOT To Do

- **Don't use browser rendering as a substitute for tests** — test the logic layer and the DOM contracts supported by `happy-dom`.
- **Don't use `npx`** — it's `pnpm`. Always run through `lixpi-typescript-test-runner`'s `run-tests.sh web-ui`.
- **Don't run tests outside Docker** — the `lixpi-typescript-test-runner` container has the correct node_modules and environment. Your host machine doesn't.
- **Don't run tests inside `lixpi-web-ui`** — that container no longer has a test runner; use `lixpi-typescript-test-runner` instead.
- **Don't use browser-based verification** — browsers, browser automation, screenshots, and manual visual inspection are prohibited for verifying agent work.
