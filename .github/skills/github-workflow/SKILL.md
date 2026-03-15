---
name: github-workflow
description: 'Manage GitHub branches, commits, issues, and pull requests for Lixpi. Use when creating branches, making commits, opening PRs, updating issues, or any Git/GitHub workflow task.'
---

# GitHub Workflow

Lixpi uses a strict naming convention for branches, commits, and pull requests tied to GitHub issues.

## Branch Naming

Format: `LIX-<issue-id>/<description>`

- The `<issue-id>` is the GitHub issue number — fetch it via GitHub MCP tools.
- The `<description>` is a short kebab-case summary of the work.

Examples:
- `LIX-60/support-google-models`
- `LIX-142/fix-streaming-parser`
- `LIX-88/add-image-resize-controls`

## Commit Messages

Format: `LIX-<issue-id> # <description>`

The commit title must reference the issue ID followed by `#` and a human-readable description.

Examples:
- `LIX-60 # Add Google Gemini provider support`
- `LIX-142 # Fix markdown stream parser edge case`

## Pull Request Workflow

### 1. Create the PR

- **Title format**: `LIX-<issue-id> # <description>` (same as commit format).
- **Base branch**: `main` (unless instructed otherwise).
- **Assign the PR** to the current user.

### 2. Update the Issue

After the PR is opened:
1. Fetch the associated GitHub issue.
2. Append a link to the opened PR at the end of the issue description body.
3. Assign the issue to the current user (if not already assigned).

### 3. PR Description

Include:
- A summary of what changed and why.
- Reference the issue: `Closes #<issue-id>` or `Relates to #<issue-id>`.

## Step-by-Step: Full Feature Workflow

1. **Identify the issue** — Use GitHub MCP tools to read the issue and get its ID.
2. **Create the branch** — `git checkout -b LIX-<id>/<description>`.
3. **Implement the feature** — Make changes, commit with `LIX-<id> # <description>` format.
4. **Push the branch** — `git push -u origin LIX-<id>/<description>`.
5. **Open the PR** — Use GitHub MCP tools with the correct title format. Assign to current user.
6. **Update the issue** — Add the PR link to the issue description body.

## Tools

Use the GitHub MCP server tools for all GitHub operations:
- Reading/searching issues and PRs
- Creating branches and PRs
- Adding comments and updating issue descriptions
- Getting current user info for assignment
