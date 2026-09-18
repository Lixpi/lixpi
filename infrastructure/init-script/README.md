# Environment Setup Script

Interactive setup wizard for creating or updating `.env` configuration files for Lixpi development. `init-config.sh` and `init-config.bat` launch the same Dockerized wizard.

The first prompt offers **Generate new** or **Edit existing**. Editing lists the available `.env.*` files in the project root, then asks whether to override the selected file completely or make partial updates. Complete replacement writes to the selected filename. Generating a new configuration asks for the developer name and environment; a matching filename triggers the same update choice before any further settings or credential generation.

A complete override runs the configuration wizard with fresh values and NATS credentials. Partial editing uses the same wizard and asks whether to edit each group. Skipping a group preserves its values and shows no child prompts. Within a selected group, the existing conditional flow applies: local DynamoDB skips the custom endpoint, LocalAuth0 skips real Auth0 credentials, disabled AWS setup skips its fields, and Bedrock skips direct provider keys.

An active field offers **Use existing value** or **Override value**. Explicitly empty values offer **Keep empty**; absent values offer only **Set new value**. Inapplicable fields are skipped even when empty or absent. The editor preserves custom variables and assignments outside the selected fields, including their comments, quoting, interpolation, multiline values, and line endings. Changing a wizard setting also updates the environment variables derived from that setting.

NATS key pairs and passwords are reused unless their replacement is selected. Missing pairs are generated; an existing seed with a missing public key derives that public key without rotating the seed. Selected AWS SSO edits merge into the matching `.aws/config` profile and session while retaining unrelated profiles. Cancelling before saving leaves the files unchanged.

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
   - `createUser()` → `NATS_LLM_SERVICE_NKEY_*` (seeds start with `SU`)
   - `createUser()` → `NATS_NEX_NODE_NKEY_*` (seeds start with `SU`)
   - `createUser()` → `NATS_AI_MODEL_REGISTRY_NKEY_*` (seeds start with `SU`)

3. **Creates secure passwords** for NATS system and regular users

4. **Writes configuration files**:
   - `.env.<name>-<environment>` in project root
   - `.aws/config` (optional)

## Usage

### Interactive Mode (Recommended)

#### macOS / Linux

Open Terminal in the project folder and run:

```bash
docker build -f infrastructure/init-script/Dockerfile -t lixpi/setup . && docker run -it --rm -v "$(pwd):/workspace" lixpi/setup
```

#### Windows CMD

Open Command Prompt in the project folder and run:

```cmd
docker build -f infrastructure/init-script/Dockerfile -t lixpi/setup . && docker run -it --rm -v "%cd%:/workspace" lixpi/setup
```

#### Windows PowerShell

Open PowerShell in the project folder and run:

```powershell
docker build -f infrastructure/init-script/Dockerfile -t lixpi/setup .; docker run -it --rm -v "${PWD}:/workspace" lixpi/setup
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
- NATS servers, keys, and passwords
- Auth0 configuration
- API keys
- Provider request authorization (`METRICS_ENABLED=false` by default)

### `.aws/config` (Optional)

AWS SSO profile configuration for CLI access.

## Smart Presets

When you select **local** environment:
- DynamoDB endpoint defaults to `http://lixpi-dynamodb:8000`
- LocalAuth0 mock is enabled with pre-configured values
- NATS debug mode is enabled
- Pulumi uses local file storage

## Technical Details

- **Runtime**: Node.js 24 with stable native TypeScript type stripping
- **Prompts**: `@clack/prompts` for beautiful interactive CLI
- **Key Generation**: `@nats-io/nkeys` for cryptographic key pairs
- **No host dependencies**: Everything runs inside Docker

## Verification

Run the configuration editor and prompt-flow tests in the shared TypeScript test runner:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner init-config
```

The tests use synthetic configuration contents and mocked prompts. They do not read or update a developer's environment file.
