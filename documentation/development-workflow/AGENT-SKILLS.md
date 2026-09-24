# Agent Skill Organization

This document defines how Lixpi keeps project guidance available to coding agents without copying policy across tool-specific files.

## Design

Every shared agent skill lives under `${LIXPI_REPOSITORY_PATH}/skills/`. Read `LIXPI_REPOSITORY_PATH` from the consuming repository's `env.lixpi` before resolving these paths. A skill may contain its own rules or scripts, or it may point to an authoritative document elsewhere in the repository. Its frontmatter states when the guidance applies, and its body tells the agent what to read or run.

[`setup-skills.sh`](../../setup-skills.sh) optionally installs tool-specific discovery links for native skill selectors. Agents can discover the canonical skills directly without running it. Generated links are local configuration. Git ignores them, and the repository does not track their contents.

For each task, use any skill names and descriptions already supplied by the harness, then inspect the frontmatter of `${LIXPI_REPOSITORY_PATH}/skills/*/SKILL.md` files that are not already represented. Resolve harness links to their canonical files before comparing them. Read a selected skill's full instructions once; do not load every skill body or rescan unchanged directories during the same task.

Paths to canonical agent skills under `${LIXPI_REPOSITORY_PATH}/skills/` use the configured repository root. Capability Skill packages under `packages/lixpi/capability-system/` use ordinary relative paths, as do links to documentation outside the agent skill directory.

## Required Human-Facing Interaction Skill

The canonical `talk-like-a-human` skill lives at [its skill file](${LIXPI_REPOSITORY_PATH}/skills/talk-like-a-human/SKILL.md). Every agent must read it at the start of every turn before writing human-facing text, whether or not the harness has installed it. The rule covers answers, clarification questions, progress updates, review comments, documentation, tickets, reports, and final responses. It applies to every interaction, not only documentation work.

If the canonical skill cannot be resolved or read, the agent must stop immediately. It must not continue the task or produce a substantive response. Its only permitted response is a brief report that `talk-like-a-human` could not be resolved, followed by waiting for the user's instructions.

## Installing Skills

If you want native harness skill selectors, run configuration setup after cloning so `env.lixpi` exists, then invoke the installer using its configured `LIXPI_REPOSITORY_PATH`:

```bash
"${LIXPI_REPOSITORY_PATH}/setup-skills.sh"
```

The installer is interactive and takes no arguments. It first asks for the installation scope. Global installation is the default; project installation asks for one Git checkout, defaulting to this repository.

The harness page supports multiple selections. Move with the arrow keys, toggle Codex, Claude Code, Cursor, or GitHub Copilot with Space, then press Enter. The skill page uses the same controls and shows `All skills` beside every individual skill, so you can choose all skills or a subset in one step.

The prompt UI runs inside the `lixpi-utils` container and uses the same Clack components as `init-config.sh`. It renders through stderr and returns the confirmed selection through stdout. The host launcher validates that value and creates the selected links. The container does not mount the user's home directory or the selected project's Git metadata.

Global discovery links live in each harness's user configuration directory. Project discovery links use the selected checkout's configured path. For the main Lixpi checkout:

| Harness | Project directory |
|---------|-------------------|
| Codex | `${LIXPI_REPOSITORY_PATH}/.agents/skills/` |
| Claude Code | `${LIXPI_REPOSITORY_PATH}/.claude/skills/` |
| Cursor | `${LIXPI_REPOSITORY_PATH}/.cursor/skills/` |
| GitHub Copilot | `${LIXPI_REPOSITORY_PATH}/.github/skills/` |

Links point to absolute canonical paths derived from `LIXPI_REPOSITORY_PATH`. Existing links to the same skill are normalized to that target. Conflicting files or links stop installation before anything changes. Project installation adds generated links to that checkout's local Git exclude file. Global links live in the selected harness user directories and point back to the canonical skills in this checkout.

## Skills That Execute Code

Anything under `${LIXPI_REPOSITORY_PATH}/skills/` that executes code runs inside the `lixpi-utils` container, never on the host. The [Skill Execution Guide](SKILL-EXECUTION-GUIDE.md) contains the rule, the exact `docker compose` commands, and the process for adding a script to a skill.

## Command Execution Rule

Agents must not run `npm`, `npx`, `pnpm`, or `pnpx` on the host. Agents must not install project dependencies or tooling on the host by any package manager.

Agents must not run project setup, package scripts, build scripts, docs builds, linters, formatters, test runners, framework CLIs, or repository scripts on the host. All project setup and script execution must happen inside the appropriate Docker container, such as `docker exec <container> pnpm ...`, when the task's other permission and testing gates allow that command.

If the Dockerized command is not documented or the required container is unavailable, agents stop and ask instead of falling back to a host command.

TypeScript, HTML, Sass, and CSS formatting and linting use the Docker-only commands in the [TypeScript quality runner README](../../dev-tools/code-quality/typescript-quality-runner/README.md). Agents select the affected service or shared package instead of scanning unrelated workspaces. They must not invoke Oxfmt, dprint, Oxlint, Stylelint, TypeScript source, Node, or a package manager on the host.

## Adding Or Updating A Skill

1. Create or update the canonical skill at `${LIXPI_REPOSITORY_PATH}/skills/<name>/SKILL.md`.
2. Keep shared routing and constraints in that skill file. Put substantial mode-specific procedures in `${LIXPI_REPOSITORY_PATH}/skills/<name>/references/` and link them with the same repository path variable.
3. Give the skill a description that names the work and task signals that should load it.
4. To expose the skill in a harness's native selector, run `${LIXPI_REPOSITORY_PATH}/setup-skills.sh`, choose the installation scope and harnesses, then select the updated skill or `All skills`.

Do not copy a skill into tool-specific directories or add it to a manually maintained inventory. The `${LIXPI_REPOSITORY_PATH}/skills/` directory defines what agents can discover; the installer only adds native harness links.

## Documentation Roots

Cross-cutting project guidance belongs in the most relevant documentation area, such as `documentation/code-quality/`, `documentation/development-workflow/`, or the documentation beside the service or package it governs. Guidance loaded only for a specific skill belongs in that skill package, with substantial conditional material under `${LIXPI_REPOSITORY_PATH}/skills/<name>/references/`.

## References

- [Use Agent Skills in VS Code](https://code.visualstudio.com/docs/copilot/customization/agent-skills)
- [About agent skills - GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
- [Extend Claude with skills - Claude Code Docs](https://code.claude.com/docs/en/skills)
- [Agent Skills - Cursor Docs](https://cursor.com/docs/skills)
