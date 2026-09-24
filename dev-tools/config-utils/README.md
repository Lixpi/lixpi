# Configuration runner

`dev-tools/config-utils` is the Dockerized runner for Lixpi's configuration wizard. The runner owns the runtime, dependencies, `env.lixpi` bootstrap, and base Compose service. The repository adapter owns its setup logic and templates.

The split matches the code-quality and test runners:

```text
lixpi/dev-tools/config-utils/
├── Dockerfile
├── run-config.ts
├── environment-file.ts
├── runner-compose/
│   └── config-utils.base.yml
├── setup-env.ts
├── setup-skills.ts
└── templates/
    ├── env.lixpi.template
    ├── env.template
    └── aws-config.template
```

The files at the top of the directory are runner infrastructure. The `setup-env.ts` and `templates/` paths are the Lixpi repository adapter. `${LIXPI_REPOSITORY_PATH}/dev-tools/config-utils/setup-skills.ts` is the separate prompt used by `${LIXPI_REPOSITORY_PATH}/setup-skills.sh`; it shares the container dependencies but is not part of the repository adapter contract. The installer reads `LIXPI_REPOSITORY_PATH` from `env.lixpi`, so configuration setup must run first.

## Mount contract

[`runner-compose/config-utils.base.yml`](runner-compose/config-utils.base.yml) builds the shared image and mounts the shared runtime into `/usr/src/config-utils`. A repository-level `docker-compose.config-utils.yml` extends that service and supplies these mounts:

| Container path | Access | Owner | Purpose |
|---|---|---|---|
| `/workspace` | read/write | consuming repository | Repository whose local configuration is being generated |
| `/usr/src/config-utils/repository/setup-env.ts` | read-only | consuming repository | Repository-specific wizard entry point |
| `/usr/src/config-utils/repository/templates/` | read-only | consuming repository | Repository-specific `env.lixpi` and runtime env templates |
| `/usr/src/config-utils/repository/environment-file.ts` | read-only | shared runner | Environment-file editor used by adapters |

An adapter may declare additional read-only or read/write mounts. Checkout paths come from generated repository configuration and are not inferred from directory placement.

The adapter file and directory names are part of the runner contract. A new repository can plug in by creating the same `dev-tools/config-utils/setup-env.ts` and `dev-tools/config-utils/templates/` paths, then adding a root Compose adapter that extends the shared base service.

## Startup order

The container entry point is [`run-config.ts`](run-config.ts). It performs setup in this order:

1. Read the consuming repository's `templates/env.lixpi.template`.
2. Replace `{{VARIABLE_NAME}}` placeholders from the container environment.
3. Write `/workspace/env.lixpi` with owner-only permissions.
4. Start the mounted repository `setup-env.ts` and pass through all command-line arguments.

`env.lixpi` is therefore the first repository file written during configuration setup. It is generated local state, is ignored by Git, and is not checked in. The repository adapter must not try to run before this bootstrap completes.

Environment assignments use `KEY = value`. The shared `envLiteral` helper leaves values unquoted whenever the unquoted form round-trips through the environment-file parser, and adds double quotes only when they are required to preserve the value. Repository adapters must use that helper instead of quoting every value.

The Lixpi template writes:

```dotenv
GITHUB_REPOSITORY = Lixpi/lixpi
TICKET_KEY = LIX
DEFAULT_TARGET_BRANCH = main
DEFAULT_SOURCE_BRANCH = main
LIXPI_REPOSITORY_PATH = /absolute/path/to/lixpi
```

The Lixpi launcher resolves its own directory through `pwd -P` and passes that absolute host path to the runner. The runner writes it into `env.lixpi` with the other repository metadata.

## Lixpi adapter

Run from the Lixpi root:

```bash
./init-config.sh
```

The wrapper starts `docker-compose.config-utils.yml`. The shared runner creates `env.lixpi`, then the Lixpi adapter creates or updates `.env.<developer>-<environment>` and optional `.aws/config` files.

The Lixpi wizard offers **Generate new** and **Edit existing**. Existing files can be replaced or edited by group. Partial edits preserve unrelated variables, comments, quoting, interpolation, multiline values, and line endings. NATS keys and passwords are reused unless replacement is selected. Every save regenerates or refreshes the signed NATS application registration from the resulting configuration.

Non-interactive creation uses the same wrapper and refuses to overwrite an existing configuration:

```bash
./init-config.sh --non-interactive --name=shelby --env=local
```

Supported options are `--help`, `--non-interactive`, `--name=<name>`, and `--env=local|dev|production`.

Lixpi ignores `env.lixpi` and runtime `.env.*` files. Templates are the committed source of defaults; generated files may contain secrets and must not be committed.

## Extending the runner

A repository adapter is an executable TypeScript module, not a branch in the shared runner. To add another repository:

1. Add `dev-tools/config-utils/setup-env.ts` in that repository.
2. Add `dev-tools/config-utils/templates/env.lixpi.template` and `env.template` there.
3. Add a root `docker-compose.config-utils.yml` that extends `config-utils-base` and mounts the repository adapter paths.
4. Add a root launcher that supplies any bootstrap variables required to locate the shared Lixpi checkout, then invokes the Compose adapter.
5. Keep repository-specific prompts, defaults, file names, and side effects inside the adapter.

Do not add consuming-repository switches to `run-config.ts`. Shared behavior belongs in the runner only when every adapter needs it.

## Verification

Configuration tests run only through the shared TypeScript test runner when test execution has been explicitly authorized:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner init-config
```

The tests use synthetic content and mocked prompts; they must not read or update a developer's generated configuration files.
