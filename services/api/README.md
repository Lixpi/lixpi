
# API

The [version registry](../../dev-tools/versions-registry/README.md) supplies Node.js, pnpm, and package versions. Edit the central values and synchronize the native declarations before rebuilding this image.

Organization Blob bytes live in native NATS Object Store buckets named `blobs-<organization>-files`. Document steps, pipeline events, Capability run events and maintenance jobs use native JetStream streams and consumers. The API uses `@lixpi/nats-service` directly for object reads/writes, event publication and replay. Domain metadata remains in DynamoDB. See [Data Storage](../../documentation/platform/DATA-STORAGE.md) for the data model and [NATS Cluster](../../documentation/platform/deployment/NATS-CLUSTER.md) for replication, retained volumes, snapshots and recovery.

The native storage acceptance test exercises API Blob writes, event sequencing, replay and workqueue acknowledgements against a disposable NATS broker. Commands and isolation requirements are in the [TypeScript testing guide](../../documentation/code-quality/testing/TYPESCRIPT.md).

Provider calls use `ProviderUsageClient` for pre-call authorization and measured-usage recording. The NATS subject and JSON contracts are documented in [`@lixpi/usage-reporter`](../../packages/lixpi/usage-reporter/README.md) and require a paired responder release.

`organization.membership.get` is a service-only NATS request that accepts `{ token, organizationId }`. The JWT middleware verifies this token freshly on every request and replaces any supplied user identity with the verified subject. A strongly consistent organization read returns only `{ organizationId, userId, name, accessLevel }` for the caller's own membership. Missing members, invalid tokens, and unavailable data fail closed. The responder has no browser permission grant and never returns an access list.

The API's JWT middleware requires an application token on NATS requests. Connection admission belongs to the embedded Go broker in `services/nats`; the API has no callout subscription or middleware exemption. It connects as `svc:api` using `NATS_API_NKEY_SEED` after applying the signed application manifest through a separate restricted bootstrap connection. Startup receives `NATS_APPLICATION_REGISTRATION` and `NATS_REGISTRATION_PASSWORD`; the authority signing seed and callout issuer/decryption seeds remain outside the API. Registration failure aborts startup before the application connection opens.

`@lixpi/nats-subject-registry` defines the active endpoint groups, their `permissions`, and built-in service permissions. Contract IDs and handler-map keys come from `getNatsSubjectPath()` in `@lixpi/constants`; subject names and wire values are declared only in the constants package. `createNatsSubscriptions()` in `create-nats-subscriptions.ts` creates subscriptions from these declarations and their handlers, rejecting missing or extra handlers. Deployment setup signs the registry's declarations and configured identities. API startup submits those approved bytes before creating subscriptions. Refresh the signed manifest when endpoint grants or service identities change; the Go broker image is independent of the application contract.

The local authentication integration test uses the running API, embedded NATS cluster, and LocalAuth0. It rejects invalid connection credentials, connects with a fresh local token and user-scoped inbox, rejects missing/invalid request tokens, and reads the authenticated user's profile. It uses TCP NATS and does not inspect a browser. With those local services running and tests explicitly authorized, run:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T -e LIXPI_NATS_RUNTIME_TEST=true lixpi-typescript-test-runner api src/NATS/middleware/nats-auth-middleware.runtime.test.ts
```

The test is skipped during ordinary unit-test runs.

Browser permissions are supplied to the auth callout separately from responder registration. Generic module requests and events use the authenticated user's hex token. Both browser applications also configure `_INBOX.<user-token>` as their reply prefix. Deployment setup incorporates `NATS_SERVICE_AUTH_REGISTRATIONS` into the signed runtime manifest; see [Authentication](../../documentation/platform/AUTHENTICATION.md).
