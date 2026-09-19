# Environment Setup Script

Interactive setup wizard for creating or updating `.env` configuration files for Lixpi development. `init-config.sh` and `init-config.bat` launch the same Dockerized wizard.

The first prompt offers **Generate new** or **Edit existing**. Editing lists the available `.env.*` files in the project root, then asks whether to override the selected file completely or make partial updates. Complete replacement writes to the selected filename. Generating a new configuration asks for the developer name and environment; a matching filename triggers the same update choice before any further settings or credential generation.

A complete override runs the configuration wizard with fresh values and NATS credentials. Partial editing uses the same wizard and asks whether to edit each group. Skipping a group preserves its values and shows no child prompts. Within a selected group, the existing conditional flow applies: local DynamoDB skips the custom endpoint, LocalAuth0 skips real Auth0 credentials, disabled AWS setup skips its fields, and Bedrock skips direct provider keys.

An active field offers **Use existing value** or **Override value**. Explicitly empty values offer **Keep empty**; absent values offer only **Set new value**. Inapplicable fields are skipped even when empty or absent. The editor preserves custom variables and assignments outside the selected fields, including their comments, quoting, interpolation, multiline values, and line endings. Changing a wizard setting also updates the environment variables derived from that setting.

NATS key pairs and passwords are reused unless their replacement is selected. Missing pairs are generated; an existing seed with a missing public key derives that public key without rotating the seed. Selected AWS SSO edits merge into the matching `.aws/config` profile and session while retaining unrelated profiles. Cancelling before saving leaves the files unchanged.

Every save also prepares the signed NATS registration from the resulting service keys, browser authentication settings and application permissions. This applies to new configurations, complete replacements, partial updates and non-interactive creation. A partial save adds missing registration settings even when the NATS group is skipped. It reuses the registration signing key and password, preserves unchanged manifest versions, and increments the version when declarations change. Unrelated assignments keep their original text.

To update an existing configuration, run `init-config`, choose **Edit existing**, select its file and choose **Partial update**. Keep the values you want to retain and confirm the save. If only application permission code changed, you can skip every group; the save still derives the registration from the application code included in the setup image. Both launchers build that image before opening the wizard. API startup submits the saved registration automatically before opening its ordinary NATS connection.

The template includes EC2 broker sizing and scaling bounds. `NATS_MIN_NODES`, `NATS_MAX_NODES` and `NATS_DESIRED_NODES` default to three; raising the maximum enables additional hosts under load. `NATS_EC2_INSTANCE_TYPE` defaults to `t3.small`. Existing clusters use the staged AZ-tag rollout described in the [NATS cluster README](../pulumi/src/resources/NATS-cluster/README.md) before changing `NATS_JETSTREAM_UNIQUE_TAG` to `az:`. `NATS_OPERATIONAL_ALERT_EMAIL` optionally subscribes an address to scaling alerts; AWS requires email confirmation. These deployment variables are literal template defaults and remain editable directly; partial wizard edits preserve their existing values.

## What It Does

This script runs inside a Docker container and:

1. **Prompts for configuration** - Grouped into sections:
   - **General**: Developer name, environment type (local/dev/production)
   - **Database**: Local DynamoDB or custom endpoint
   - **Authentication**: LocalAuth0 mock or real Auth0 configuration
   - **NATS**: Auto-generates all required keys and passwords
   - **AWS SSO Configuration**: Optional SSO profile setup
   - **AWS Deployment Configuration**: Optional Route53, CloudWatch log retention, Container Insights
   - **API Keys**: OpenAI, Anthropic, Google, Stability AI, Stripe

2. **Generates NATS keys** using `@nats-io/nkeys`:
   - `createAccount()` → `NATS_AUTH_NKEY_*` (seeds start with `SA`)
   - `createCurve()` → `NATS_AUTH_XKEY_*` (seeds start with `SX`)
   - `createUser()` produces distinct `SU` seeds and public keys for API, file conversion, character fidelity, backup, operator, and NEX. The existing LLM key configuration remains available for compatibility.

3. **Creates secure passwords** for the NATS system user and restricted callout bootstrap user (`NATS_CALLOUT_PASSWORD`). The issuer and XKey seeds belong to the embedded broker/auth runtime in `services/nats`; application clients receive their own service seed.

4. **Signs the NATS registration** using the application permission declarations and the resulting environment settings. It saves the approved payload for API startup and the public trust configuration for brokers. The signing seed stays in deployment configuration, outside serving containers.

5. **Writes configuration files**:
   - `.env.<name>-<environment>` in project root
   - `.aws/config` (optional)

## Usage

### Interactive Mode (Recommended)

#### macOS / Linux

Open Terminal in the project folder and run:

```bash
./init-config.sh
```

#### Windows CMD

Open Command Prompt in the project folder and run:

```cmd
init-config.bat
```

#### Windows PowerShell

Open PowerShell in the project folder and run:

```powershell
.\init-config.bat
```

### Non-Interactive Mode (CI/Automation)

For automated environments without TTY:

```bash
docker run --rm -v "$(pwd):/workspace" lixpi/setup --non-interactive --name=john --env=local
```

Non-interactive mode refuses to replace an existing configuration. Run interactive setup to choose how to update it.

### Help

```bash
docker run --rm lixpi/setup --help
```

## Options

| Option | Description |
|--------|-------------|
| `--help`, `-h` | Show help message |
| `--non-interactive` | Run without prompts (requires `--name` and `--env`) |
| `--name=<name>` | Developer name (e.g., "john") |
| `--env=<environment>` | Environment type: `local`, `dev`, `production` |

## Output Files

### `.env.<name>-<environment>`

Complete environment configuration including:
- Docker Compose settings
- Domain and SSL configuration
- SST/Pulumi configuration
- AWS SSO settings
- AWS deployment settings (Route53, CloudWatch)
- NATS servers, keys, passwords and signed application registration
- Auth0 configuration
- API keys
- Provider request authorization (`METRICS_ENABLED=false` by default)

The wizard maintains these registration settings on save:

| Setting | Recipient |
|---|---|
| `NATS_REGISTRATION_AUTHORITY_SEED` | Deployment tooling only; keep this private signing key out of serving containers |
| `NATS_REGISTRATION_AUTHORITIES` | Brokers; public authority key, owner and allowed accounts |
| `NATS_REGISTRATION_PASSWORD` | Brokers and application initializer |
| `NATS_APPLICATION_REGISTRATION` | API startup; signed payload without the private authority key |

Keep the authority seed and latest signed manifest with deployment secrets so a complete registry loss can be recovered. NATS persists accepted registrations in native JetStream KV, and ordinary restarts reuse them.

### `.aws/config` (Optional)

AWS SSO profile configuration for CLI access.

## Smart Presets

When you select **local** environment:
- DynamoDB endpoint defaults to `http://lixpi-dynamodb:8000`
- LocalAuth0 mock is enabled with pre-configured values
- NATS debug mode is enabled
- Pulumi uses local file storage

## Technical Details

- **Runtime**: Node.js 24 with `--experimental-transform-types` for the workspace's TypeScript enums
- **Prompts**: `@clack/prompts` for beautiful interactive CLI
- **Key Generation**: `@nats-io/nkeys` for cryptographic key pairs
- **No host dependencies**: Everything runs inside Docker

## Verification

Run the configuration editor and prompt-flow tests in the shared TypeScript test runner:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner init-config
```

The tests use synthetic configuration contents and mocked prompts. They do not read or update a developer's environment file.
