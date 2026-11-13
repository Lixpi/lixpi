# Dev console

`./run.sh` is the one entry point for local development in every Lixpi repository. It opens a menu that runs inside Docker, so the host needs nothing but Docker and every workflow shares the same terminal UI. This directory holds the reusable engine. Each repository, including this one, only supplies its own menu and its own scripts.

## Using it from a repository

Every repository has the same layout, so a developer finds things in the same place everywhere:

| Path | Purpose |
|---|---|
| `run.sh` | Thin launcher. It finds the Lixpi checkout from `env.lixpi`, or asks on a first run, and calls `run-console.sh` here with its own root |
| `dev-tools/dev-console/console.config.json` | The repository's menu |
| `dev-tools/dev-console/actions/` | The repository's own scripts, named by `local:<name>` |
| `infrastructure/docker/` | All Compose files |

`ai-experiments`, `lixpi-billing` and `company-website` use it this way. Nothing here names them, and they contain no console code.

## Config format

`console.config.json` has a `title` and a list of `actions`, shown in order with **Exit** added at the end. The console opens on the first action.

| Action field | Purpose |
|---|---|
| `id`, `label`, `hint` | How the menu identifies and shows the action |
| `script` | `shared:<name>` runs `actions/<name>.sh` from this directory, and `local:<name>` runs the repository's own |
| `params` | Fixed values for the script |
| `returnToMenu` | Comes back to the menu after the script finishes, instead of ending the console |
| `envFile` | An environment file every run uses, instead of asking |
| `steps` | What to ask before running, in order |

| Step type | What it asks |
|---|---|
| `env-file` | Picks one of the repository's `.env.*` files, leaving out `.env.example` |
| `choices` | One page with radio rows from `options` above an optional service tree from `services` |
| `confirm` | A yes or no `message` that defaults to No |
| `docker-prune` | The prune tree with measured disk usage, then a confirmation |
| `service-commands` | Asks the action's script for its catalog, then offers the commands it reports |

An option with `"reported": true` depends on something only the host can see, such as what a Docker volume holds. Before that step, the console calls the action's script with `LIXPI_CONSOLE_QUERY=catalog`, the same round trip a `service-commands` step makes, and the script answers with one line of JSON such as `{"options":[{"name":"regenerate-certificate","available":false,"blockedReason":"..."}]}`. A row reported as unavailable stays on its first choice and shows the reason in place of its hint. If the script reports nothing for a row, the console warns and returns to the menu instead of guessing.

`"services": true` adds the service tree to a `choices` step. The tree, the stack file and the base profile all come from the repository's `infrastructure/docker` directory, described in [Docker layout](#docker-layout), so a config never lists services. The step passes `compose-file` and `profile` on to the script.

A script runs from the repository root. It receives the selected services or prune targets as arguments, and the rest as environment variables: `LIXPI_CONSOLE_WORKSPACE`, `LIXPI_CONSOLE_ENV_FILE` as an absolute path, and `LIXPI_CONSOLE_OPTION_<NAME>` for each param and radio row. `LIXPI_REPOSITORY_PATH` is set too.

`shared:start-services` starts the selected services from `compose-file` and `profile`, which the service tree supplies, and the optional params `up-flags` as a comma-separated list and `started-url`. It reads the radio rows `rebuild` and `detach`. **Run** defaults to **Foreground**, which keeps the console attached to the Compose logs until Ctrl+C. **Detached** starts the services in the background and returns, waiting until they're ready first when `started-url` is set. The other shared scripts are `aws-sso-login`, `prune-docker` and `setup-skills`.

## Main menu

