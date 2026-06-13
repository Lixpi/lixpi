---
name: command-execution
description: 'Hard Lixpi command policy for shell commands, package managers, dependency installs, project setup, scripts, builds, docs builds, linting, formatting, tests, Node tooling, and deletion safety. Never run npm, npx, pnpm, or pnpx on the host; use Docker containers. Ask the user to confirm exact path(s) before deleting repository files.'
---

# Command Execution

Read and follow `AGENTS.md`, `documentation/development-workflow/AGENT-SKILLS.md#command-execution-rule`, and `documentation/development-workflow/AGENT-SKILLS.md#file-deletion-permission-rule` before running commands.

The rule is mandatory: no host `npm`, `npx`, `pnpm`, or `pnpx`; no local dependency or tooling installs; no host project setup or script execution. Use the appropriate Docker container only.

The deletion rule is mandatory: ask the user to confirm exact file path(s) before deleting repository files. Delete only confirmed path(s); otherwise keep them and report cleanup candidates.
