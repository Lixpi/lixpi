# TypeScript Coding Style Guide

## Imports

- Always use `.ts` extension when importing files — never `.js`.
- Combine type and value imports in a single import block:

```typescript
import {
    createJwtVerifier,
    type JwtVerificationResult
} from '@lixpi/auth-service'
```

## Type Definitions

- Use `type` instead of `interface` for all type definitions.

```typescript
// Correct
type UserProfile = {
    id: string
    name: string
}

// Wrong — do not use interface
interface UserProfile {
    id: string
    name: string
}
```

## Comments

- Always use `//` single-line comments. For multi-line explanations, use multiple `//` lines.
- Never use `/** */` or `/* */` block comments anywhere in the codebase.

```typescript
// Correct — single-line
// This function handles token refresh by redirecting
// through the browser-based login flow.

// Wrong — never use block comments
/** This function handles token refresh. */
/* This function handles token refresh. */
```

## Docker

Every service runs inside its own Docker container. All commands (tests, builds, linters, etc.) must be executed inside the relevant container using `docker exec`. Never run service commands on the host machine.

## Modern JavaScript / ES Modules

All projects use `"type": "module"` and target the latest ECMAScript releases. Always use modern language features — never legacy patterns.

### Async / Await

Always use `async`/`await`. Never use `.then()` / `.catch()` chains.

```typescript
// Correct
const data = await fetchData()

// Wrong — never use .then()
fetchData().then((data) => { ... })
```

### DOM Templating (web-ui)

**This rule is mandatory. No exceptions outside of test files.**

In all non-Svelte `.ts` files that create DOM elements — ProseMirror plugins and NodeViews, shared components, canvas code (`WorkspaceCanvas.ts`, utilities, etc.), and any other file that builds UI — always use the `html` tagged template from `domTemplates.ts`:

```typescript
import { html } from '$src/utils/domTemplates.ts'

const el = html`
    <div className="my-component" onclick=${handleClick}>
        <span innerHTML=${someIcon}></span>
        <span>Label</span>
    </div>
` as HTMLDivElement
```

**Never use `document.createElement` in these files.** Also forbidden: `Object.assign(el.style, ...)`, `el.className = ...`, `el.setAttribute(...)`. The `html` helper produces real DOM nodes (no VDOM) and handles:

- `className` — sets `element.className`
- `innerHTML` — sets `element.innerHTML`
- `style` — object of camelCase CSS properties passed as a variable reference: `style=${styleObj}`. **Never inline the object literal directly in the template.** Always declare a named variable first:
  ```ts
  // CORRECT
  const railStyle = { position: 'absolute' as const, width: `${WIDTH}px`, zIndex: '9990' }
  const el = html`<div className="my-rail" style=${railStyle}></div>` as HTMLDivElement

  // WRONG — do not do this
  const el = html`<div className="my-rail" style=${{ position: 'absolute', width: `${WIDTH}px`, zIndex: '9990' }}></div>` as HTMLDivElement
  ```
  The only acceptable exception is a single trivial property where the intent is self-evident: `style=${{ display: 'none' }}`.
- `data` — object of dataset values (e.g. `data=${{ nodeId: id }}`)
- `on*` — event handlers (e.g. `onclick=${handler}`)

CSS custom properties (`--foo`) cannot be set via the `style` object — use `.style.setProperty('--foo', value)` on the element after creation. That is fine.

To apply multiple style properties to an **existing** element, use `applyStyle` from `domTemplates.ts` — never set properties one line at a time:
```ts
import { applyStyle } from '$src/utils/domTemplates.ts'

// CORRECT
applyStyle(el, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` })

// WRONG — do not do this
el.style.left = `${x}px`
el.style.top = `${y}px`
el.style.width = `${w}px`
el.style.height = `${h}px`
```
Single-property assignments (`el.style.display = 'none'`) are still fine.

For SVG icons, import them from `$src/svgIcons/index.ts` and inject via `innerHTML` — never inline SVG markup in component code.

The only exception is test files (`*.test.ts`) where minimal DOM setup for mocking is acceptable.

### Prefer Modern APIs Over Legacy Alternatives

| Use | Instead of |
|-----|------------|
| `async` / `await` | `.then()` / `.catch()` / callbacks |
| `for...of` | `.forEach()` when `await` or `break` is needed |
| `structuredClone()` | `JSON.parse(JSON.stringify())` |
| `Object.hasOwn(obj, key)` | `obj.hasOwnProperty(key)` |
| `Array.at(-1)` | `arr[arr.length - 1]` |
| Template literals | String concatenation with `+` |
| Optional chaining `?.` | Manual null checks |
| Nullish coalescing `??` | `\|\|` for default values |
| `using` / `await using` | Manual resource cleanup (when supported) |
| Native `fetch` API | `axios` or any HTTP client library |
