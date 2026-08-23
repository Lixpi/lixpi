# Agent Skill Organization

This document defines how Lixpi exposes project guidance to coding agents without copying policy into tool-specific configuration files.

## Design

Most authoritative Lixpi guidance lives under `documentation/`. Cross-workspace guidance may live in the umbrella repository when it applies to Lixpi and its sibling projects. A harness skill is a short discovery alias: its frontmatter states when the guidance applies, and its body points to the authoritative file. A prohibition that must be known before tool selection may be named in the skill description so discovery cannot hide it.

The project maintains matching aliases in these native harness locations as needed:

- `.github/skills/<name>/SKILL.md` for GitHub Copilot.
- `.claude/skills/<name>/SKILL.md` for Claude Code.
- `.cursor/skills/<name>/SKILL.md` for Cursor.
- `.agents/skills/<name>/SKILL.md` for Codex.

Some harnesses also recognize compatibility directories. Matching aliases intentionally have identical names, descriptions, and pointer bodies, so discovery order is not behaviorally significant when a tool scans more than one location.

## Required Human-Facing Interaction Skill

The canonical `talk-like-a-human` skill lives in the umbrella repository at `skills/talk-like-a-human/SKILL.md`. Every agent must resolve and read `$talk-like-a-human` through the active harness's skill discovery at the start of every turn before writing human-facing text. The rule covers answers, clarification questions, progress updates, review comments, documentation, tickets, reports, and final responses. It applies to every interaction, not only documentation work.

Lixpi exposes `talk-like-a-human` through matching pointer aliases in `.github/skills/`, `.claude/skills/`, `.cursor/skills/`, and `.agents/skills/`. The aliases do not copy the writing rules. They locate the umbrella repository without using developer-specific absolute paths, then point the harness to the canonical skill.

If the canonical skill cannot be resolved or read, the agent must stop immediately. It must not continue the task or produce a substantive response. Its only permitted response is a brief report that `talk-like-a-human` could not be resolved, followed by waiting for the user's instructions.

## Command Execution Rule

Agents must not run `npm`, `npx`, `pnpm`, or `pnpx` on the host. Agents must not install project dependencies or tooling on the host by any package manager.

Agents must not run project setup, package scripts, build scripts, docs builds, linters, formatters, test runners, framework CLIs, or repo scripts on the host. All project setup and all script execution must happen inside the appropriate Docker container, such as `docker exec <container> pnpm ...`, when the task's other permission and testing gates allow that command.

If the Dockerized command is not documented or the required container is unavailable, agents stop and ask instead of falling back to a host command.

## Why Aliases, Not Copied Instructions

- A single documentation source prevents policy drift.
- Short skill bodies preserve on-demand context loading.
- Native paths avoid depending on a harness supporting another product's compatibility path.
- Adding a skill does not require editing a central catalog that can become stale.

## Adding Or Updating Shared Guidance

For guidance that should be available in GitHub Copilot, Claude Code, and Cursor:

1. Create or update its authoritative document under `documentation/`.
2. Create the same skill directory name under `.github/skills/`, `.claude/skills/`, and `.cursor/skills/`.
3. Use identical YAML `name` and `description` values in all three aliases. The description must say both what the skill covers and the task signals that should load it.
4. Keep each `SKILL.md` body to a direct instruction to read and follow the documentation source of truth.
5. Do not add the skill to a manually maintained "available skills" table. The harness discovers new skill directories and uses their descriptions.

When the guidance must also be discovered by Codex, add the same alias under `.agents/skills/`. State repository-wide non-negotiable tool restrictions in `AGENTS.md` as well as the authoritative documentation.

For harness-specific behavior, keep the alias and its source of truth in the location appropriate to that harness unless the guidance is deliberately promoted to shared project documentation.

## Documentation Roots

Reusable project guidance belongs in the most relevant documentation area, such as `documentation/coding-style-guides/`, `documentation/documentation-style-guides/`, `documentation/testing/`, or `documentation/development-workflow/`. Cross-workspace guidance that deliberately applies to more than one repository may live in the umbrella repository, as `talk-like-a-human` does. Browse the native skills directories to see which guidance is currently exposed to each harness; this document deliberately does not maintain a general skill inventory.

## Basis For This Layout

This layout follows the tools' documented Agent Skills behavior:

- GitHub Copilot supports repository skills in `.github/skills`, `.agents/skills`, and `.claude/skills`, and loads relevant skill content progressively.
- Claude Code uses project skills in `.claude/skills` and selects them using their description.
- Cursor supports Agent Skills through its native `.cursor/skills` project path.

Because the common behavior is description-based discovery followed by on-demand loading of `SKILL.md`, the aliases should describe triggers clearly and defer durable detail to documentation.

## References

- [Use Agent Skills in VS Code](https://code.visualstudio.com/docs/copilot/customization/agent-skills)
- [About agent skills - GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
- [Extend Claude with skills - Claude Code Docs](https://code.claude.com/docs/en/skills)
- [Agent Skills - Cursor Docs](https://cursor.com/docs/skills)
