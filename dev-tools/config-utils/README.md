# Configuration runner

`dev-tools/config-utils` is the shared Dockerized runner for repository configuration wizards. The runner owns the runtime, dependencies, `env.lixpi` bootstrap, and base Compose service. Each repository owns its setup logic and templates.

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

lixpi-billing/dev-tools/config-utils/
├── setup-env.ts
└── templates/
    ├── env.lixpi.template
    └── env.template
```

The files at the top of the Lixpi directory are shared runner infrastructure. The `setup-env.ts` and `templates/` paths are the Lixpi repository adapter. Billing has the same adapter paths in its own repository. `setup-skills.ts` is the separate prompt used by `setup-skills.sh`; it shares the container dependencies but is not part of the repository adapter contract.

## Mount contract

[`runner-compose/config-utils.base.yml`](runner-compose/config-utils.base.yml) builds the shared image and mounts the shared runtime into `/usr/src/config-utils`. A repository-level `docker-compose.config-utils.yml` extends that service and supplies these mounts:

| Container path | Access | Owner | Purpose |
|---|---|---|---|
| `/workspace` | read/write | consuming repository | Repository whose local configuration is being generated |
| `/usr/src/config-utils/repository/setup-env.ts` | read-only | consuming repository | Repository-specific wizard entry point |
| `/usr/src/config-utils/repository/templates/` | read-only | consuming repository | Repository-specific `env.lixpi` and runtime env templates |
| `/usr/src/config-utils/repository/environment-file.ts` | read-only | shared runner | Environment-file editor used by adapters |

An adapter may declare additional read-only or read/write mounts. Billing mounts the main Lixpi checkout at `/lixpi`; the host path is supplied by `LIXPI_REPOSITORY_PATH` and is never inferred from relative directory placement.

The adapter file and directory names are part of the runner contract. A new repository can plug in by creating the same `dev-tools/config-utils/setup-env.ts` and `dev-tools/config-utils/templates/` paths, then adding a root Compose adapter that extends the shared base service.

## Startup order

The container entry point is [`run-config.ts`](run-config.ts). It performs setup in this order:

1. Read the consuming repository's `templates/env.lixpi.template`.
2. Replace `{{VARIABLE_NAME}}` placeholders from the container environment.
3. Write `/workspace/env.lixpi` with owner-only permissions.
4. Start the mounted repository `setup-env.ts` and pass through all command-line arguments.

`env.lixpi` is therefore the first repository file written during configuration setup. It is generated local state, is ignored by Git, and is not checked in. The repository adapter must not try to run before this bootstrap completes.

The Lixpi template writes:

```dotenv
GITHUB_REPOSITORY=Lixpi/lixpi
TICKET_KEY=LIX
DEFAULT_TARGET_BRANCH=main
DEFAULT_SOURCE_BRANCH=main
```

Billing's template adds its required absolute host checkout path:

```dotenv
GITHUB_REPOSITORY=Lixpi/lixpi-billing
TICKET_KEY=LIX-BILL
DEFAULT_TARGET_BRANCH=main
DEFAULT_SOURCE_BRANCH=main
LIXPI_REPOSITORY_PATH=/absolute/path/selected/during/setup
```

Billing must collect and validate that host path before Compose can resolve the shared base file. `init-config.sh` is the single bootstrap exception to billing's normal `env.lixpi` gate. It prompts for the path, exports it only for the setup container, and the shared runner writes the authoritative file before the billing adapter starts. Every other billing script reads the generated file and fails if it is missing or invalid.

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

## Billing adapter

Run from the billing root:

```bash
./init-config.sh
```

The wrapper always asks for the absolute main Lixpi checkout path. After the shared runner writes billing's `env.lixpi`, the billing adapter:

1. Lists the main checkout's `.env.*` files, excluding `.env.example`.
2. Lets the user select one.
3. Creates or updates a billing file with the identical basename, such as `.env.shelby-local`.
4. Starts from billing's own `dev-tools/config-utils/templates/env.template` when the matching file does not exist. This template contains only billing-owned defaults.
5. Copies the shared stage, organization, environment, AWS, DynamoDB, NATS/Nex, and portal values from the selected main configuration.
6. Generates or reuses billing's private `BILLING_NATS_NKEY_SEED` in the billing file.
7. Adds or refreshes `svc:billing-api` in the selected main configuration's `NATS_SERVICE_AUTH_REGISTRATIONS` and signed `NATS_APPLICATION_REGISTRATION`.

Billing-owned values—including its database, service mode, HTTP address, refresh interval, and Stripe secrets—remain in the billing file. Existing billing-only values are preserved on subsequent runs. A legacy billing seed in the main file is migrated to the billing file and removed from the main file after the registration has been prepared.

Both repositories ignore `env.lixpi` and runtime `.env.*` files. Templates are the committed source of defaults; generated files may contain secrets and must not be committed.

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
