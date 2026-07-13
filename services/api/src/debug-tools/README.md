# API Debug Tools

Files in this directory and its child directories are development-only debug tools.

They are not application runtime code, are not part of supported API behavior, and must not be covered by automated tests. Agents must ignore this directory unless a user explicitly asks to inspect, modify, run, or rely on a file here.

- `inspect-replaced-media-history.ts` is a pre-cutover forensic tool for legacy exports/storage only; it is not compatible with the active Asset/Blob runtime.
- `convert-workspace-export-to-assets.ts --input <old.zip> --output <rev2.zip>` converts a version-1 workspace archive to the revision-2 Asset/Blob format entirely offline, refuses to overwrite its output, and performs no DynamoDB or NATS writes.
- `remove-legacy-object-stores.ts` is the phase-11 NATS administration tool. It is dry-run by default, recognizes only retired `workspace-*-files` and `media-library-*-files` buckets, always excludes active `blobs-*` buckets, and deletes only with `--confirm-delete-legacy-object-stores`.
