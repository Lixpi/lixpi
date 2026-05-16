---
applyTo: '**'
description: 'MANDATORY: Always run read-only shell commands by wrapping them in Python via the Pylance MCP `pylanceRunCodeSnippet` tool, because the VS Code terminal integration cannot reliably read its own command output. NEVER use this for any write/mutating operation.'
---

# Terminal-Via-Pylance (ALWAYS ON)

## Why this exists

The VS Code Copilot terminal integration is unreliable at capturing the stdout/stderr of commands it runs. The `pylanceRunCodeSnippet` tool (from the Pylance MCP server, available by default) executes Python inline and returns its output reliably. Wrapping shell commands in `subprocess.run(...)` gives Copilot a deterministic way to read command output.

## The rule

For **every read-only shell command** you would otherwise run via `run_in_terminal`, instead invoke `mcp_pylance_mcp_s_pylanceRunCodeSnippet` with a Python snippet that runs the command via `subprocess.run` and prints its output.

This rule is **always on**. It applies in every conversation, every workspace, without exception, unless the user explicitly overrides it for a specific command.

## Hard prohibition — read-only only

You MUST NOT use `pylanceRunCodeSnippet` to execute any command that:

- Creates, modifies, moves, renames, or deletes files or directories
- Writes to stdin of another process that would mutate state
- Mutates git state (`commit`, `push`, `pull`, `merge`, `rebase`, `reset`, `checkout` of files, `stash`, `tag`, `branch -d`, etc.)
- Mutates package state (`npm install`, `pnpm add`, `pip install`, `brew install`, `apt`, etc.)
- Starts, stops, restarts, kills, or signals any process or container (`docker run/stop/rm`, `kill`, `pkill`, `systemctl`, `launchctl`, etc.)
- Mutates remote state (HTTP POST/PUT/PATCH/DELETE, database writes, cloud-provider CLIs that change resources, `gh pr create`, `gh issue comment`, etc.)
- Changes environment, permissions, or configuration (`chmod`, `chown`, `export` that persists, editing dotfiles)
- Has any side effect outside of reading

Any command in the above categories MUST be run via `run_in_terminal` (so the user sees it in their real terminal, with their environment, and so the action is auditable). If you are unsure whether a command is read-only, treat it as a write and use `run_in_terminal`.

## Allowed (read-only) examples

These are safe to wrap in Python:

- `ls`, `find`, `tree`, `stat`, `file`, `wc`, `du`, `df`
- `cat`, `head`, `tail`, `less` (non-interactive), `grep`, `rg`, `awk`, `sed -n` (no `-i`)
- `git status`, `git log`, `git diff` (no `--exit-code` side use), `git show`, `git branch` (no `-d`/`-D`), `git remote -v`, `git config --get`
- `pnpm ls`, `npm ls`, `pip list`, `pip show`, `which`, `command -v`, `type`
- `docker ps`, `docker logs` (without `-f` in a way that blocks), `docker inspect`, `docker images`
- `env`, `printenv`, `echo $VAR`, `uname`, `hostname`, `whoami`, `date`
- `curl` / `wget` ONLY for `GET` requests to non-mutating endpoints
- `node -e "console.log(...)"` for pure computation with no fs writes

## How to invoke

### Step 1 — load the deferred tool (MANDATORY)

`mcp_pylance_mcp_s_pylanceRunCodeSnippet` is a **deferred tool**. Calling it without loading it first will silently fail and the agent will fall back to ignoring the rule entirely.

Before every first use in a conversation, call `tool_search` with the query `"pylance run code snippet"` to load it:

```
tool_search({ query: "pylance run code snippet" })
```

Only after that call succeeds should you invoke `mcp_pylance_mcp_s_pylanceRunCodeSnippet`.

If `tool_search` returns no matching tool, the Pylance MCP server is not running — fall back to `run_in_terminal` and note that output may be unreliable.

### Step 2 — call the tool

Use `mcp_pylance_mcp_s_pylanceRunCodeSnippet` with a snippet shaped like this:

```python
import subprocess
r = subprocess.run(
    ["git", "status", "--short"],   # argv form — no shell injection
    capture_output=True,
    text=True,
    cwd="/Users/shallbee/Code/Lixpi-lists",
    timeout=30,
)
print("STDOUT:", r.stdout)
print("STDERR:", r.stderr)
print("RC:", r.returncode)
```

Conventions:

- Prefer the **argv list form** over `shell=True`. Only use `shell=True` for pipelines/globs you cannot easily express in argv, and even then never interpolate untrusted input.
- Always pass an explicit `cwd=` — do not rely on the Python kernel's working directory.
- Always set a `timeout=` (30s for fast queries, up to 300s for slow reads like `find /`).
- Always print `stdout`, `stderr`, and `returncode` so the output is fully visible.
- Keep snippets short. One command per snippet is ideal; chain only when the next read depends on the previous read's result.

## When the terminal is still required for reads

Use `run_in_terminal` (not Pylance) even for reads when:

- The command needs the user's interactive TTY (e.g. `gh auth status` prompting login, `ssh` to a host)
- The command must run inside a specific shell session the user already has open (env vars, activated venvs, `nvm use`'d node)
- The command is part of a long-running watcher/server the user wants to observe live
- The command must execute inside a Docker container via `docker exec` where the user expects to see streaming output

For these cases, run via terminal and accept the output-reading limitation.

## Self-check before every shell action

Before running ANY shell command, ask:

1. Is this read-only? → If no, use `run_in_terminal`. Stop.
2. Does it need an interactive TTY or a specific live shell? → If yes, use `run_in_terminal`. Stop.
3. Otherwise → wrap it in `pylanceRunCodeSnippet` per the template above.

This three-step check is mandatory. Do not skip it because a command "seems fine".
