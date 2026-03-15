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
