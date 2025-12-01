# Environment Setup Script

Interactive setup wizard for generating `.env` configuration files for Lixpi development.

## What It Does

This script runs inside a Docker container and:

1. **Prompts for configuration** - Grouped into sections:
   - **General**: Developer name, environment type (local/dev/production)
   - **Database**: Local DynamoDB or custom endpoint
   - **Authentication**: LocalAuth0 mock or real Auth0 configuration
   - **NATS**: Auto-generates all required keys and passwords
   - **AWS**: Optional SSO profile configuration
   - **API Keys**: OpenAI, Anthropic, Stripe

2. **Generates NATS keys** using `@nats-io/nkeys`:
   - `createAccount()` → `NATS_AUTH_NKEY_*` (seeds start with `SA`)
   - `createCurve()` → `NATS_AUTH_XKEY_*` (seeds start with `SX`)
   - `createUser()` → `NATS_LLM_SERVICE_NKEY_*` (seeds start with `SU`)

3. **Creates secure passwords** for NATS system and regular users

4. **Writes configuration files**:
   - `.env.<name>-<environment>` in project root
   - `.aws/config` (optional)

## Usage

### Interactive Mode (Recommended)

#### macOS / Linux

Open Terminal in the project folder and run:

```bash
docker build -t lixpi/setup infrastructure/init-script && docker run -it --rm -v "$(pwd):/workspace" lixpi/setup
```

#### Windows CMD

Open Command Prompt in the project folder and run:

```cmd
docker build -t lixpi/setup infrastructure/init-script && docker run -it --rm -v "%cd%:/workspace" lixpi/setup
```

#### Windows PowerShell

Open PowerShell in the project folder and run:

```powershell
docker build -t lixpi/setup infrastructure/init-script; docker run -it --rm -v "${PWD}:/workspace" lixpi/setup
```

### Non-Interactive Mode (CI/Automation)

For automated environments without TTY:

```bash
docker run --rm -v "$(pwd):/workspace" lixpi/setup --non-interactive --name=john --env=local
```

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
- AWS settings
- NATS servers, keys, and passwords
- Auth0 configuration
- API keys

### `.aws/config` (Optional)

AWS SSO profile configuration for CLI access.

## Smart Presets

When you select **local** environment:
- DynamoDB endpoint defaults to `http://lixpi-dynamodb:8000`
- LocalAuth0 mock is enabled with pre-configured values
- NATS debug mode is enabled
- Pulumi uses local file storage

## Technical Details

- **Runtime**: Node.js 23 with native TypeScript (`--experimental-transform-types`)
- **Prompts**: `@clack/prompts` for beautiful interactive CLI
- **Key Generation**: `@nats-io/nkeys` for cryptographic key pairs
- **No host dependencies**: Everything runs inside Docker
