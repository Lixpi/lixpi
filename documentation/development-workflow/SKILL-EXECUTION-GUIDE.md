---
title: Skill Execution Guide
description: Skills that run code run it inside the lixpi-utils container, never on the host. Covers the rule, the commands, and how to add a script to a skill.
---

# Skill Execution Guide

Every skill under `${LIXPI_REPOSITORY_PATH}/skills/` that has to execute code executes it inside the shared `lixpi-utils` container. Nothing a skill ships is ever run on the host.

This is the same rule the rest of the repository already follows. TypeScript tests run only through `lixpi-typescript-test-runner` (see [`TYPESCRIPT.md`](../code-quality/testing/TYPESCRIPT.md)), formatting and linting run only through `lixpi-typescript-quality-runner`, and application code runs only inside its own service container. Skill scripts get the same treatment for the same reasons.

## The rule

**A skill script runs through `lixpi-utils` or it does not run.**

There is no host toolchain to fall back on. A script run on the host picks up whatever Node the developer's machine happens to have, which is exactly the difference that makes a skill work for one person and fail for the next. It is also why [Agent Skill Organization](AGENT-SKILLS.md) bans host `pnpm` outright.

Prohibited, without exception:

- Running `node`, `pnpm`, `npm`, `npx`, `pnpx`, or `python` against a file in `${LIXPI_REPOSITORY_PATH}/skills/` on the host.
- Installing a runtime or a package on the host to make a skill work.
- Adding a skill script that expects a host toolchain rather than this container.
- Pasting a skill script's body into another interpreter to sidestep the container.

If a skill needs something the container doesn't have, add it to `${LIXPI_REPOSITORY_PATH}/dev-tools/lixpi-utils/Dockerfile` and rebuild. Do not work around it locally.

## Running a skill script

Read `LIXPI_REPOSITORY_PATH` from the consuming repository's `env.lixpi` and use its absolute value in these commands:

```bash
docker compose --env-file "${LIXPI_REPOSITORY_PATH}/env.lixpi" \
    -f "${LIXPI_REPOSITORY_PATH}/docker-compose.lixpi-utils.yml" run --rm -T lixpi-utils \
    <skill-name> "${LIXPI_REPOSITORY_PATH}/skills/<skill-name>/scripts/<script-name>" [args...]
```

`<skill-name>` selects a directory under `${LIXPI_REPOSITORY_PATH}/skills/`. The script argument must be an absolute path inside that directory. The runner maps it to the container's skill mount. For example:

```bash
docker compose --env-file "${LIXPI_REPOSITORY_PATH}/env.lixpi" \
    -f "${LIXPI_REPOSITORY_PATH}/docker-compose.lixpi-utils.yml" run --rm -T lixpi-utils \
    fetch-byteplus-documentation "${LIXPI_REPOSITORY_PATH}/skills/fetch-byteplus-documentation/scripts/fetch-byteplus-doc.ts" ModelArk/2377608
```

`--rm` removes the container when it exits, and `-T` disables TTY allocation so the command works non-interactively. Drop `-T` only when a script genuinely needs an interactive terminal.

Each call is a one-shot `docker compose run`, never `up` or `exec`. A fresh container per invocation always reflects the current compose file, and Compose names each run uniquely, so two skills running at once never collide. The service deliberately has no `container_name` to keep that true.

Build the image once, and again after any change to the Dockerfile:

```bash
docker compose --env-file "${LIXPI_REPOSITORY_PATH}/env.lixpi" \
    -f "${LIXPI_REPOSITORY_PATH}/docker-compose.lixpi-utils.yml" build lixpi-utils
```

Editing a skill script or `${LIXPI_REPOSITORY_PATH}/dev-tools/lixpi-utils/run-skill.sh` needs no rebuild. Both are bind-mounted, so the next run picks up the change.

## What the container gives a script

| | |
|---|---|
| Working directory | The skill's own directory, so relative paths resolve against the skill. |
| `${LIXPI_REPOSITORY_PATH}/skills/` | Bind-mounted at `/skills`, writable. A script may write output next to itself and the file lands on the host. |
| Runtime | Node 24 (Alpine image) plus `pnpm`. Dispatch is by extension: `.ts`/`.mjs`/`.js` run under `node`, `.sh` under `sh`. |
| Network | Outbound HTTPS, with `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` passed through from the host if set. |
| Signals | `tini` is PID 1, so Ctrl-C stops a long-running script instead of detaching it. |

The image includes the Clack and Chalk packages used by the Dockerized `${LIXPI_REPOSITORY_PATH}/setup-skills.sh` prompt UI. Those packages live under the utility setup runtime and are not a dependency surface for skill scripts. A skill that needs a package installs it into its own directory against the shared `lixpi-utils-pnpm-store` volume, which keeps one skill's dependencies out of every other skill's runtime. Prefer the Node standard library: every skill in the tree today needs nothing else.

## Adding a script to a skill

1. Put it under `${LIXPI_REPOSITORY_PATH}/skills/<skill-name>/scripts/`.
2. Write it in TypeScript as a `.ts` file. Node 24 strips types natively, so it runs directly: no `tsc`, no `tsconfig.json`, and no build step. Keep to erasable syntax (no enums, no namespaces, no parameter properties, and `import type` for type-only imports), since annotations are erased at load and never type-checked.
3. Write a real error message and a non-zero exit on failure. The caller is usually an agent, and it can only act on what the script prints.
4. Document the exact `docker compose ... run --rm -T lixpi-utils ...` invocation in `${LIXPI_REPOSITORY_PATH}/skills/<skill-name>/SKILL.md`, with the flags spelled out and the script path rooted at `${LIXPI_REPOSITORY_PATH}`. An agent copies that line verbatim.
5. Never document or suggest a host fallback, even as a convenience.

## When a run fails

| Symptom | Cause and fix |
|---|---|
| `No skill directory: ${LIXPI_REPOSITORY_PATH}/skills/<name>` | Typo in the skill name. The entrypoint lists what exists. |
| `No script: ${LIXPI_REPOSITORY_PATH}/skills/<name>/<path>` | The script does not exist at the configured path. The entrypoint lists the scripts it found. |
| `Script path must start with ${LIXPI_REPOSITORY_PATH}/skills/<name>/` | Supply the full script path using the configured repository variable. |
| `Don't know how to run <script>` | Extension isn't `.ts`, `.mjs`, `.js`, or `.sh`. Rename it or add a dispatch case in `${LIXPI_REPOSITORY_PATH}/dev-tools/lixpi-utils/run-skill.sh`. |
| A Dockerfile change appears to have no effect | Rebuild. `${LIXPI_REPOSITORY_PATH}/skills/` and the runner entrypoint are bind-mounted. |
| Network failures inside the container | Check the host's proxy variables. The compose file forwards them, but only if the host exports them. |

## Running these skills from another repository

Another repository can install the skills in `${LIXPI_REPOSITORY_PATH}/skills/` as symlinks into that project through the interactive [`setup-skills.sh`](../../setup-skills.sh) installer. Use the same commands above with the main checkout's configured path. [Agent Skill Organization](AGENT-SKILLS.md) covers the installer and the direction of the dependency.
