---
title: Internal Service NATS Authentication
description: Service identities, scoped NATS permissions, native NKey clients, and credential deployment.
---

# Internal Service NATS Authentication

Internal clients authenticate through the [embedded Go broker](../../services/nats/README.md) using registered NKey public keys. They do not need Auth0. The API, conversion worker, fidelity worker, backup CLI, operator tools, NEX, and optional model registry have distinct identities.

## Choose the credential path

TypeScript and Python `NatsService` clients sign a self-issued JWT using their user NKey seed. Its `iss` is the public key and its `sub` must exactly match the registered service ID. The auth responder verifies the signature and token time claims locally, then returns the registration's complete permissions.

Native NATS clients such as NEX and the backup CLI sign the broker's nonce. Their raw `nkey` and `sig` fields are verified against the same registration. The broker advertises a nonce for native NKey authentication without needing a static entry for each application key. The signed registration determines whether the presented key is admitted.

`nkeySeed` in Lixpi's TypeScript wrapper selects the self-issued JWT path. It is not the bootstrap authenticator. The embedded dispatcher holds `NATS_CALLOUT_PASSWORD` and enters CALLOUT through an in-process connection. External connections cannot use that bootstrap identity.

## Built-in identities

| Environment prefix | Identity | Account | Operations |
|---|---|---|---|
| NATS_API | svc:api | AUTH | API handlers, relays, storage, internal requests |
| NATS_FILE_CONVERSION | svc:file-conversion | AUTH | Conversion requests and Object Store reads/writes |
| NATS_CHARACTER_FIDELITY | svc:character-fidelity | AUTH | Fidelity requests and Object Store reads |
| NATS_BACKUP | svc:backup | AUTH | Stream discovery, information and snapshots |
| NATS_OPERATOR | svc:operator | AUTH | Storage inspection, repair and restore |
| NATS_NEX_NODE | svc:nex-node | NEX | NEX control plane and its JetStream domain |
| NATS_AI_MODEL_REGISTRY | svc:ai-model-registry | AUTH | Model-sync completion event |

Each prefix has a `_NKEY_SEED` held by its client and a `_NKEY_PUBLIC` included in the application registration. The init wizard generates the built-in service keys. Permission declarations live in [the shared service contracts](../../packages/lixpi/nats-subject-registry/src/service-permissions.ts). The [registration builder](../../packages/lixpi/nats-subject-registry/src/registration.ts) binds them to deployment configuration and signs the manifest. API startup applies it before connecting. Keep AUTH storage and NEX placement unchanged when rotating credentials.

## Add a deployment-owned service

Generate a user NKey pair using the Dockerized environment setup or an approved containerized NKey tool. Keep the seed in the client's deployment secrets. Supply the public half and a unique service ID to `NATS_SERVICE_AUTH_REGISTRATIONS` in deployment configuration, then save the environment through [init-config's normal partial-update flow](../../infrastructure/init-script/README.md). That save prepares the signed manifest for API startup.

A registration declares its application account and complete publish/subscribe grants. Deployment configures the authority's permitted accounts; the broker creates them at startup. SYS, CALLOUT and REGISTRATION cannot be application targets. A separate application's initializer can submit its own signed manifest using a separately configured authority.

For a portal module, use concrete module subjects such as `portal.module.example.*.request.>`, its corresponding event subtree, and `_INBOX.example-service.>`. The signer is responsible for choosing the least access the service needs; the broker validates NATS subject syntax and the signer's account scope. A responder can use `resp: { max: 1, ttl: 10000000000 }` for a single temporary reply within ten seconds. Browser inboxes remain scoped independently to their authenticated identity. See [the parser contract](../platform/AUTHENTICATION.md#additional-service-registrations).

Initialize a TypeScript client with its seed and matching ID:

```typescript
await NatsService.init({
    servers: process.env.NATS_SERVERS!,
    name: 'example-service',
    nkeySeed: process.env.NATS_EXAMPLE_NKEY_SEED!,
    userId: 'svc:example-service',
    inboxPrefix: '_INBOX.example-service',
    subscriptions,
})
```

The Python wrapper uses `nkey_seed`, `user_id`, and `inbox_prefix` for the equivalent configuration. See the [shared transport](../../packages/lixpi/nats-service/README.md) and [verifier](../../packages/lixpi/auth-service/README.md).

Pass client secrets only to their runtime. A service initializing its own registration also receives an approved signed payload and the restricted bootstrap password, never the authority signing seed. New JWT clients do not need a static broker user. Native NKey clients also need the broker's nonce support. Review the full permission path, including replies, stream management, consumer flow control, and Object Store subjects, before deploying.

## NEX artifacts

Local private-repository NEX workloads use `file://` artifacts from the shared volume at `/opt/nex/private-workloads`. In NEX 0.4.1, the artifact fetcher's `UserJWTAndSeed` credential path does not present the `auth_token` or raw NKey challenge fields consumed by this callout. Do not switch those artifacts to `nats://` without separately validating the credential path.

The NEX node uses its own native seed. Conversion and fidelity workloads receive their separate AUTH-account seeds through start-request environment injection; they do not use the node credential for application Object Store access.

## Backup and operator CLI

Use `nats --nkey <seed-file>` with a restrictive temporary file, remove it on exit, and keep seeds out of arguments and logs. Backup uses `NATS_BACKUP_NKEY_SEED`; restore and API debug tools use `NATS_OPERATOR_NKEY_SEED`. Backup can snapshot streams but cannot restore or delete them. Operator permissions include the restore upload subjects.

The deployed Go image provides `lixpi-nats backup` and `lixpi-nats restore <snapshot-id>` with seeds held in memory. The [cluster guide](../platform/deployment/NATS-CLUSTER.md) describes inventory and recovery checks; the [Go guide](../code-quality/testing/GO.md) documents isolated native-client and snapshot tests.

## Availability and rotation

Each broker tries its local worker first and retries compatible peers on operational failure within the original admission deadline. After the first manifest commits, API downtime does not prevent admission. An empty registry needs its application initializer, and an unavailable registry leader prevents new admissions. Explicit credential denial is terminal. Existing connections retain their issued permissions when workers become unavailable; loss of the accepting broker requires client reconnect.

The wrapper creates a one-hour input JWT when applying authentication. This is not an hourly renewal of an established NATS session. The callout's issued user JWT has no expiry, and this implementation does not disconnect clients when policy changes.

Rotate a client seed and its public registration together, and verify a fresh connection before retiring the previous identity. Plan any revocation of already established sessions separately. Auth0 outages affect browser admissions that need an unavailable key; local service verification remains independent.

## Decentralized NATS credentials

An operator/account-JWT resolver is a possible separate infrastructure design. It would require account JWTs, standard client credentials, a resolver, rotation procedures, and review of cross-account exports/imports. It is not part of the embedded callout implementation.

## History

The removed Python `services/llm-api` was an early consumer of self-issued service JWTs. Its workflow runs in-process in the TypeScript API. The transport's Python implementation remains a reference for independent Python clients; Git history retains the original integration.
