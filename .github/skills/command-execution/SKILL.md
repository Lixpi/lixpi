---
name: command-execution
description: 'Hard Lixpi command policy for shell commands, package managers, dependency installs, project setup, scripts, builds, docs builds, linting, formatting, and tests, Node tooling. Never run npm, npx, pnpm, or pnpx on the host; use Docker containers.'
---

# Command Execution

Read and follow `AGENTS.md` and `documentation/development-workflow/AGENT-SKILLS.md#command-execution-rule` before running commands.

The rule is mandatory: no host `npm`, `npx`, `pnpm`, or `pnpx`; no local dependency or tooling installs; no host project setup or script execution. Use the appropriate Docker container only.
