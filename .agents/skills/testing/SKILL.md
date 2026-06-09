---
name: testing
description: 'Read on every implementation iteration before deciding whether tests are allowed. Agents must never write, modify, or run tests unless the user explicitly asks for tests in the current thread. Never run svelte-check or use browser-based verification.'
---

# Testing

Read and follow `documentation/testing/USING-TESTING-GUIDES.md` at the start of
every implementation iteration, before deciding whether test writing or test
execution is allowed.

Do not write tests, modify tests, or run test commands unless the user
explicitly asks for tests in the current thread. When tests are explicitly
requested, `documentation/testing/USING-TESTING-GUIDES.md` selects the
applicable source of truth.
