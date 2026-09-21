---
name: github-workflow
description: 'Follow the active repository Git and GitHub workflow when inspecting repository state, creating branches, staging or committing changes, pushing work, opening pull requests, or updating linked issues.'
---

# GitHub Workflow

Use this workflow in any repository whose root `env.lixpi` defines its GitHub repository, ticket key, source branch, and target branch.

## Repository Configuration

Before any other workflow operation:

1. Resolve the current repository root.
2. Read `<repository-root>/env.lixpi` as configuration data. Do not source or execute it.
3. Require these assignments:

```dotenv
GITHUB_REPOSITORY=owner/repository
TICKET_KEY=PROJECT
DEFAULT_TARGET_BRANCH=main
DEFAULT_SOURCE_BRANCH=main
```

`GITHUB_REPOSITORY` is the GitHub `owner/repository` path. Use it explicitly for every GitHub CLI or integration operation so work cannot fall through to a different repository from ambient configuration.

`TICKET_KEY` is the prefix placed before the GitHub issue number in branch names, commit messages, and pull request titles. It may contain internal hyphens, such as `TEAM-API`; append one hyphen and the numeric issue ID when constructing a ticket identifier.

`DEFAULT_SOURCE_BRANCH` is the branch from which feature branches are created. `DEFAULT_TARGET_BRANCH` is the pull request base and the branch updated after a merge. A direct user instruction to use a different source or target branch takes precedence for that operation.

If `env.lixpi` is missing, any required value is empty, or any assignment is malformed, stop and report the configuration problem. Do not infer values from the directory name, Git remote, issue title, repository defaults, or another repository.

## Mandatory Execution Context

Never run any command from this workflow in the sandbox.

All Git, GitHub, branch, commit, push, pull request, issue, and workflow-related commands in this skill require unsandboxed execution. This includes `git`, `gh`, GitHub helper tools, shell snippets that wrap them, and any command used to inspect or mutate repository or GitHub state while following this workflow.

If an agent needs to run one of these commands, it must request unsandboxed execution and run it in the user's host environment. Do not attempt a sandboxed run first.

## GitHub Authentication

Assume GitHub authentication is already configured in the user's host environment. Do not run `gh auth status`, login probes, token checks, or other authentication preflights before normal GitHub work.

Run the actual `gh` command required by the workflow. If that command fails because of authentication, missing credentials, keychain access, SSO authorization, or token scope, stop and report the failing command and error to the user. Do not attempt to log in, refresh credentials, or work around authentication state.

## Branch Naming

Format: `<ticket-key>-<issue-id>/<description>`

- `<ticket-key>` is the configured `TICKET_KEY`.
- `<issue-id>` is the GitHub issue number. Fetch or verify it in the configured `GITHUB_REPOSITORY` before creating a branch.
- `<description>` is a short kebab-case summary of the work.

## Commit Messages

Format: `<ticket-key>-<issue-id> # <description>`

Do not add coding-agent `Co-authored-by:` trailers or other agent attribution to commits or pull requests unless the user expressly requests it.

## Pull Request Workflow

### Fetch The Latest Source Branch

Immediately before opening a pull request, fetch the latest effective source branch from the configured repository's GitHub remote. The effective source branch is `DEFAULT_SOURCE_BRANCH` unless the user instructed you to use another one. This fetch is mandatory even if the source branch was fetched earlier in the workflow. Do not open the pull request if the fetch fails.

After fetching, inspect the feature branch against the updated remote source branch. Fetching does not authorize an automatic merge or rebase. If the branches need reconciliation and the user has not already chosen how to do it, stop and ask whether to merge, rebase, or leave the feature branch unchanged.

### Create The PR

- Do not run the pull-request creation command until the required source-branch fetch has succeeded.
- Use title format `<ticket-key>-<issue-id> # <description>`.
- Target the configured `DEFAULT_TARGET_BRANCH` unless instructed otherwise.
- Assign the pull request to the current user.
- Never open draft pull requests. Pull requests are opened ready for review.

### Update The Issue

After opening a pull request:

1. Fetch the associated issue from the configured GitHub repository.
2. Append a link to the pull request at the end of the issue description body.
3. Assign the issue to the current user if it is not already assigned.

### Write The Description

Include:

- A concise summary of what changed and why.
- `Closes #<issue-id>` or `Relates to #<issue-id>`, whichever is accurate.

## Full Feature Workflow

1. Read `env.lixpi` and resolve the repository, ticket key, source branch, and target branch.
2. Identify and read the GitHub issue in the configured repository.
3. Create the feature branch from `DEFAULT_SOURCE_BRANCH` unless instructed otherwise.
4. Stage only files relevant to the work. Do not use `git add -A` or `git add .`.
5. Verify staged paths with `git diff --cached --name-only`.
6. Commit with the required `<ticket-key>-<issue-id> # <description>` title.
7. Push the feature branch.
8. Fetch the latest effective source branch from the configured repository's GitHub remote and inspect the feature branch against it.
9. Resolve any required merge or rebase decision with the user, then repeat the source-branch fetch if the feature branch changes.
10. Open and assign the pull request in the configured repository only after the source-branch fetch succeeds.
11. Update and assign the linked issue.

## After Merge

1. Switch to `DEFAULT_TARGET_BRANCH` unless instructed otherwise.
2. Pull the merged changes.

## Tools

- Run local Git commands from the resolved repository root and outside the sandbox.
- Pass the configured `GITHUB_REPOSITORY` explicitly to every `gh` command or GitHub integration call that accepts a repository.
- Never run `gh` commands in the sandbox. GitHub CLI operations require the user's host environment, network access, credential helpers, and browser or keychain integration. Always run `gh` with unsandboxed execution.
- Do not run GitHub authentication preflight checks. Use required workflow commands directly and surface authentication failures only if they occur.
- Use available GitHub integration tools for branches, pull requests, issue reads, issue updates, and assignment.
- When sending Markdown through an API, provide real line breaks rather than literal `\n` text so GitHub renders the body correctly.
