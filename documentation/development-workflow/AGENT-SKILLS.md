# Agent Skill Organization

This document defines how Lixpi keeps project guidance available to coding agents without copying policy across tool-specific files.

## Design

Every installable skill lives under `skills/` in this repository. A skill may contain its own rules or scripts, or it may point to an authoritative document elsewhere in the repository. Its frontmatter states when the guidance applies, and its body tells the agent what to read or run.

[`setup-skills.sh`](../../setup-skills.sh) installs the tool-specific discovery links needed by the supported agents. Those generated locations are local configuration. Git ignores them, and the repository does not track their contents.

## Required Human-Facing Interaction Skill

The canonical `talk-like-a-human` skill lives at [`skills/talk-like-a-human/SKILL.md`](../../skills/talk-like-a-human/SKILL.md). Every agent must resolve and read `$talk-like-a-human` through the active harness's skill discovery at the start of every turn before writing human-facing text. The rule covers answers, clarification questions, progress updates, review comments, documentation, tickets, reports, and final responses. It applies to every interaction, not only documentation work.

If the canonical skill cannot be resolved or read, the agent must stop immediately. It must not continue the task or produce a substantive response. Its only permitted response is a brief report that `talk-like-a-human` could not be resolved, followed by waiting for the user's instructions.

## Installing Skills

Run the installer after cloning this repository:

```bash
./setup-skills.sh
```

The installer is interactive and takes no arguments. It first asks for the installation scope. Global installation is the default; project installation asks for one Git checkout, defaulting to this repository.

The harness page supports multiple selections. Move with the arrow keys, toggle Codex, Claude Code, Cursor, or GitHub Copilot with Space, then press Enter. The skill page uses the same controls and shows `All skills` beside every individual skill, so you can choose all skills or a subset in one step.

| Harness | Global directory | Project directory |
|---------|------------------|-------------------|
| Codex | `~/.agents/skills/` | `.agents/skills/` |
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| Cursor | `~/.cursor/skills/` | `.cursor/skills/` |
| GitHub Copilot | `~/.copilot/skills/` | `.github/skills/` |

Existing links to the same canonical skill are kept. Conflicting files or links stop installation before anything changes. Project installation adds generated links to that checkout's local Git exclude file. Global links live in the selected harness user directories and point back to the canonical skills in this checkout.

## Skills That Execute Code

Anything under `skills/` that executes code runs inside the `lixpi-utils` container, never on the host. [`SKILL-EXECUTION-GUIDE.md`](SKILL-EXECUTION-GUIDE.md) contains the rule, the exact `docker compose` commands, and the process for adding a script to a skill.

## Command Execution Rule

Agents must not run `npm`, `npx`, `pnpm`, or `pnpx` on the host. Agents must not install project dependencies or tooling on the host by any package manager.

Agents must not run project setup, package scripts, build scripts, docs builds, linters, formatters, test runners, framework CLIs, or repository scripts on the host. All project setup and script execution must happen inside the appropriate Docker container, such as `docker exec <container> pnpm ...`, when the task's other permission and testing gates allow that command.

If the Dockerized command is not documented or the required container is unavailable, agents stop and ask instead of falling back to a host command.

TypeScript, HTML, Sass, and CSS formatting and linting use the Docker-only commands in [`TYPESCRIPT-QUALITY.md`](../../services/typescript-quality-runner/documentation/TYPESCRIPT-QUALITY.md). Agents select the affected service or shared package instead of scanning unrelated workspaces. They must not invoke Oxfmt, dprint, Oxlint, Stylelint, TypeScript source, Node, or a package manager on the host.

## Adding Or Updating A Skill

1. Create or update the canonical skill at `skills/<name>/SKILL.md`.
2. Keep shared routing and constraints in `SKILL.md`. Put substantial mode-specific procedures in the skill's `references/` directory and link them from `SKILL.md`.
3. Give the skill a description that names the work and task signals that should load it.
4. Run `./setup-skills.sh`, choose the installation scope and harnesses, then select the updated skill or `All skills`.

Do not copy a skill into tool-specific directories or add it to a manually maintained inventory. The root `skills/` directory and the installer define what is available.

## Documentation Roots

Cross-cutting project guidance belongs in the most relevant documentation area, such as `documentation/code-quality/`, `documentation/development-workflow/`, or the documentation beside the service or package it governs. Guidance loaded only for a specific skill belongs in that skill package, with substantial conditional material under `references/`.

## References

- [Use Agent Skills in VS Code](https://code.visualstudio.com/docs/copilot/customization/agent-skills)
- [About agent skills - GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
- [Extend Claude with skills - Claude Code Docs](https://code.claude.com/docs/en/skills)
- [Agent Skills - Cursor Docs](https://cursor.com/docs/skills)
