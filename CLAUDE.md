# Claude Instructions

Follow `AGENTS.md` for the full project rules.

## Command Execution

Never run `npm`, `npx`, `pnpm`, or `pnpx` on the host.

Never install project dependencies or tooling on the host by any package manager.

Never run project setup, package scripts, build scripts, docs builds, linters, formatters, test runners, framework CLIs, or repo scripts on the host.

All project setup and all script execution must happen inside the appropriate Docker container, such as `docker exec <container> pnpm ...`, when the task's other permission and testing gates allow that command.

If the Dockerized command is not documented or the required container is unavailable, stop and ask instead of falling back to a host command.

## File Deletion

Never delete repository files silently.

If cleanup, reverting accidental edits, restoring a diff, replacing a file, moving a file, renaming a file, or "undoing my changes" would delete repository files, stop and ask the user to confirm deletion of the exact file path(s) before applying that change. This includes delete-file patches, shell commands that remove files, and any edit that would make `git status` show deleted files.

After the user confirms, delete only the confirmed path(s). If the user does not confirm, keep the files and report them as cleanup candidates. A direct user request to delete exact path(s) in the current thread counts as confirmation for those path(s). When undoing your own changes, restore previous file contents instead of deleting files unless the user confirms deletion.

## Updating or writing documentation or any md files

You must NEVER truncate text at 80 chars or whatever length, lines must never be broken like in ancient technical documentaion.

## Cross-repo metering contract

The usage-metering wire contract — the `metrics.*` subjects in `packages/lixpi/constants/nats-subjects.json` (`METRICS_SUBJECTS`) and the check/confirm/balance request/response shapes in `services/api/src/metrics/contracts.ts` (used by `metrics-client.ts`) — is served by a hosted metering backend in a separate repository. Do not change this contract surface without explicit user allowance. If the user does allow a change, it must be mirrored in that backend in the same change, and remind the user that both sides must be updated and released together — a one-sided change silently breaks the wire.
