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

- Never use JSDoc comments. No `/** */` blocks anywhere in the codebase.

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
