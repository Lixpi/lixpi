---
title: NATS Service Configuration
description: Which inputs each NATS command needs, why the credentials differ, and how files and volumes reach the broker.
---

# NATS Service Configuration

The inputs depend on the command. A serving broker needs authentication configuration, its data volume and TLS files. A backup client needs a NATS address, its own identity and a snapshot directory. It does not need the broker's issuer keys or TLS installation directory. A restore client uses a separate operator identity because it creates stream state in the target account.

For `serve`, [serve.go](../cmd/lixpi-nats/serve.go) reads the environment and prepares identity and certificate paths before parsing [nats-server.conf](../nats-server.conf). The configuration file defines listeners, accounts, JetStream and clustering. The Go runtime then attaches auth callout, placement tags and its TLS callback. [Docker Compose](../../../docker-compose.yml) and [the Pulumi NATS resource](../../../infrastructure/pulumi/src/resources/NATS-cluster/NATS-cluster.ts) supply the values for their environments.

The tables below describe the executable's inputs. If you change one of those inputs in code, update the Compose and deployment callers too; editing this reference alone does not configure a running container.

## Commands

The production entrypoint is `/usr/local/bin/lixpi-nats`. These are arguments to that executable inside its container:

| Command | Behavior |
|---|---|
| `serve` or no subcommand | Start the embedded broker and its admission runtime |
| `serve --config <path>` | Read an alternative broker configuration; default `/opt/nats/nats-server.conf` |
| `serve --routes <urls>` | Add comma-separated route URLs to those in the configuration |
| `serve -t` | Run startup prerequisites and validate configuration without starting the broker |
| `health live`, `health broker`, `health ready` | Probe the existing local HTTP listener; `health` defaults to `broker` |
| `fence enable`, `fence disable` | Change persistent placement fencing through the local Unix socket |
| `backup` | Snapshot AUTH streams into `NATS_SNAPSHOT_DIR` using the backup identity |
| `restore [snapshot-id]` | Restore a completed snapshot; an omitted ID reads `LATEST` |

`serve -t` catches configuration and startup-input failures before opening listeners. It resolves identity and installs a validated certificate, so it writes to the identity and TLS directories. Use disposable paths and credentials for a validation fixture. The executable implements the command surface above; upstream `nats-server` flags are not automatically available through it.

## Admission credentials and registration trust

The broker verifies application identities against signed runtime registrations. It needs the authority public keys and their scope at startup, but it does not need application public keys, subject lists or browser issuer settings in its environment.

| Setting | Contract |
|---|---|
| `NATS_AUTH_NKEY_ISSUER_SEED`, `NATS_AUTH_NKEY_ISSUER_PUBLIC` | Matching account key pair for signing callout responses |
| `NATS_AUTH_XKEY_ISSUER_SEED`, `NATS_AUTH_XKEY_ISSUER_PUBLIC` | Matching curve key pair for encrypted callout traffic |
| `NATS_CALLOUT_PASSWORD` | Password for in-process dispatcher/store identities and authenticated health probes |
| `NATS_REGISTRATION_AUTHORITIES` | Required JSON array of `{publicKey, owner, accounts}`; publicKey is a registration authority account NKey |
| `NATS_REGISTRATION_PASSWORD` | Required password for the restricted network registration user |
| `NATS_REGISTRATION_REPLICAS` | Registry stream replication factor, default 3; accepted range 1 through 5 |
| `NATS_AUTH_WORKERS` | Local verifier capacity, default 16; accepted range 1 through 1,024 |
| `ENVIRONMENT` | `local` permits HTTP browser issuer/JWKS URLs and the documented local certificate exception |

An authority can register only its configured owner and accounts. The runtime creates those application accounts with JetStream enabled. It rejects names already declared in the base broker configuration, so define application accounts through trust configuration instead of duplicating them in the file. SYS, CALLOUT, REGISTRATION and the global account cannot be application targets.

The registration signing seed belongs to deployment tooling. Never pass `NATS_REGISTRATION_AUTHORITY_SEED` to a serving broker or API. Lixpi's environment wizard generates that key and derives `NATS_APPLICATION_REGISTRATION`, the signed payload delivered by API startup. The API receives that payload and the bootstrap password. Ordinary workers receive only their own service seeds.

## Registration protocol

