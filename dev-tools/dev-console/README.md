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

Under `services`, `composeFile` names the Compose file, `baseProfile` names the profile that makes up **Base**, and `groups` arranges the services. A service with no profile is always part of **Base**.

A script runs from the repository root. It receives the selected services or prune targets as arguments, and the rest as environment variables: `LIXPI_CONSOLE_WORKSPACE`, `LIXPI_CONSOLE_ENV_FILE` as an absolute path, and `LIXPI_CONSOLE_OPTION_<NAME>` for each param and radio row. `LIXPI_REPOSITORY_PATH` is set too.

`shared:start-services` starts the selected services from the params `compose-file` and optionally `profile`, `up-flags` as a comma-separated list, and `started-url`. It reads the radio rows `rebuild` and `logs`. The other shared scripts are `aws-sso-login`, `prune-docker` and `setup-skills`.

## Main menu

| Action | What it does |
|---|---|
| Sign in to AWS SSO | Asks for an environment file, then signs in as that file's `AWS_PROFILE` |
| Start services | Asks for an environment file, then shows one page with the container and service choices above the service tree, then starts them |
| Create or edit a configuration | Opens the [configuration wizard](../config-utils/README.md) |
| Initialize infrastructure | Asks for an environment file, then sets up TLS certificates and DynamoDB tables |
| Deploy and manage infrastructure | Asks for an environment file, states the deployment target, then offers every command the Pulumi service reports |
| Prune Docker | Asks what to prune, confirms, then reclaims disk space |
| Install agent skills | Opens the skill installer |
| Exit | Leaves the console |

Every action that needs an environment file uses the same picker. It lists the repository's `.env.*` files and leaves out the `.env.example` template. There is no default environment file, and the console doesn't remember a choice between actions.

You can return to the main menu from any step. Esc, Ctrl+C and the **Back to main menu** option all abandon the current action without changing anything, and Esc or Ctrl+C on the main menu itself exits. The configuration wizard and the skill installer treat those keys as cancelling.

Submitting an action ends the console when its script finishes, with that script's exit status, because a stack left running shouldn't share a terminal with a menu. The exception is an action with `returnToMenu` set, such as creating or editing a configuration, which the next action usually needs. That action comes back to the menu even when it fails.

## Starting services

**Start services** asks for an environment file, then shows one page with everything else. Two radio rows sit above the service tree, and Left and Right switch them. **Containers** defaults to **Use existing**, in which case Compose builds only images that are missing, or **Rebuild**. **Services** defaults to **Base**, which starts the `main` profile the application needs, or **All**, which adds the admin and developer tools. Switching it updates the tree below, and changing anything in the tree leaves neither option marked until the selection matches one again.

| Key | Action |
|---|---|
| Up and Down | Move between rows |
| Space | Toggle a service, or everything under a group |
| Left | Switch a radio row, fold the group, or move to its parent |
| Right | Switch a radio row, unfold the group, or move to its first child |
| Enter | Confirm |

A group with only some of its services selected shows a half-filled checkbox, and Space on it selects the rest. Compose still starts whatever a selected service depends on, so the plan shown before launch lists those dependencies. Selecting only `lixpi-api`, for example, also starts NATS and DynamoDB.

The `infrastructure/docker/docker-compose.yml` file holds only the `include` list and the shared volumes and networks. Each service lives in a partial file for its group, such as `docker-compose.ui.yml` or `docker-compose.databases.yml`.

If a rebuild was chosen, the selected containers are removed and their images are built without cache. The previous images are then left dangling, so the console deletes dangling images. That cleanup covers the whole Docker host, not only this project, although images still in use are kept. Dependencies that weren't selected keep their existing images. A failed rebuild starts nothing, and the previous image stays in place.

## Pruning Docker

**Prune Docker** first measures disk usage with `docker system df` on the host, because the console container has no Docker access. It shows the size and reclaimable space per category in a table and beside the matching tree rows. Networks take no measurable space, so they show no size. In the tree, Space on a group selects everything in it. **Resources** holds stopped containers, images, unused networks, volumes and build cache, with images, volumes and build cache as their own groups. **System** holds `docker system prune` in three strengths: the default, with `--all`, and with `--all --volumes`, which removes anonymous volumes but keeps named ones. Nothing is preselected, because pruning covers the whole Docker host and so also affects other projects on the machine. The console asks for confirmation with No as the default, and warns separately before **All unused volumes**, which deletes named volumes such as DynamoDB and NATS data once their containers are removed. Afterwards it prints `docker system df`.

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

## Where the service tree comes from

Compose decides what exists. [`compose-catalog.ts`](src/compose-catalog.ts) parses the configured Compose file and its `include` list without interpolating them, because this happens before an environment file is chosen. It follows `extends` to find profiles declared in base files. A service belongs to **All services** when it has the `main` profile or no profile at all, which is the same set `docker compose --env-file .env.<stage> -f infrastructure/docker/docker-compose.yml --profile main up` starts.

[`service-tree.ts`](src/service-tree.ts) only arranges those services into groups, and each group mirrors a partial Compose file. A service is in the base stack when it has the `main` profile or no profile at all, so a group can hold both kinds: the NATS group contains the three brokers and the unselected `lixpi-nats-cli`. The console always names the selected services when it starts them, so `up` runs exactly what you chose. A name Compose no longer defines is dropped, and a group left empty goes with it. A new `main`-profile service that nobody has grouped yet appears under **Other services** rather than disappearing. A group whose services all live in one partial Compose file shows that file's name.

One-shot runners, such as the test and quality containers, aren't offered because no group names them.

The tree prompt, the environment-file listing and the wizard title bar come from [`@lixpi/cli-ui`](../../packages/lixpi/cli-ui/README.md), which the configuration wizard and skill installer also use.

## Verification

The console and `@lixpi/cli-ui` sources are bind-mounted, so an edit to either applies on the next run. A dependency change rebuilds the image, which `run.sh` checks at every launch.

When `CODING_AGENTS_TEST_EXECUTION_MODE` permits, run the tests through the shared TypeScript test runner. They use synthetic Compose files and mocked prompts, and the tree prompt's own tests live with its package. `run.sh` and the `actions/` scripts act on Docker directly and aren't covered by them.

```bash
docker compose --env-file .env.<stage> -f infrastructure/docker/docker-compose.yml --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner dev-console
```

Formatting and lint checks follow `CODING_AGENTS_TEST_LINTER_MODE`:

```bash
docker compose -f infrastructure/docker/docker-compose.typescript-quality-runner.yml --profile dev run --rm --no-deps -T lixpi-typescript-quality-runner files validate dev-tools/dev-console/src dev-tools/dev-console/vitest.config.ts
```
