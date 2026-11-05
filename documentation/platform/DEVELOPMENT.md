---
title: Development Guide
description: Local development quick start for Lixpi — environment setup, infrastructure init, running services, local auth, and Pulumi.
---

# Development Guide

This guide gets Lixpi running locally. Everything runs in **Docker** via Docker Compose — you do not install Node, pnpm, or Pulumi on the host. For what each service is and how they fit together, see [System Architecture](SYSTEM-ARCHITECTURE.md); for AWS deployment, see [Infrastructure Overview](deployment/INFRASTRUCTURE-OVERVIEW.md).

## Services at a glance

| Service | Path | Purpose |
|---------|------|---------|
| **web-ui** | `services/web-ui/` | TypeScript SPA — canvas, ProseMirror editors, AI chat UI |
| **web-ui-user-portal** | `services/web-ui-user-portal/` | TypeScript account-management SPA with Gentelella UI on `http://localhost:3002` |
| **api** | `services/api/` | Node.js / TypeScript gateway — auth, CRUD, DynamoDB, plus the in-process LangGraph LLM workflow (pipeline events, ProseMirror transcript steps, image generation, video generation) |
| **nats** | `services/nats/` | NATS message bus (3-node cluster) |
| **localauth0** | `services/localauth0/` | Mock Auth0 for zero-config offline dev (Rust — vendored `primait/localauth0` image) |
| **ai-model-registry** | `services/ai-model-registry/` | Development-only provider model and parameter registry; all administration runs inside `lixpi-ai-model-registry` |

See [System Architecture](./SYSTEM-ARCHITECTURE.md) for the full service responsibilities and the NATS backbone, and [Authentication](./AUTHENTICATION.md) for the auth model.

The [AI Model Registry](../../services/ai-model-registry/documentation/AI-MODEL-REGISTRY.md) defines the mandatory synchronization contract for provider model and parameter changes. Its registry API and maintenance tools run only inside the registry container.

## Quick Start

### 1. Environment setup

Run the interactive setup wizard to generate your `.env.<stage-name>` file:

Run `./run.sh` and choose **Create or edit a configuration**.

For CI/automation (non-interactive), see [`dev-tools/config-utils/README.md`](../../dev-tools/config-utils/README.md).

The shared configuration runner writes the ignored repository metadata file `env.lixpi` before the wizard starts, then creates or updates the selected `.env.<stage-name>` file. Repository-specific behavior and templates are mounted into the shared runner; the mount contract is documented in the config-utils README.

`env.lixpi` also sets `CODING_AGENTS_TEST_EXECUTION_MODE` and `CODING_AGENTS_TEST_LINTER_MODE`. Agents read these values before writing, modifying, or running tests and before formatting and lint checks; the [code-quality skill](${LIXPI_REPOSITORY_PATH}/skills/code-quality/SKILL.md) defines what `true`, `false`, and `auto` mean. Test-file edits have no separate permission gate when the test mode is `true` or `auto`.

### 2. Review the generated environment

The generated local environment sets `METRICS_ENABLED=false`. Enable it only when the deployed stack includes a responder for `metrics.provider.request.authorize`; otherwise the API rejects generation before it calls a model.

### 3. Initialize infrastructure

Set up TLS certificates and DynamoDB tables. This is required before starting the application for the first time:

Run `./run.sh` and choose **Initialize infrastructure**, then pick the environment file to use.

This script will:

- Start Caddy to generate TLS certificates.
- Extract and install the CA certificate into your system's trust store.
- Initialize DynamoDB tables using Pulumi.

### 4. Start the application

Run `./run.sh` and choose **Start services**. It asks which environment file to use, then shows one page with the container and service choices above the service tree. See the [dev console](../../dev-tools/dev-console/README.md).

## AWS sign-in

Containers that call AWS locally, such as `api` for Bedrock inference and `pulumi` for deployments, read your AWS SSO session from the `lixpi-aws-config` Docker volume mounted at `/root/.aws`. The profiles come from `.aws/config`, which the setup wizard writes from `dev-tools/config-utils/templates/aws-config.template`. To sign in or refresh an expired session, run `./run.sh`, choose **Sign in to AWS SSO** and pick the environment file whose `AWS_PROFILE` you want.

The login runs in the standalone `lixpi-aws-cli` container from [`infrastructure/docker/docker-compose.aws-cli.yml`](../../infrastructure/docker/docker-compose.aws-cli.yml), its own Compose project, so it never starts the application stack. The CLI prints a URL and a code, and you approve the code in the browser on your host. Restart running containers afterwards.

The volume has a fixed name rather than a Compose-project prefix, so other repositories share the same session. Their Compose files declare an `aws-config` volume named `lixpi-aws-config`, mount it at `/root/.aws`, and bind-mount this checkout's `.aws/config` over `/root/.aws/config`. They sign in by running this repository's `dev-tools/dev-console/actions/aws-sso-login.sh` with their profile name. The Pulumi image keeps its own AWS CLI because deployments need it.