A bootstrap client connects as `registration` with the bootstrap password and `_REGISTRATION_REPLY` as its inbox prefix. It requests `$TRANSPORT.REGISTRATION.APPLY` with this shape:

```json
{
  "registration": {
    "issuer": "<authority public account NKey>",
    "payload": "<base64 of original UTF-8 manifest JSON>",
    "signature": "<base64 Ed25519 signature over those exact bytes>"
  },
  "expectedRevision": 0
}
```

The response contains `revision`, or `error` and the latest readable revision. An initial create uses revision zero. On `registration revision conflict`, retry the same approved payload with the returned revision. A version error requires a newly signed manifest; changing the compare-and-swap revision cannot bypass it. The shared [registration client](../../../packages/lixpi/nats-service/ts/registration.ts) handles bounded conflict retries.

The signed payload has `schema: 1`, `owner`, a positive safe-integer `version`, `services` and `browsers`. A service contains `userId`, `publicKey`, `account` and `permissions`. A browser profile contains `issuer`, `audience`, `jwksUrl`, `account` and a `permissions` template array.

Each publish and subscribe direction must have an explicit allow list or `deny: [">"]`. NATS wildcards are allowed because the signer, rather than the broker, owns the application's authorization choices. The broker validates NATS syntax and the authority's account scope. Service response overrides accept a positive `max` up to 1,024 and a positive `ttl` up to ten seconds in nanoseconds. Browser templates cannot grant response overrides. Requests and aggregate registry state are each limited to 1 MiB.

Browser issuer and JWKS URLs require HTTPS outside local mode. A profile must declare its audience and permissions. The verifier fetches keys only when a connecting token needs an uncached key. No issuer is hardcoded into the broker, and readiness does not depend on a provider being reachable.

For signing-key rotation, configure both authority public keys for the same owner, submit a higher version signed by the replacement, and then remove the old public key. Removing a key while its manifest remains stored makes that manifest unverifiable and blocks admissions. [Operations](OPERATIONS.md) covers durable state and recovery.

## Broker identity, listeners and storage

The node's name identifies the broker reopening a data volume. Its placement zone tells JetStream which replicas share a failure domain. Its advertised address tells native clients and route peers how to reach it. These are separate values: a persistent name should survive container replacement, while a replacement host may need a different reachable IP.

| Setting | Default or behavior |
|---|---|
| `NATS_CLUSTER_NAME` | Required by the supplied cluster configuration |
| `NATS_SERVER_NAME` | Explicit node name; otherwise `NATS_SERVER_NAME_BASE` plus hostname |
| `NATS_SERVER_NAME_BASE` | `Lixpi-NATS` |
| `NATS_PERSIST_SERVER_NAME` | `true` persists/reuses `server-name` in the store; enabled by the deployment |
| `NATS_STORE_DIR` | `/data/jetstream` |
| `NATS_PLACEMENT_ZONE` | Placement failure-domain tag; hostname fallback |
| `NATS_ADVERTISE_IP` | Optional explicit IP advertised to native clients and route peers |
| `NATS_NODE_CONFIG_FILE` | Optional JSON file containing `zone` and `advertiseIP`; when supplied, both are required and override their environment equivalents |
| `NATS_JETSTREAM_UNIQUE_TAG` | `az:` |
| `NATS_MAX_MEMORY_STORE` | `256M`; a JetStream memory-store limit, not total process memory |
| `NATS_WEBSOCKET_ADVERTISE` | `localhost:9222`; deployment supplies its public listener address |
| `NATS_ALLOWED_ORIGINS`, `NATS_SAME_ORIGIN` | `[]` and `false`; deployment supplies allowed public origins |
| `NATS_DEBUG_MODE`, `NATS_TRACE_MODE` | `false`; protocol trace/verbose trace is rejected at startup |
| `NATS_HEALTH_ADDRESS` | `0.0.0.0:3020`; keep port 3020 for the bundled `health` command and deployed discovery probe |
| `NATS_CONTROL_SOCKET` | `/run/lixpi-nats/control.sock`; serve and fence must agree |
| `GOMEMLIMIT` | Deployment supplies `768MiB`; a Go runtime target, not a hard container memory limit |

The supplied configuration listens on native TCP 4222, cluster routes 6222, monitoring 8222 and WebSocket TLS 443. Native clients and routes have no TLS configured. Local Compose publishes WebSocket 443 as 9222. The JetStream domain is `lixpi`, the file-store limit is `100G`, and `sync_interval` is `always`; those are configuration-file values rather than environment overrides.

