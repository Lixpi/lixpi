---
name: claude-sugbagents
description: Delegate bounded Lixpi work to the locally authenticated Claude Code CLI, retrieve its findings, and resume the same Claude session for follow-ups.
---

# Delegate to Claude Code

**Use Claude subscription credits first.** When both providers can handle delegated work, give the first eligible assignment to Claude Code whenever its subscription has capacity. Balance subsequent delegated token usage between Claude Code and Codex, and prefer Claude when usage is comparable. If Claude is unavailable or its subscription window is exhausted, route work to Codex and follow the reset instructions below.

Use Claude Code as an external worker when the task authorizes delegation. Codex owns task assignment, integration, and verification. Give Claude one objective, completion criteria, relevant decisions, permitted paths and tools, and the evidence you expect back. Start a fresh session per assignment and give each mutable artifact one owner.

## Run with the local subscription

Run the installed host `claude` binary outside the Codex sandbox. In Codex, call `exec_command` with `sandbox_permissions: "require_escalated"`, a justification that names the delegated task and the need for existing Claude authentication, and `workdir` set to the checkout handling the task. Use the signed-in user's normal environment so Claude can resolve its own subscription credentials. Keep Claude's tool permissions enabled and never use `--dangerously-skip-permissions`. Never extract credentials or copy them into Docker, prompts, or logs.

The unsandboxed host launch is required for this workflow and needs explicit authorization if the active instructions require Docker-only execution. The authorization applies to launching Claude itself. Repository commands, builds, linters, and tests still follow the repository's Docker rules. If host execution or escalation is denied, report the blocker. If authentication fails, ask the user to repair it through Claude Code's own sign-in flow. Use `claude auth status` in the same launch context when troubleshooting and report only the authentication outcome.

## Load the same repository instructions

Launch from the checkout root so Claude loads the repository's `CLAUDE.md`, which imports `AGENTS.md`. Keep normal project discovery enabled. The existing `.claude/skills/` links expose some skills natively. The configured repository skill catalog covers the rest.

Put this bootstrap in the first prompt, before the assignment:

> Read this checkout's AGENTS.md and the applicable nested instructions. Read env.lixpi as configuration data and resolve LIXPI_REPOSITORY_PATH, CODING_AGENTS_TEST_EXECUTION_MODE, and CODING_AGENTS_TEST_LINTER_MODE. Before writing human-facing text, read the configured skills/talk-like-a-human/SKILL.md and follow its failure rule. Use the configured skills directory as the canonical catalog. Read the relevant SKILL.md files directly, including ones without .claude/skills links. Follow code-quality for implementation and the repository's Docker and verification rules. If a required instruction, skill, or tool is unavailable, report the exact blocker. Do not delegate further unless assigned.

Identify any task-specific skill by name and include applicable instructions that Codex received outside the checkout. Ask Claude to return the paths of the instructions and task-specific skills it actually applied. For a repository smoke check, ask it to report the configured test and linter modes and demonstrate that it resolved a canonical skill without a Claude link, such as `talk-like-a-human`.

## Start and resume an assignment

Pass `--effort low` by default on every launch and resume. For genuinely complex assignments that need deeper reasoning, use `--effort medium` or `--effort high` as needed. Never set Claude Code effort above `high`.

For a read-only assignment, set `CLAUDE_TASK_PROMPT` to the bootstrap and task in the same invocation. Pass it as a single safely quoted argument. The following command limits the built-in tools to file discovery and reads and excludes MCP tools:

```sh
claude --print --effort low --output-format json --permission-mode dontAsk --tools 'Read,Glob,Grep' --disallowedTools 'mcp__*' -- "$CLAUDE_TASK_PROMPT"
```

For an authorized edit, add only the necessary edit tools and name the owned files in the prompt. When the assignment needs Docker commands, Codex can run the permitted commands separately and pass the results back. Review the active Claude settings and hooks before relying on tool restrictions for isolation.

Capture stdout and check the exit status. Parse a top-level result object directly. If the CLI emits an event array, take the final event whose `type` is `result`. Check `is_error`, then keep the `session_id` and `result` with the assignment. Return those fields to Codex without dumping the full event array, which can contain file contents and tool traces. Keep session persistence enabled. Resume the exact session from the same checkout with the same approved tool scope. Set `CLAUDE_SESSION_ID` to the captured ID and `CLAUDE_FOLLOWUP_PROMPT` to the next instruction:

```sh
claude --print --effort low --output-format json --permission-mode dontAsk --tools 'Read,Glob,Grep' --disallowedTools 'mcp__*' --resume "$CLAUDE_SESSION_ID" -- "$CLAUDE_FOLLOWUP_PROMPT"
```

Wait for a turn to finish before resuming that session. Use explicit IDs when multiple assignments share a checkout. Resume only sessions created for this work or specifically identified and authorized by the user.

## Subscription limits and handoff

Before every Claude launch or resume, check the latest known subscription usage for the signed-in account. Use Claude Code's `/usage` when available or the existing CLI usage signals. Keep any known blocked windows and reset times in the lead's routing state and share them with anyone dispatching workers. If live usage is unavailable and there is no known block, use the first real assignment to learn the current status. Avoid sending a model prompt just to probe quota.

Inspect the CLI's rate-limit events, final result, and stderr. The installed CLI can emit `rate_limit_event` records with a status and `resetsAt` timestamp. A rejected subscription window or an explicit subscription-limit message blocks further launches and resumes on that account until the reported reset. If multiple applicable windows are exhausted, wait until all have reset. If the reset time is missing, keep routing to Codex until a supported usage check confirms capacity. Treat an ambiguous rate-limit error as a reason to hand off the affected work and verify quota before routing back. A transient API throttle, a context-window limit, and per-turn token counts establish different conditions from subscription exhaustion. During a known block, leave Claude idle and avoid retries, replacement Claude sessions, or paid extra usage.

Give assignments that may span several turns a checkpoint at each natural stopping point. Ask Claude to return completed work, pending steps, changed files, decisions, evidence, and verification status in each checkpoint. Keep the latest checkpoint and session ID with the assignment so the lead can recover the context immediately if a later turn fails.

If Claude hits the limit, recover its latest checkpoint and any partial output already captured. If Claude can still return a handoff within the current invocation, collect it. If the limit prevents a response, reconstruct the handoff from the authorized local transcript, captured output, and current checkout. Skip a new Claude turn for the handoff. End the affected worker process if it is still running, confirm it has exited, and retain its session record for reference. Leave other sessions alone.

Assign unfinished work to an eligible native Codex subagent immediately, with the recovered context, original constraints, exact remaining work, and file ownership. The lead takes over directly if a replacement worker is unavailable. Verify the checkout before continuing from partial edits. Once the blocked windows reset, Claude can take new work under the normal routing rules. The replacement keeps ownership of any assignment it took over.

## Bring Claude's context into Codex

Use the result as the worker's report. For more context, resume the session and ask Claude for a focused handoff covering the instructions applied, files read or changed, evidence, decisions, open questions, and checks performed. Pass new decisions or feedback on the next turn using the same session ID. For exact visible exchanges, inspect the authorized session's local JSONL transcript using the documented storage location and read only the entries needed for the task. Codex can access visible results and transcript entries. Claude's private reasoning and internal context state have no supported export through this workflow.

Verify returned claims against the checkout and use the repository's allowed verification commands before integrating changes.

[Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference) · [Programmatic usage and session resumption](https://code.claude.com/docs/en/headless)
