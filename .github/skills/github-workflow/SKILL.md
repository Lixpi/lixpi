---
name: github-workflow
description: 'Manage GitHub branches, commits, issues, and pull requests for Lixpi. Use when creating branches, making commits, opening PRs, updating issues, or any Git/GitHub workflow task.'
---

# GitHub Workflow

**Repository**: `Lixpi/lixpi` (https://github.com/Lixpi/lixpi.git)

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
2. **Create the branch from `main`** — Use `mcp_github_create_branch` with `from_branch: "main"`, then `git fetch origin && git checkout <branch-name>` locally.
3. **Stage, commit, and push** — Use local Git CLI:
   - Stage only the relevant files: `git add <file1> <file2> ...` — **never** use `git add -A` or `git add .`.
   - Verify staged files: `git diff --cached --name-only`.
   - Commit: `git commit -m "LIX-<id> # <description>"`.
   - Push: `git push origin <branch-name>`.
4. **Open the PR** — Use `mcp_github_create_pull_request` with the correct title format. Assign to current user.
5. **Update the issue** — Add the PR link to the issue description body.

## After PR is Merged

1. Switch to main: `git checkout main`
2. Pull the merged changes: `git pull`

## Tools

Use **local Git CLI** for all file operations (staging, committing, pushing). Use **GitHub MCP tools** for GitHub API operations (branches, PRs, issues).

### Local Git CLI — for committing and pushing code

- `git fetch origin` — Fetch remote branches
- `git checkout <branch>` — Switch to a branch
- `git add <file1> <file2> ...` — Stage specific files (**never** `git add -A` or `git add .`)
- `git diff --cached --name-only` — Verify staged files before committing
- `git commit -m "LIX-<id> # <description>"` — Commit with the correct message format
- `git push origin <branch>` — Push to remote

### GitHub MCP tools — for GitHub API operations

- `mcp_github_get_me` — Get current user for assignment
- `mcp_github_create_branch` — Create branches (always from `main`)
- `mcp_github_create_pull_request` — Open PRs
- `mcp_github_issue_write` — Create and update issues
- `mcp_github_issue_read` — Read issue details
- `mcp_github_update_pull_request` — Update PR metadata

## Markdown Formatting in API Calls

When passing markdown content (issue bodies, PR descriptions) to GitHub MCP tools, always use **real newlines** in the string — never literal `\n` escape sequences. The API expects actual line breaks, not escaped characters. Passing `\n` literally results in broken rendering on GitHub.
