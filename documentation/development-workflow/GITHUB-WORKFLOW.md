# GitHub Workflow

This document is the source of truth for Git and GitHub work in the Lixpi repository.

**Repository**: `Lixpi/lixpi` (`https://github.com/Lixpi/lixpi.git`)

## Mandatory Execution Context

Never run any command from this workflow in the sandbox.

All Git, GitHub, branch, commit, push, pull request, issue, and workflow-related commands in this document require unsandboxed execution. This includes `git`, `gh`, GitHub helper tools, shell snippets that wrap them, and any command used to inspect or mutate repository or GitHub state while following this workflow.

If an agent needs to run one of these commands, it must request unsandboxed execution and run it in the user's host environment. Do not attempt a sandboxed run first.

## GitHub Authentication

Assume GitHub authentication is already configured in the user's host environment. Do not run `gh auth status`, login probes, token checks, or other authentication preflights before normal GitHub work.

Run the actual `gh` command required by the workflow. If that command fails because of authentication, missing credentials, keychain access, SSO authorization, or token scope, stop and report the failing command and error to the user. Do not attempt to log in, refresh credentials, or work around authentication state.

## Branch Naming

Format: `LIX-<issue-id>/<description>`

- `<issue-id>` is the GitHub issue number. Fetch or verify it before creating a branch.
- `<description>` is a short kebab-case summary of the work.

Examples:

- `LIX-60/support-google-models`
- `LIX-142/fix-streaming-parser`
- `LIX-88/add-image-resize-controls`

## Commit Messages

Format: `LIX-<issue-id> # <description>`

Examples:

- `LIX-60 # Add Google Gemini provider support`
- `LIX-142 # Fix markdown stream parser edge case`

Do not add coding-agent `Co-authored-by:` trailers or other agent attribution to commits or pull requests unless the user expressly requests it.

## Pull Request Workflow

### Create The PR

- Use title format `LIX-<issue-id> # <description>`.
- Target `develop` unless instructed otherwise.
- Assign the pull request to the current user.
- Never open draft pull requests. Pull requests are opened ready for review.

### Update The Issue

After opening a pull request:

1. Fetch the associated issue.
2. Append a link to the pull request at the end of the issue description body.
3. Assign the issue to the current user if it is not already assigned.

### Write The Description

Include:

- A concise summary of what changed and why.
- `Closes #<issue-id>` or `Relates to #<issue-id>`, whichever is accurate.

## Full Feature Workflow

1. Identify and read the GitHub issue.
2. Create the feature branch from `develop`.
3. Stage only files relevant to the work. Do not use `git add -A` or `git add .`.
4. Verify staged paths with `git diff --cached --name-only`.
5. Commit with the required `LIX-<issue-id> # <description>` title.
6. Push the feature branch.
7. Open and assign the pull request.
8. Update and assign the linked issue.

## After Merge

1. Switch to `develop`.
2. Pull the merged changes.

## Tools

- Use local Git commands for status, staging, commits, checkouts, fetches, and pushes, and run them unsandboxed.
- Never run `gh` commands in the sandbox. GitHub CLI operations require the user's host environment, network access, credential helpers, and browser or keychain integration. Always run `gh` with unsandboxed execution.
- Do not run GitHub authentication preflight checks. Use required workflow commands directly and surface authentication failures only if they occur.
- Use available GitHub integration tools for branches, pull requests, issue reads, issue updates, and assignment.
- When sending Markdown through an API, provide real line breaks rather than literal `\n` text so GitHub renders the body correctly.
