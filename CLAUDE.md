# Claude Instructions

Follow `AGENTS.md` for the full project rules.

## Command Execution

Never run `npm`, `npx`, `pnpm`, or `pnpx` on the host.

Never install project dependencies or tooling on the host by any package manager.

Never run project setup, package scripts, build scripts, docs builds, linters, formatters, test runners, framework CLIs, or repo scripts on the host.

All project setup and all script execution must happen inside the appropriate Docker container, such as `docker exec <container> pnpm ...`, when the task's other permission and testing gates allow that command.

If the Dockerized command is not documented or the required container is unavailable, stop and ask instead of falling back to a host command.

## Updating or writing documentation or any md files

You must NEVER truncate text at 80 chars or whatever length, lines must never be broken like in ancient technical documentaion.
