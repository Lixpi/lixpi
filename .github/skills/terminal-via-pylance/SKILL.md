---
name: terminal-via-pylance
description: 'ALWAYS-ON enforcement: run read-only shell commands by wrapping them in Python via the Pylance MCP `pylanceRunCodeSnippet` tool instead of `run_in_terminal`, because VS Code Copilot cannot reliably read its own terminal output. NEVER for write/mutating commands. The full, authoritative rules live in `.github/instructions/terminal-via-pylance.instructions.md` (always loaded via `applyTo: ''**''`).'
---

# Terminal-Via-Pylance

This skill is the discoverable companion to the always-on instructions file at [.github/instructions/terminal-via-pylance.instructions.md](.github/instructions/terminal-via-pylance.instructions.md).

Before running any command, follow the Docker-only command rule in `AGENTS.md` and `documentation/development-workflow/AGENT-SKILLS.md`: never run `npm`, `npx`, `pnpm`, or `pnpx` on the host, including through Pylance.

That instructions file is the source of truth. Read it for:

- The full list of prohibited (mutating) command categories.
- The full list of allowed (read-only) commands.
- The exact `subprocess.run(...)` snippet template to use with `mcp_pylance_mcp_s_pylanceRunCodeSnippet`.
- The mandatory three-step self-check to run before every shell action.

Do not improvise — follow the instructions file exactly.
