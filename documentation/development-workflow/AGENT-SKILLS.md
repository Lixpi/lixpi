# Agent Skill Organization

This document defines how Lixpi exposes project guidance to coding agents without copying policy into tool-specific configuration files.

## Design

Authoritative guidance lives under `documentation/`. A harness skill is a short discovery alias: its frontmatter states when the guidance applies, and its body points to a specific authoritative documentation file. A prohibition that must be known before tool selection may be named in the skill description so discovery cannot hide it.

The project maintains matching aliases in these native harness locations as needed:

- `.github/skills/<name>/SKILL.md` for GitHub Copilot.
- `.claude/skills/<name>/SKILL.md` for Claude Code.
- `.cursor/skills/<name>/SKILL.md` for Cursor.
- `.agents/skills/<name>/SKILL.md` for Codex.

Some harnesses also recognize compatibility directories. Matching aliases intentionally have identical names, descriptions, and pointer bodies, so discovery order is not behaviorally significant when a tool scans more than one location.

## Command Execution Rule

Agents must not run `npm`, `npx`, `pnpm`, or `pnpx` on the host. Agents must not install project dependencies or tooling on the host by any package manager.

Agents must not run project setup, package scripts, build scripts, docs builds, linters, formatters, test runners, framework CLIs, or repo scripts on the host. All project setup and all script execution must happen inside the appropriate Docker container, such as `docker exec <container> pnpm ...`, when the task's other permission and testing gates allow that command.

If the Dockerized command is not documented or the required container is unavailable, agents stop and ask instead of falling back to a host command.

## File Deletion Permission Rule

Agents must not delete repository files silently.

If cleanup, reverting accidental edits, restoring a diff, replacing a file, moving a file, renaming a file, or "undoing my changes" would delete repository files, agents stop and ask the user to confirm deletion of the exact file path(s) before applying that change. This includes delete-file patches, shell commands that remove files, and any edit that would make `git status` show deleted files.

After the user confirms, agents delete only the confirmed path(s). If the user does not confirm, agents keep the files and report them as cleanup candidates. A direct user request to delete exact path(s) in the current thread counts as confirmation for those path(s). When undoing agent-created changes, agents restore previous file contents instead of deleting files unless the user confirms deletion.

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

Reusable project guidance belongs in the most relevant documentation area, such as `documentation/coding-style-guides/`, `documentation/documentation-style-guides/`, `documentation/testing/`, or `documentation/development-workflow/`. Browse the native skills directories to see which guidance is currently exposed to each harness; this document deliberately does not maintain a skill inventory.

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
