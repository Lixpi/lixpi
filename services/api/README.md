
# API

Provider calls use `ProviderUsageClient` for pre-call authorization and measured-usage recording. The NATS subject and JSON contracts are documented in [`@lixpi/usage-reporter`](../../packages/lixpi/usage-reporter/README.md) and require a paired responder release.

`organization.membership.get` is a service-only NATS request that accepts `{ token, organizationId }`. The JWT middleware verifies this token freshly on every request and replaces any supplied user identity with the verified subject. A strongly consistent organization read returns only `{ organizationId, userId, name, accessLevel }` for the caller's own membership. Missing members, invalid tokens, and unavailable data fail closed. The responder has no browser permission grant and never returns an access list.

The API's JWT middleware requires an application token on NATS requests. The exact `$SYS.REQ.USER.AUTH` subject delegates authentication to the auth-callout handler, which decrypts the NATS protocol payload and verifies the connecting client's credentials. Its encrypted payload has no application `{ token }` envelope. Other system subjects and application requests retain the token requirement.

The local authentication integration test uses the running API, NATS cluster, and LocalAuth0. It rejects invalid connection credentials, connects with a fresh local token and user-scoped inbox, rejects missing/invalid request tokens, and reads the authenticated user's profile. It uses TCP NATS and does not inspect a browser. With those local services running and tests explicitly authorized, run:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T -e LIXPI_NATS_RUNTIME_TEST=true lixpi-typescript-test-runner api src/NATS/middleware/nats-auth-middleware.runtime.test.ts
```

The test is skipped during ordinary unit-test runs.

Browser permissions are supplied to the auth callout separately from responder registration. Generic module requests and events use the authenticated user's hex token. Both browser applications also configure `_INBOX.<user-token>` as their reply prefix. Deployment-specific service identities enter through the validated `NATS_SERVICE_AUTH_REGISTRATIONS` JSON array; see the [auth-callout contract](../../packages/lixpi/nats-auth-callout-service/README.md).
