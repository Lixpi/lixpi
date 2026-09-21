---
title: Go Testing and Tooling
description: Container-only Go builds, tests, dependency maintenance, formatting, and linting.
---

# Go Testing and Tooling

The Go modules live in the [NATS service](../../../services/nats/README.md) and [Caddy certificate service](../../../services/caddy/README.md). Every Go command runs inside Docker. The one-shot test and quality runners follow the TypeScript runners' layout: source and manifests are mounted separately, the module root belongs to the disposable container, and downloaded modules and compiled packages live in named Docker volumes. There is no host module cache, tool installation, or generated binary. Tests mount source read-only. Quality fixes write to the mounted source directories. The test image includes the NATS CLI from `natsio/nats-box` using its default `latest` tag solely for bidirectional snapshot-format verification; production uses Go APIs directly.

Read the [`code-quality` skill](../../../skills/code-quality/SKILL.md) before writing or running tests. Tests require an explicit request in the active task. Use colocated `*_test.go` files and the standard `testing` package. Use table-driven tests when several inputs or cases exercise the same behavior and setup; use named subtests so a failure identifies the case. Keep a direct test when a table would hide the behavior or require case-specific control flow.

Use temporary storage, generated test credentials, and disposable embedded brokers. Tests must not connect to application brokers or AWS. Bound waits with contexts or deadlines and close connections and servers through `t.Cleanup`. Exercise observable authentication and messaging behavior, including denial and timeout paths.

Build the runners from the repository root:

```bash
docker compose -f docker-compose.go-test-runner.yml --profile dev build
docker compose -f docker-compose.go-quality-runner.yml --profile dev build
```

Run the complete Go suite with the Linux race detector, or select a package and test:

```bash
docker compose -f docker-compose.go-test-runner.yml --profile dev run --rm --no-deps -T lixpi-go-test-runner nats
docker compose -f docker-compose.go-test-runner.yml --profile dev run --rm --no-deps -T lixpi-go-test-runner nats -run TestEmbeddedBrokerInProcessRoundTrip ./internal/broker
```

The root Compose file includes both runners. Using their standalone Compose files avoids loading application credentials and starting application services. Each invocation gets a generated name and the current mounts. The compiler's module and build caches support concurrent access; lint containers use their separate cache.

After editing imports or dependency versions, reconcile `go.mod` and `go.sum` inside the quality container. The `dependencies` action copies manifests into its disposable module root, runs `go mod tidy`, and copies just those two files back. Normal tests and lint use readonly module resolution.

The normal [init-config create/update flow](../../../infrastructure/init-script/README.md) signs application permissions when it saves the environment file. The Go image contains no generated application permission artifact.

```bash
docker compose -f docker-compose.go-quality-runner.yml --profile dev run --rm --no-deps -T lixpi-go-quality-runner nats dependencies
docker compose -f docker-compose.go-quality-runner.yml --profile dev run --rm --no-deps -T lixpi-go-quality-runner nats fix
docker compose -f docker-compose.go-quality-runner.yml --profile dev run --rm --no-deps -T lixpi-go-quality-runner nats validate
```

`fix` runs the AST-based source convention fixes, `gofumpt`, `goimports`, `golines`, and `golangci-lint run --fix`; it is required during implementation. The linter mirrors the compatible TypeScript conventions for modern APIs, explicit command output, structured logging, control-flow spacing, and `//` comments. An assignment stays attached to a following validation `if` when its condition reads an assigned value. Go syntax that has no TypeScript equivalent stays under the Go formatter and compiler. `validate` checks formatting and lint without editing source. A formatting diff exits nonzero before lint runs. [The version registry](../../../versions-registry/README.md) supplies the tools and base image versions generated into the runner Dockerfiles.

For module-source inspection or an additional compiler command, override the test runner entrypoint with `--entrypoint sh`. Keep source read-only and outputs under `/tmp` or the existing Docker cache paths. Production and development image targets are built with `docker build -f services/nats/Dockerfile --target embedded-runtime -t lixpi/nats-embedded .` and the same command with `--target development -t lixpi/nats-development`. Tool inventory runs inside the development image using `docker run --rm --entrypoint sh lixpi/nats-development -c 'go version && gopls version && dlv version && golangci-lint version'`.

For an isolated production-image check, `TestContainerFixture` exports synthetic credentials and local TLS material into an explicitly mounted output directory. It also validates the production configuration through the serve command. This fixture must never target an application data volume. Run it with `docker compose -f docker-compose.go-test-runner.yml --profile dev run --rm --no-deps -T -e NATS_TEST_FIXTURE_DIR=/fixture -v /private/tmp/lixpi-nats-embedded-proof:/fixture lixpi-go-test-runner nats -run TestContainerFixture ./cmd/lixpi-nats`. Create the empty host output directory first; generation itself happens in Docker. Start `lixpi/nats-embedded` with that directory's `environment` file, mount the directory read-only at `/fixture`, use a separate named data volume, and publish no host ports. Run `docker exec <proof-container> /usr/local/bin/lixpi-nats health ready` to verify admission starts even though the fixture's JWKS endpoint is unavailable. Remove only the proof container and its disposable volume when finished.

