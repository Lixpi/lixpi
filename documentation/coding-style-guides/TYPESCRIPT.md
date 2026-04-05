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

In all non-Svelte `.ts` files that create DOM elements — ProseMirror plugins and NodeViews, shared components like dropdowns and bubble menus, canvas code, and any utility that builds UI — always use the `html` tagged template from `domTemplates.ts`:

```typescript
import { html } from '$src/utils/domTemplates.ts'

const el = html`
    <div className="my-component" onclick=${handleClick}>
        <span innerHTML=${someIcon}></span>
        <span>Label</span>
    </div>
`
```

Never use `document.createElement` / `Object.assign(el.style, ...)` / manual `el.className = ...` / `el.setAttribute(...)` in these files. The `html` helper produces real DOM nodes (no VDOM) and handles `className`, `innerHTML`, inline `style` objects, `data` attributes, and `on*` event handlers.

For SVG icons, import them from `$src/svgIcons/index.ts` and inject via `innerHTML` or string interpolation — never inline SVG markup in component code.

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