The service reads its advertised IP and placement zone from configuration, without querying instance metadata. A deployment can deliver them together through `NATS_NODE_CONFIG_FILE`, for example:

```json
{"zone":"rack-a","advertiseIP":"192.0.2.10"}
```

That address is illustrative. Supply an address reachable by the intended clients and peers, and a zone representing the host's actual failure domain. The hostname fallback is useful for a local container cluster but cannot establish physical fault isolation.

With name persistence enabled, a saved name overrides a changed `NATS_SERVER_NAME` on the same disk. Normal placement tags are `server:<name>` and `az:<zone>`. A persisted scale-in fence removes those tags until retirement is cancelled or completed. [Deployment](../../../documentation/platform/deployment/NATS-CLUSTER.md) explains who supplies the node configuration and controls that fence.

## Certificates

The broker consumes a certificate; it does not obtain or renew one from an issuer. Mount the delivered PEM chain and private key as readable source files. Give `NATS_TLS_ROOT` a separate writable location so the broker can validate, install and roll back its own certificate versions without altering the delivered files.

| Setting | Default or behavior |
|---|---|
| `NATS_CERT_FILE` | Required readable PEM certificate chain file |
| `NATS_KEY_FILE` | Required readable PEM private key file |
| `NATS_CA_FILE` | Optional readable PEM trust-root file; system roots otherwise |
| `CERT_DOMAIN` | `localhost` for runtime hostname validation; deployment supplies its public hostname |
| `NATS_TLS_ROOT` | `/etc/nats-tls`; writable installed versions and `current` symlink |
| `CERT_MIN_VALIDITY_SECONDS` | 86,400; nonnegative minimum remaining lifetime |
| `CERT_REFRESH_INTERVAL_SECONDS` | 60; accepted range 1 through 86,400 |

`CERT_DOMAIN` must match the certificate's hostname. `NATS_CA_FILE` supplies trust roots when the issuer is not covered by the system roots. Only `ENVIRONMENT=local` without an explicit CA permits an untrusted development certificate; the key match, hostname and validity checks still apply. With an explicit CA, even local mode checks the chain against it.

The source paths and installed paths are different. Before parsing the NATS configuration, Go sets `NATS_TLS_CERT` and `NATS_TLS_KEY` to `current/server.crt` and `current/server.key` under `NATS_TLS_ROOT`. Operators supply `NATS_CERT_FILE` and `NATS_KEY_FILE`; they do not need to maintain the internal version directories themselves. A source replacement becomes active only after the validation and live-listener checks described in [Operations](OPERATIONS.md#certificate-refresh).

The refresh interval controls how often files are checked. Minimum validity controls whether a candidate is acceptable. Neither setting causes a certificate to be renewed: issuance and file delivery must happen outside the broker.

## Backup and restore

These commands connect to `NATS_URL`; they do not read another container's live JetStream files. The backup identity can capture account snapshots. The operator identity is used for restore because restoring creates streams and consumers. Give each invocation only the seed for its operation.

| Setting | Contract |
|---|---|
| `NATS_URL` | Required target native NATS URL |
| `NATS_BACKUP_NKEY_SEED` | Required for `backup` |
| `NATS_OPERATOR_NKEY_SEED` | Required for `restore` |
| `NATS_SNAPSHOT_DIR` | Required mounted directory for completed snapshots and `LATEST` |
| `NATS_BACKUP_SCRATCH` | `/tmp`; must have space for the staged snapshot |
| `NATS_MAINTENANCE_INBOX` | Reply prefix; defaults to `_INBOX.<hex of the command identity's public NKey>` and must be covered by that identity's registered subscribe permissions |

`NATS_BACKUP_SCRATCH` holds staged files during capture or restore. `NATS_SNAPSHOT_DIR` holds the completed backup sets and their `LATEST` pointer. They can be on the same filesystem, but capacity planning must include both copies. A temporary directory inside a disposable container is not retained storage; mount the completed-snapshot directory or copy its completed contents out before removing that container.

`DirectoryStore` confines paths to the selected directory and replaces individual files atomically. External tooling can move completed snapshots off-host and deliver them to a recovery container. Neither command needs provider credentials. [Operations](OPERATIONS.md#native-backups) explains the completion markers, the empty-target requirement and what an AUTH-account snapshot includes.
