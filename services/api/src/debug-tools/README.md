# API Debug Tools

Files in this directory and its child directories are development-only debug tools.

NATS inspection and cleanup tools require `NATS_OPERATOR_NKEY_SEED` and authenticate as `svc:operator` in AUTH. They pass the seed as `nkeySeed` to `@lixpi/nats-service`, which signs a service JWT for the connection. Supply that seed explicitly to an authorized operator container; the API runtime does not receive it.

They are not application runtime code, are not part of supported API behavior, and must not be covered by automated tests. Agents must ignore this directory unless a user explicitly asks to inspect, modify, run, or rely on a file here.

- `inspect-replaced-media-history.ts` is a pre-cutover forensic tool for legacy exports/storage only; it is not compatible with the active Asset/Blob runtime.
- `inspect-workspace-generation-history.ts --workspace <workspaceId> [--generation-request <generationRequestId>]` is a read-only DynamoDB/NATS forensic tool that correlates generated canvas nodes, media requests, unresolved reference bindings, settled/current conversation and provenance documents, trace reference identities, and document step logs. Run it only inside the API container.
- `convert-workspace-export-to-assets.ts --input <old.zip> --output <rev2.zip>` converts a version-1 workspace archive to the revision-2 Asset/Blob format entirely offline, refuses to overwrite its output, and performs no DynamoDB or NATS writes.
- `remove-legacy-object-stores.ts` is the phase-11 NATS administration tool. It is dry-run by default, recognizes only retired `workspace-*-files` and `media-library-*-files` buckets, always excludes active `blobs-*` buckets, and deletes only with `--confirm-delete-legacy-object-stores`.