## Dependency versions

Inspect a dependency update and its complete upstream release information before applying it:

```bash
docker compose -f infrastructure/docker/docker-compose.versions-registry.yml run --rm --no-deps -T versions-registry-update apply --dry-run npmPackages:typescript
docker compose -f infrastructure/docker/docker-compose.versions-registry.yml run --rm --no-deps -T versions-registry-update apply npmPackages:typescript
```

The selector can name one dependency, several dependencies, a dependency group, or `all`. The update command can cross major versions and synchronizes the committed native declarations after applying a reviewed release. To select an exact version manually, edit the type-specific JSON catalog under `dev-tools/versions-registry/`, then run:

```bash
docker compose -f infrastructure/docker/docker-compose.versions-registry.yml run --rm --no-deps -T versions-registry sync
docker compose -f infrastructure/docker/docker-compose.versions-registry.yml run --rm --no-deps -T versions-registry check
```

These commands run inside standalone Node containers without installing dependencies or starting application services. The check is read-only. Native Dockerfiles, package manifests, Go modules, and CI workflows remain usable by their ordinary tools. See [Dependency Version Registry](../../dev-tools/versions-registry/README.md) for selectors, release-note sources, generated reports, catalog ownership, and failure behavior.

## Build and run individual services

### Web UI

```shell
# Switch Containers to Rebuild and select only lixpi-web-ui
./run.sh
```

### User portal

```shell
# Switch Containers to Rebuild and select only lixpi-web-ui-user-portal
./run.sh
```

The portal is served at `http://localhost:3002`. `VITE_USER_PORTAL_URL` is required in the environment file and supplies the URL to both browser clients, so the avatar in `web-ui` opens the portal in a new tab and the portal uses the same value as its distinct OAuth redirect URI. Both clients continue to use the same identity-provider tenant, client ID, and API audience.

### API

```shell
# Switch Containers to Rebuild and select only lixpi-api
./run.sh
```

{% callout type="note" %}
Some dependencies are baked into a service's image at build time (for example, the `ffmpeg` binary in the `api` image used for video poster extraction) rather than bind-mounted. After changing a service's `Dockerfile` or its system/package dependencies, rebuild that container by running `./run.sh`, switching **Containers** to **Rebuild** and selecting only it — a plain `up` will keep running the stale image.
{% /callout %}

## Deploying to production (Web UI build)

To build the Web UI bundle inside its container:

```shell
docker exec -it lixpi-web-ui pnpm build
```

For the full AWS deployment story (Pulumi, ECS/Fargate, CloudFront, the NATS cluster), see [Infrastructure Overview](./deployment/INFRASTRUCTURE-OVERVIEW.md) and [Scaling & Operations](./deployment/SCALING-AND-OPERATIONS.md).

## Local authentication

LocalAuth0 provides zero-config Auth0 mocking for offline development — it generates RS256 keypairs, issues JWTs matching production Auth0's OAuth flows, and persists state in a Docker volume. No Auth0 account or internet connection is required.

- **Configuration:** set `VITE_MOCK_AUTH=true` in your `.env.<stage-name>` file (the default in the local environment).
- **Default user:** `test@local.dev` / `local|test-user-001`.
- **Image / language:** the Rust `public.ecr.aws/primaassicurazioni/localauth0` image (upstream [`primait/localauth0`](https://github.com/primait/localauth0)).

See [`services/localauth0/README.md`](../../services/localauth0/README.md) for endpoints, default claims, and troubleshooting, and [Authentication](./AUTHENTICATION.md) for how it fits the dual-auth model.

For tests requiring a provisioned account and provider-usage authorization, use the [hosted account configuration commands](../../dev-tools/config-utils/README.md). The account service's `documentation/platform/DEVELOPMENT.md`, under **Automated sign-in inbox**, documents SES test addresses and the Docker helper that reads Auth0 codes from S3. Use that flow before requesting manual code entry; reuse an existing test recipient when its organization and credit are required.

## Pulumi (Infrastructure-as-Code)

Pulumi manages the infrastructure, and it runs inside a Docker container — you never run `pulumi` directly on the host.

First, create two S3 buckets for Pulumi state:

- `lixpi-pulumi-<your-name>-local` — for local development
- `lixpi-pulumi-<your-name>-dev` — for dev deployments

To rebuild the Pulumi container from scratch:

```shell
docker compose --env-file .env.<stage> -f infrastructure/docker/docker-compose.yml --profile deploy build --no-cache lixpi-pulumi
```

To run Pulumi:

```shell
docker compose --env-file .env.<stage> -f infrastructure/docker/docker-compose.yml up lixpi-pulumi
```

For how the Pulumi program is structured and the full set of commands (`up`, `preview`, `destroy`, …), see [Infrastructure Overview](deployment/INFRASTRUCTURE-OVERVIEW.md).
