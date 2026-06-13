---
name: project-navigation
description: 'Navigate and understand the Lixpi monorepo when locating services, packages, infrastructure, documentation, component ownership, or the correct place for changes. Ask the user to confirm exact path(s) before deleting repository files.'
---

# Project Navigation

Before running any command, follow the Docker-only command rule in `AGENTS.md` and `documentation/development-workflow/AGENT-SKILLS.md`: never run `npm`, `npx`, `pnpm`, or `pnpx` on the host.

Before editing, follow the deletion rule in `AGENTS.md` and `documentation/development-workflow/AGENT-SKILLS.md`: ask the user to confirm exact file path(s) before deleting repository files. Delete only confirmed path(s); otherwise keep them and report cleanup candidates.

Read and follow `documentation/development-workflow/PROJECT-NAVIGATION.md`. That document is the source of truth.
