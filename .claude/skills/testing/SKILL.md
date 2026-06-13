---
name: testing
description: 'Follow Lixpi testing and verification rules when adding or updating tests, test utilities, mocks, fixtures, or verifying any work. Never run svelte-check or use browser-based verification. Ask the user to confirm exact path(s) before deleting repository files.'
---

# Testing

Before running any command, follow the Docker-only command rule in `AGENTS.md` and `documentation/development-workflow/AGENT-SKILLS.md`: never run `npm`, `npx`, `pnpm`, or `pnpx` on the host.

Before editing, follow the deletion rule in `AGENTS.md` and `documentation/development-workflow/AGENT-SKILLS.md`: ask the user to confirm exact file path(s) before deleting repository files. Delete only confirmed path(s); otherwise keep them and report cleanup candidates.

Read and follow `documentation/testing/USING-TESTING-GUIDES.md` before selecting or running verification commands. That document selects the applicable sources of truth.