| Action | What it does |
|---|---|
| Start services | Asks for an environment file, then shows one page with the container and service choices above the service tree, then starts them |
| Build the macOS desktop app | Asks for an environment file, the Mac's processor, whether to include hot reload (on by default, off for a release), whether to build in debug mode and whether to rebuild the builder image, then builds `gui/tauri/dist/Lixpi.app` in Docker. See [Desktop App](../../documentation/platform/DESKTOP-APP.md) |
| Sign in to AWS SSO | Asks for an environment file, then signs in as that file's `AWS_PROFILE` |
| Create or edit a configuration | Opens the [configuration wizard](../config-utils/README.md) |
| Initialize infrastructure | Asks for an environment file, whether to regenerate the TLS certificates (**Keep** by default, and locked with the reason when none exist yet, since they're generated anyway) and whether to trust the local certificate authority (**Skip** by default, **Install** for running web-ui in a browser). It then sets up the certificates and, as a separate phase, the DynamoDB tables |
| Deploy and manage infrastructure | Asks for an environment file, states the deployment target, then offers every command the Pulumi service reports |
| Prune Docker | Asks what to prune, confirms, then reclaims disk space |
| Install agent skills | Opens the skill installer |
| Exit | Leaves the console |

Every action that needs an environment file uses the same picker. It lists the repository's `.env.*` files and leaves out the `.env.example` template. There is no default environment file, and the console doesn't remember a choice between actions.

You can return to the main menu from any step. Esc, Ctrl+C and the **Back to main menu** option all abandon the current action without changing anything, and Esc or Ctrl+C on the main menu itself exits. The configuration wizard and the skill installer treat those keys as cancelling.

Submitting an action ends the console when its script finishes, with that script's exit status, because a stack left running shouldn't share a terminal with a menu. The exception is an action with `returnToMenu` set, such as creating or editing a configuration, which the next action usually needs. That action comes back to the menu even when it fails.

## Starting services

**Start services** asks for an environment file, then shows one page with everything else. Three rows sit at the top, and Left and Right switch them. **Containers** defaults to **Use existing**, in which case Compose builds only images that are missing, or **Rebuild**. **Run** defaults to **Foreground**, which keeps the console attached to the logs, or **Detached**. **Services** sets the tree below. **Base** is the default and selects the `main` profile the application needs, **Custom** clears the tree so you can pick only the services you need, and **All** adds the admin and developer tools. Changing a service in the tree moves the row to **Custom** until the selection matches **Base** or **All** again.

| Key | Action |
|---|---|
| Up and Down | Move between rows |
| Space | Toggle a service, or everything under a group |
| Left | Switch a radio row, fold the group, or move to its parent |
| Right | Switch a radio row, unfold the group, or move to its first child |
| Enter | Confirm |

A group with only some of its services selected shows a half-filled checkbox, and Space on it selects the rest. Compose still starts whatever a selected service depends on, so the plan shown before launch lists those dependencies. Selecting only `lixpi-api`, for example, also starts NATS and DynamoDB.

If a rebuild was chosen, the selected containers are removed and their images are built without cache. The previous images are then left dangling, so the console deletes dangling images. That cleanup covers the whole Docker host, not only this project, although images still in use are kept. Dependencies that weren't selected keep their existing images. A failed rebuild starts nothing, and the previous image stays in place.

## Pruning Docker

**Prune Docker** first measures disk usage with `docker system df` on the host, because the console container has no Docker access. It shows the size and reclaimable space per category in a table and beside the matching tree rows. Networks take no measurable space, so they show no size. In the tree, Space on a group selects everything in it. **Resources** holds stopped containers, images, unused networks, volumes and build cache, with images, volumes and build cache as their own groups. **System** holds `docker system prune` in three strengths: the default, with `--all`, and with `--all --volumes`, which removes anonymous volumes but keeps named ones. Nothing is preselected, because pruning covers the whole Docker host and so also affects other projects on the machine. The console asks for confirmation with No as the default, and warns separately before **All unused volumes**, which deletes named volumes such as DynamoDB and NATS data once their containers are removed. Afterwards it prints `docker system df`.

## Expired AWS sessions

Any action can stop because the AWS session has expired, so the handling sits in `run-console.sh` around every action. When an action fails and an environment file was chosen, the console runs `aws-sso-login.sh --check-session` for that file's `AWS_PROFILE`. If the session is gone, it signs in with the same script the menu uses, then reruns the action with the same choices. A repository's file without `AWS_PROFILE` falls back to Lixpi's file of the same name.

A failure that isn't about the session ends the action as usual, and so does Ctrl+C. The console gives up after 3 sign-ins for one action, so a repeated failure can't loop forever. Rerunning assumes the action can safely start again, which holds for Pulumi and Compose.

## Deploying

A `service-commands` step holds no list of commands. The console calls the action's script with `LIXPI_CONSOLE_QUERY=catalog`, and the script asks the service itself. The service answers with one line of JSON holding its deployment target and its commands, each with a label, an effect of `read`, `change` or `destroy`, any arguments it needs, and whether it can run with this configuration. A new command in the service therefore appears in the menu with no console change.

The console shows the target before offering anything, including the AWS account and profile or a plain statement that a stack stays local. A blocked command stays visible but can't be chosen, and shows the reason. Anything other than `read` asks for confirmation, naming the target, with No as the default.

The service decides what's allowed, so a direct call is refused the same way. Lixpi's Pulumi service reads `PULUMI_ALLOWED_AWS_PROFILES` from its Compose service. When it's set, `change` and `destroy` commands only run if the selected environment's `AWS_PROFILE` is on the list, while `read` commands stay available. The website sets it to `production`.

## How the container reaches the host

The console runs in its own Compose project with no network and read-only mounts of the launching repository and the Lixpi checkout, which it needs to follow base services across checkouts. Those mounts are how it sees the environment files and Compose files, but it can't change them or run Docker. It draws its UI on stderr and writes a plan to stdout:

```text
ACTION=run
SCRIPT=shared:start-services
ENV_FILE=.env.alice-local
OPTION=rebuild=false
SELECTED=lixpi-web-ui
SELECTED=lixpi-api
```

`run.sh` validates every field against a strict pattern and rejects anything it doesn't recognize, then runs the named script on the host. The plan carries values and never a command line, so nothing the container prints can run as a command.

The scripts in `actions/` are internal to the console, with two exceptions that have callers outside the menu. Automation creates configurations through `init-config.sh --non-interactive`, and other repositories sign in through `aws-sso-login.sh <profile>`.

## Docker layout

Every repository that uses the console keeps its Compose files in `infrastructure/docker` with the same shape:

```text
infrastructure/docker/
├── docker-group.json            label, and the base profile
├── docker-compose.yml           the stack: includes every partial under services/
├── services/
│   ├── docker-group.json        "kind": "services"
│   └── <group>/                 one directory per group, nested as deep as needed
│       ├── docker-group.json    label, optional order and description
│       └── docker-compose.<name>.yml
└── utilities/
    ├── docker-group.json        "kind": "utilities"
    └── <group>/
        ├── docker-group.json
        └── docker-compose.<name>.yml
```

`services/` holds what the application runs: the frontends, the API, the brokers, the databases, and developer apps such as the design system. `utilities/` holds what runs on demand from its own file: Pulumi, the local certificate generator, the AWS CLI, the test and quality runners, the configuration wizard and the console itself.

[`docker-layout.ts`](src/docker-layout.ts) reads the directory and enforces these rules, reporting every broken one at once before the tree is drawn:

- Every directory has a `docker-group.json` with a `label`. `order` sorts sibling groups, and groups without one come last, sorted by label. `description` says what the group holds.
- Only the top `docker-group.json` sets `baseProfile`, the profile that makes up **Base services**. Only `services/` and `utilities/` set `kind`, which must match their name.
- Partials are named `docker-compose.<name>.yml` and live in group directories. The top directory holds only `docker-group.json`, `docker-compose.yml` and an optional `README.md`. So do `services/` and `utilities/`, apart from their group directories.
- `docker-compose.yml` declares no services of its own. It includes every partial under `services/` and nothing else, because a missing partial couldn't start and an included utility would start with every `up`.

## Where the service tree comes from

The tree mirrors `services/`. Each directory is a group with its `docker-group.json` label, nested the same way, and each partial in it adds its services in file order. A group with exactly one partial and no subgroups shows that file's name. Adding a service means adding it to a partial, and adding a group means adding a directory with a `docker-group.json` and a partial, then including that partial in the stack. The console config doesn't change.

Compose decides which services start by default. [`compose-catalog.ts`](src/compose-catalog.ts) parses the stack file and its `include` list without interpolating them, because this happens before an environment file is chosen. It follows `extends` to find profiles declared in base files. A service belongs to **Base services** when it has the base profile or no profile at all, which is the same set `docker compose --env-file .env.<stage> -f infrastructure/docker/docker-compose.yml --profile main up` starts. A group can hold both kinds: the NATS group contains the three brokers and the unselected `lixpi-nats-cli`. The console always names the selected services when it starts them, so `up` runs exactly what you chose.

The tree prompt, the environment-file listing and the wizard title bar come from [`@lixpi/cli-ui`](../../packages/lixpi/cli-ui/README.md), which the configuration wizard and skill installer also use.

## Verification

The console and `@lixpi/cli-ui` sources are bind-mounted, so an edit to either applies on the next run. A dependency change rebuilds the image, which `run.sh` checks at every launch.

When `CODING_AGENTS_TEST_EXECUTION_MODE` permits, run the tests through the shared TypeScript test runner. They use synthetic Compose files and mocked prompts, and the tree prompt's own tests live with its package. `run.sh` and the `actions/` scripts act on Docker directly and aren't covered by them.

```bash
docker compose --env-file .env.<stage> -f infrastructure/docker/utilities/code-quality/docker-compose.typescript-test-runner.yml --profile dev run --rm --no-deps -T lixpi-typescript-test-runner dev-console
```

Formatting and lint checks follow `CODING_AGENTS_TEST_LINTER_MODE`:

```bash
docker compose -f infrastructure/docker/utilities/code-quality/docker-compose.typescript-quality-runner.yml --profile dev run --rm --no-deps -T lixpi-typescript-quality-runner files validate dev-tools/dev-console/src dev-tools/dev-console/vitest.config.ts
```
