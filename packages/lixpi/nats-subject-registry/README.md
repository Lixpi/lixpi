# NATS subject registry

This package declares Lixpi endpoint metadata and subject permissions, and prepares signed runtime registrations from deployment configuration. API subscription creation uses the same declarations. The package does not run handlers, verify connecting clients or contact the broker.

Domain declarations live in `src/subjects/`. `src/contracts.ts` assembles and validates the selected groups, `src/types.ts` defines their shared shape, and `src/service-permissions.ts` declares service allowlists. Keep the assembly and permission machinery separate from the subject declaration files.

## Subjects and permissions

`@lixpi/constants` owns subject names and wire values. Each endpoint uses `NATS_SUBJECTS` for its subject and `getNatsSubjectPath()` for its ID. Never copy either into a separate string declaration.

An endpoint declares `type`, `payloadType`, an optional queue, and required `permissions`. Permission directions describe the connecting user: `pub` permits sending to a subject, and `sub` permits receiving from it. `permissions: 'none'` explicitly keeps an endpoint private. Empty allowlists also grant nothing. A registered handler does not imply user access.

`activeContractGroups` explicitly selects endpoint groups and their order. `permissionTemplates` collects their grants plus `portalPermissions`, which has no corresponding API handler. User placeholders remain unresolved here; the auth resolver substitutes the verified identity and adds its scoped reply inbox. Per-resource authorization remains in API handlers.

`@lixpi/nats-subject-registry/service-permissions` exports `builtInPermissions` for API, workers, backup, operator, model registry, and NEX identities. These are complete service allowlists. Auth composition attaches configured public keys and application accounts to them.

## API subscriptions

API domain files call `createNatsSubscriptions()` with their group name and handlers keyed by `getNatsSubjectPath()`. The factory attaches the shared metadata and rejects missing or extra handlers. The API composition checks that all active groups are supplied with matching subjects, formats, queues, and interaction kinds.

To add an endpoint, declare its subject in constants, add its metadata and explicit permissions to the appropriate contract group, and supply its API handler. Add a new group to the explicit composition when needed. Review service permissions separately: user grants do not define the API's internal requests or storage access.

## Signing and applying declarations

Contract assembly rejects duplicate IDs or subjects, missing permission declarations, invalid subject patterns, unknown placeholders and explicit user inbox templates. `policy.ts` exports schema 3 and a digest for application diagnostics. These are application declarations; internal broker transport subjects and peer grants live in Go.

`registration.ts` binds service public keys and browser issuer settings to those permissions. It adds the application's scoped inbox templates and expresses empty permission directions as explicit deny-all grants. `registrationEnvironment()` signs the manifest with a deployment-owned account NKey. Reusing identical declarations preserves the application version; changing them increments it. An existing payload with a mismatched signature is rejected.

The [environment setup container](../../../infrastructure/init-script/README.md) writes the signed manifest and trusted public authority configuration. It keeps `NATS_REGISTRATION_AUTHORITY_SEED` in deployment configuration. The API receives `NATS_APPLICATION_REGISTRATION` and `NATS_REGISTRATION_PASSWORD`, submits the approved bytes at startup, then connects using its own service credential. The broker verifies and persists registrations in protected native JetStream KV. It does not import or build this TypeScript package.

After changing a subject grant, regenerate the signed declaration and restart the API with it. An endpoint handler change alone does not update broker permissions. Keep the manifest with the matching application release; old replicas cannot overwrite a newer registration. The [runtime registration protocol](../../../services/nats/documentation/CONFIGURATION.md#registration-protocol) also accepts independently signed declarations for other applications.

Tests assert public/private access, event-only grants, user-scoped events, queue metadata, portal extensions, constant-derived IDs, and invalid declarations directly. Run the package through the [shared Docker test runner](../../../documentation/testing/TypeScript/TESTING-GUIDE.md):

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner shared nats-subject-registry
```

See [Authentication](../../../documentation/platform/AUTHENTICATION.md) for credential verification, accounts, and request authorization. The [NATS service architecture](../../../services/nats/documentation/ARCHITECTURE.md) explains signed runtime declarations, authoritative reads and revision checks during peer admission.
