# Web-UI Testing Guide

Everything in `services/web-ui` runs inside a Docker container (`lixpi-web-ui`). Tests are no exception — always run them through Docker, never locally.

## Running Tests

```bash
# Run all tests
docker exec lixpi-web-ui pnpm test:run

# Run a specific test file
docker exec lixpi-web-ui pnpm test:run -- src/infographics/utils/zoomScaling.test.ts

# Watch mode (interactive)
docker exec lixpi-web-ui pnpm test

# With UI
docker exec lixpi-web-ui pnpm test:ui
```

## Test Infrastructure

Tests use **Vitest** with the `happy-dom` DOM environment. The configuration lives in `vitest.config.ts` (NOT in `vite.config.ts` — we keep them separate because the Svelte vite plugin crashes Vitest's internal server). Globals are enabled, so you can use `describe`, `it`, `expect`, `vi` etc. without importing them, but we **do import them explicitly** for clarity.

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
```

### Path Aliases

Two aliases are available in tests, same as in app code:

- `$src` → `./src`
- `$lib` → `./packages/shadcn-svelte/lib`

### File Naming

Test files are **colocated** with their source files. Put `MyThing.test.ts` right next to `MyThing.ts`. No separate `__tests__` directories, no `tests/` folder — the test lives where the code lives.

```
src/
  infographics/
    utils/
      zoomScaling.ts
      zoomScaling.test.ts        ← right here
    workspace/
      WorkspaceConnectionManager.ts
      WorkspaceConnectionManager.test.ts   ← right here
  components/
    proseMirror/
      plugins/
        imageSelectionPlugin/
          imageNodeView.ts
          imageNodeView.test.ts  ← right here
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
import { getEdgeScaledSizes } from '$src/infographics/utils/zoomScaling.ts'

describe('getEdgeScaledSizes', () => {
    it('at zoom = 1.0 returns default base values', () => {
        const sizes = getEdgeScaledSizes(1)
        expect(sizes.strokeWidth).toBe(2)
        expect(sizes.markerSize).toBe(16)
    })
})
```

Always prefer testing pure, exported functions. If a class has complex logic buried in a method that uses only `this.nodes` and `this.edges` (no DOM), you can still construct the class with minimal mock DOM elements to get at the logic.

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

## Helper Factory Patterns

For non-ProseMirror tests, create typed factory functions that build test data with sensible defaults:

```typescript
function makeNode(overrides: Partial<CanvasNode> & { nodeId: string; type: CanvasNode['type'] }): CanvasNode {
    const base = {
        position: { x: 0, y: 0 },
        dimensions: { width: 200, height: 100 },
    }

    if (overrides.type === 'image') {
        return { ...base, fileId: 'file-1', workspaceId: 'ws-1', src: 'test.jpg', aspectRatio: 1, ...overrides } as CanvasNode
    }

    return { ...base, referenceId: 'ref-1', ...overrides } as CanvasNode
}
```

The `overrides` pattern forces you to provide required discriminant fields (`nodeId`, `type`) while giving everything else a default. This keeps tests focused on what matters.

## What NOT To Do

- **Don't test DOM rendering** — we don't render Svelte components in tests. Test the logic layer underneath.
- **Don't use `npx`** — it's `pnpm`. Always `pnpm test:run`.
- **Don't run tests outside Docker** — the container has the correct node_modules and environment. Your host machine doesn't.
- **Don't create `__tests__/` directories** — colocate. Always.
- **Don't use JSDoc comments** — project-wide rule, tests included.
- **Don't import with `.js` extensions** — always use `.ts` imports.
