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
| `/usr/src/config-utils/repository/secret-input.ts` | read-only | shared runner | Chunk-based secret input with character-count feedback |

An adapter may declare additional read-only or read/write mounts. Checkout paths come from generated repository configuration and are not inferred from directory placement.

The adapter file and directory names are part of the runner contract. A new repository can plug in by creating the same `dev-tools/config-utils/setup-env.ts` and `dev-tools/config-utils/templates/` paths, then adding a root Compose adapter that extends the shared base service.

## Startup order

The container entry point is [`run-config.ts`](run-config.ts). It performs setup in this order:

1. Read the consuming repository's `templates/env.lixpi.template`.
2. Replace `{{VARIABLE_NAME}}` placeholders from the container environment.
3. Check that both coding-agent verification modes are `true`, `false`, or `auto`.
4. Write `/workspace/env.lixpi` with owner-only permissions.
5. Start the mounted repository `setup-env.ts` and pass through all command-line arguments.

`env.lixpi` is therefore the first repository file written during configuration setup. It is generated local state, is ignored by Git, and is not checked in. The repository adapter must not try to run before this bootstrap completes.

Environment assignments use `KEY = value`. The shared `envLiteral` helper leaves values unquoted whenever the unquoted form round-trips through the environment-file parser, and adds double quotes only when they are required to preserve the value. Repository adapters must use that helper instead of quoting every value.

Adapters that collect long credentials can use `SecretInputPrompt` from `./secret-input.ts`. It requires an interactive terminal, reads input in chunks, and displays a bounded character count without echoing the secret. It supports ordinary and bracketed paste, Backspace, Ctrl+U to clear, and Ctrl+C to cancel. Bracketed clipboard newlines stay in the value until validation; they do not submit the prompt. The adapter supplies validation and handles the Clack cancellation symbol. Submission and cancellation restore terminal mode and remove the prompt's listeners. There is no configured input-length cap.

The Lixpi template writes:

```dotenv
GITHUB_REPOSITORY = Lixpi/lixpi
TICKET_KEY = LIX
DEFAULT_TARGET_BRANCH = main
DEFAULT_SOURCE_BRANCH = main
LIXPI_REPOSITORY_PATH = /absolute/path/to/lixpi
CODING_AGENTS_TEST_EXECUTION_MODE = auto
CODING_AGENTS_TEST_LINTER_MODE = auto
```

The Lixpi launcher resolves its own directory through `pwd -P` and passes that absolute host path to the runner. The runner writes it into `env.lixpi` with the other repository metadata.

Each repository template sets both coding-agent verification modes to `auto`. Agents read the modes from that repository's `env.lixpi`. The test mode governs writing, modifying, and running tests: `true` requires relevant test work, `false` requires explicit authorization, and `auto` lets the agent perform useful test work without asking. The independent linter mode applies those choices to formatting and lint checks. The modes do not change the Docker-only command rule.

## Lixpi adapter

The hosted account release can prepare a local configuration without reopening the wizard:

```bash
docker compose --env-file env.lixpi -f docker-compose.config-utils.yml --profile dev build lixpi-config-utils
docker compose --env-file env.lixpi -f docker-compose.config-utils.yml --profile dev run --rm --no-deps -T lixpi-config-utils preview-local-account-auth .env.shelby-local
docker compose --env-file env.lixpi -f docker-compose.config-utils.yml --profile dev run --rm --no-deps -T lixpi-config-utils setup-local-account-auth .env.shelby-local
```

The setup command requires `ENVIRONMENT=local` and an existing signed registration. It atomically sets `MOCK_AUTH0=false`, `VITE_MOCK_AUTH=false` and `ACCOUNT_ADMISSION_ENABLED=true`, selects the configured Auth0 login hostname and signs the matching browser permissions. It validates the generated account requirement before saving and rejects a stale configuration image. It preserves unrelated values and refuses a concurrent file change. It does not restart services. Run it only after the deployment's Auth0 resources and account gateway are ready; restart enforcing APIs and brokers before activating the login Action, then restart browser clients. Keep enforcement enabled when recovering a failed release.

Run from the Lixpi root:

```bash
./init-config.sh
```

The wrapper starts `docker-compose.config-utils.yml`. The shared runner creates `env.lixpi`, then the Lixpi adapter creates or updates `.env.<developer>-<environment>` and optional `.aws/config` files.

The Lixpi wizard offers **Generate new** and **Edit existing**. Existing files can be replaced or edited by group. Partial edits preserve unrelated variables, comments, quoting, interpolation, multiline values, and line endings. NATS keys and passwords are reused unless replacement is selected. Every save regenerates or refreshes the signed NATS application registration from the resulting configuration.

When adding the AI Model Registry identity to an existing configuration, edit the NATS group to generate its missing key pair. Saving also supplies its required user ID if absent, without rotating saved keys.

Local real Auth0 defaults to `AUTH0_USE_DEVELOPER_KEYS=true`. The authentication group explains the shared Google keys and uses the canonical `AUTH0_TENANT_DOMAIN` for both `AUTH0_DOMAIN` and `VITE_AUTH0_DOMAIN`. Google client credentials are unnecessary in this mode. Selecting false uses `auth.${DOMAIN_NAME}` and your own provider credentials. Deployed environments require false. Auth0 does not support shared keys with custom login domains or silent login; see [its development-key limitations](https://auth0.com/docs/authenticate/identity-providers/social-identity-providers/devkeys). Apple remains optional and requires its own setup when enabled.

Saving authentication changes also refreshes the signed browser issuer and JWKS settings. Keep LocalAuth0 enabled until the external identity provider and account service are ready. The account service's issuer, gateway and DNS configuration belong to its deployment; changing the browser login hostname does not provision those resources.

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

When `CODING_AGENTS_TEST_EXECUTION_MODE` permits configuration tests, run them through the shared TypeScript test runner:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner init-config
```

The tests use synthetic content and isolated prompts; they must not read or update a developer's generated configuration files. Secret-input regressions also use the test image's `script` utility to exercise a real pseudo-terminal, including typing, a 1 MiB paste, cancellation, and the preceding and following Clack prompts. Rebuild `lixpi-typescript-test-runner` if an older local image lacks `script`.