The production configuration requires cluster routes for JetStream. Create a private `lixpi-nats-embedded-proof` network and three containers named `lixpi-nats-embedded-proof`, `lixpi-nats-embedded-proof-2` and `lixpi-nats-embedded-proof-3`. Give each its own data volume and `NATS_SERVER_NAME`, and pass all three synthetic `nats://sys:synthetic-system@<name>:6222` routes to each container. The fixture contains no real credentials.

Use the optional `docker-compose.go-integration.yml` override to attach the test runner to this network. Set `NATS_TEST_CLIENT_FIXTURE=/fixture` and `NATS_TEST_TARGETS=nats://lixpi-nats-embedded-proof:4222,nats://lixpi-nats-embedded-proof-2:4222,nats://lixpi-nats-embedded-proof-3:4222`, and mount the generated fixture read-only at `/fixture`. Run `nats -v -run 'TestContainerServicePermissions|TestContainerNativeBackupRestore|TestContainerAdmissionBurst' ./cmd/lixpi-nats`. The tests reject target names outside this disposable namespace. `NATS_TEST_PHASE=seed` keeps the replicated object-store payload for a restart check; `verify` reads it after restart and removes the test bucket. Burst output reports local Docker timing and failures; it is not an EC2 capacity estimate.

The TypeScript runtime test uses the same isolated brokers and synthetic authority to submit the application's actual declaration format. It verifies native JavaScript NKey connections, browser JWTs, request/reply permissions on every broker, and rejection of a tampered declaration:

```bash
docker compose -f docker-compose.typescript-test-runner.yml -f docker-compose.go-integration.yml --profile dev run --rm --no-deps -T \
  -e NATS_REGISTRATION_TEST_TARGETS=nats://lixpi-nats-embedded-proof:4222,nats://lixpi-nats-embedded-proof-2:4222,nats://lixpi-nats-embedded-proof-3:4222 \
  -e NATS_TEST_CLIENT_FIXTURE=/fixture \
  -v /private/tmp/lixpi-nats-embedded-proof:/fixture:ro \
  lixpi-typescript-test-runner api src/NATS/runtime-registration.runtime.test.ts
```

Run this after the Go production-image tests. It installs a higher manifest version, so the original Go fixture cannot replace it afterward. Recreate the disposable data volumes and fixtures before starting that sequence again. The test starts its JWKS responder inside the runner container and publishes no host ports. Remove the three proof containers, their data volumes and the private proof network when finished.

## Caddy certificate service

The `caddy` domain uses the same Go runners and isolated caches. It tests a real embedded internal CA with temporary storage, synthetic X.509 chains and AWS client substitutes. Tests must not issue public certificates or contact AWS. Production-image checks use a disposable certificate directory, never the application's `caddy-certs` volume.

```bash
docker compose -f docker-compose.go-quality-runner.yml --profile dev run --rm --no-deps -T lixpi-go-quality-runner caddy dependencies
docker compose -f docker-compose.go-quality-runner.yml --profile dev run --rm --no-deps -T lixpi-go-quality-runner caddy fix
docker compose -f docker-compose.go-quality-runner.yml --profile dev run --rm --no-deps -T lixpi-go-quality-runner caddy validate
docker compose -f docker-compose.go-test-runner.yml --profile dev run --rm --no-deps -T lixpi-go-test-runner caddy
docker build -f services/caddy/Dockerfile --target embedded-runtime -t lixpi/caddy-embedded .
docker build --platform linux/amd64 --provenance=false -f services/caddy/Dockerfile --target embedded-runtime -t lixpi/caddy-lambda-proof .
```

To check the production image, create an empty `/private/tmp/lixpi-caddy-proof` directory and run `docker run --rm --network none --read-only --tmpfs /tmp -v /private/tmp/lixpi-caddy-proof:/certificates lixpi/caddy-embedded local`. Run it twice to exercise the persisted CA and certificate. Check its version with `docker run --rm --network none lixpi/caddy-embedded version`. The image has no shell, so use the Go test runner for any further certificate inspection.

## GitHub Actions

The `CI` workflow has a Go section with independent `go-quality`, `go-tests`, and `go-build` matrices for `nats` and `caddy`. Their status names begin with `Go /`. Quality validation and race-enabled tests each build and invoke their own Docker runner. The build jobs build each service's production Go image. These jobs run independently of the TypeScript matrices, and every job must succeed for `Required CI gate` to pass. A failed, cancelled, or skipped job fails that gate.
