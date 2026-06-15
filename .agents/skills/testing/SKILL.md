---
name: testing
description: 'Read on every implementation iteration before deciding whether tests are allowed. Agents must never write, modify, or run tests unless the user explicitly asks for tests in the current thread. Never run svelte-check or use browser-based verification. Ask the user to confirm exact path(s) before deleting repository files.'
---

# Testing

Before running any command, follow the Docker-only command rule in `AGENTS.md` and `documentation/development-workflow/AGENT-SKILLS.md`: never run `npm`, `npx`, `pnpm`, or `pnpx` on the host.

Before editing, follow the deletion rule in `AGENTS.md` and `documentation/development-workflow/AGENT-SKILLS.md`: ask the user to confirm exact file path(s) before deleting repository files. Delete only confirmed path(s); otherwise keep them and report cleanup candidates.

Read and follow `documentation/testing/USING-TESTING-GUIDES.md` at the start of
every implementation iteration, before deciding whether test writing or test
execution is allowed.

Do not write tests, modify tests, or run test commands unless the user
explicitly asks for tests in the current thread. When tests are explicitly
requested, `documentation/testing/USING-TESTING-GUIDES.md` selects the
applicable source of truth.
