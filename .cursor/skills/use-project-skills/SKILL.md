---
name: use-project-skills
description: >-
  Directs the agent to discover and use project skills stored in .github/skills/.
  ALWAYS read this skill first before any task. Use on every request.
---

# Project Skills

This project stores its skills in `.github/skills/`, NOT in `.cursor/skills/`.

## IMPORTANT — Read Before Every Task

Before starting any task, scan `.github/skills/` for relevant skills:

1. List all directories under `.github/skills/`.
2. Read the `SKILL.md` in each directory whose name relates to the current task.
3. Follow the instructions in those skills.

## Available Skills

| Skill | Directory | When to Use |
|-------|-----------|-------------|
| **coding-style** | `.github/skills/coding-style/` | Writing or reviewing code |
| **documentation-style** | `.github/skills/documentation-style/` | Writing or updating documentation |
| **github-workflow** | `.github/skills/github-workflow/` | CI/CD, GitHub Actions, workflows |
| **implementation-plans** | `.github/skills/implementation-plans/` | Writing implementation plans, technical proposals, design docs, RFCs, feature specs, deep research, or "tickets" |
| **project-navigation** | `.github/skills/project-navigation/` | Finding files, understanding project structure |
| **testing** | `.github/skills/testing/` | Writing or running tests |

If a task touches multiple areas, read multiple skills. When in doubt, read them all — they are short.

**Git commits and pull requests:** Read `.github/skills/github-workflow/SKILL.md` and follow it in full. **Never** add `Co-authored-by:` lines or any PR co-authorship for coding agents (Cursor, etc.); attribution stays human-only per that skill.
