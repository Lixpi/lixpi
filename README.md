# lixpi

Version:  0.0.2

## Preview here: https://slides.com/lixpi/lixpi-ai-bridge-tech-preview/fullscreen

## Quick Start

### 1. Environment Setup

Run the interactive setup wizard to generate your `.env` file.

```bash
# macOS / Linux
./init.sh

# Windows
init.bat
```

Or run Docker commands directly:

```bash
# macOS / Linux
docker build -t lixpi/setup infrastructure/init-script && docker run -it --rm -v "$(pwd):/workspace" lixpi/setup

# Windows (CMD: use %cd%, PowerShell: use ${PWD})
docker build -t lixpi/setup infrastructure/init-script && docker run -it --rm -v "%cd%:/workspace" lixpi/setup
```

For CI/automation (non-interactive), see [`infrastructure/init-script/README.md`](infrastructure/init-script/README.md).

### 2. Start the Application

Run the startup script which will let you select an environment and optionally initialize the database:

```bash
# macOS / Linux
./start.sh

# Windows
start.bat
```

---

## Mock Authentication for Local Development

LocalAuth0 provides zero-config Auth0 mocking for offline development.

**Configuration:** Set `VITE_MOCK_AUTH=true` in your `.env` file (default in local environment)

**Default user:** `test@local.dev` / `local|test-user-001`

See [`services/localauth0/README.md`](services/localauth0/README.md) for details.

---

## Running the Project

To run the project:


Then you can run the whole application with the following command:

```shell
docker-compose --env-file .env.<stage-name> up
```

Debugging:

**TODO: specify the correct script:** To debug markdown stream parser run the:

```shell
docker exec -it lixpi-web-ui pnpm debug-markdown-stream-parser
```

# Build and run individual services

## Web UI

```shell
# remove all previous builds including dangling images and force re-build and run
# unix
./rebuild-containers.sh lixpi-web-ui

# Then run single service
docker-compose --env-file .env.<stage-name> up lixpi-web-ui

# Copy node_modules from the container to the host so that TypeScript types would be available to the IDE type checker
docker cp lixpi-web-ui:/usr/src/service/node_modules ./services/web-ui
```

## API

```shell
# remove all previous builds including dangling images and force re-build and run
# unix
./rebuild-containers.sh lixpi-api

# Then run single service
docker-compose --env-file .env.<stage-name> up lixpi-api

# Copy node_modules from the container to the host so that TypeScript types would be available to the IDE type checker
rm -Rf ./services/api/node_modules/@lixpi
docker cp lixpi-api:/usr/src/service/node_modules ./services/api

rm -Rf ./services/api/node_modules/@lixpi && mkdir ./services/api/node_modules/@lixpi
cp -r packages/lixpi/* ./services/api/node_modules/@lixpi
```

## LLM API

```shell
# remove all previous builds including dangling images and force re-build and run
# unix
./rebuild-containers.sh lixpi-llm-api

# Then run single service
docker-compose --env-file .env.<stage-name> up lixpi-llm-api
```

**Note:** Before running the LLM API service, ensure you have generated NKey credentials:

```shell
# Generate LLM service NKey user credentials (NOT account!)
docker exec -it lixpi-nats-cli nsc generate nkey --user

# Add the seed to your .env file as NATS_LLM_SERVICE_NKEY_SEED
# Add the public key to your .env file as NATS_LLM_SERVICE_NKEY_PUBLIC
```


##### Pulumi

We use Pulumi to manage our infrastructure code.

First you have to create twp *S3* buckets with the following names
 - `lixpi-pulumi-<your-name>-local`    // For local development
 - `lixpi-pulumi-<your-name>-dev`      // For dev deployments

To rebuild Pulumi container from scratch run:
```shell
./rebuild-containers.sh lixpi-pulumi
```

To run Pulumi:
```shell
docker-compose --env-file .env.<stage-name> up lixpi-pulumi
```


# Deploying to prod:

To build Web-ui

```shell
docker exec -it lixpi-web-ui pnpm build
```




Credits:

CSS Spinners: https://cssloaders.github.io/

