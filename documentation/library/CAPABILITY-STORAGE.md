---
title: Capability Storage and Operations
description: Capability catalog tables, Blob-backed packages, sealed runs, JetStream durability, backup, restore, garbage collection, and repair.
---

# Capability Storage and Operations

Capability discovery and Capability content use separate storage paths. DynamoDB carries searchable authority and current pointers. NATS Object Store carries content-addressed manifests and resources. JetStream carries ordered run events.

## DynamoDB tables

| Table | Key | Contents |
|------|-----|----------|
| `CAPABILITIES` | `capabilityId` | Kind, status, scope, owners, storage owner, current manifest hash, timestamps |
| `CAPABILITIES_META` | `scopeAndOwner`, `searchKey` | Thin picker projection with `kind#normalizedName#capabilityId` ordering |
| `CAPABILITIES_ACCESS_LIST` | `capabilityId`, `principalId` | Explicit viewer, editor, and owner grants |
| `CAPABILITY_RUNS` | `runId`, `workspaceId` | Owner, origin, sealed manifest hashes, state, current steps, outputs, event stream |

Create and update transactions write the authority row, scope projection, principal projections, grants, and Blob references below DynamoDB's 100-operation transaction limit. Manifest edits require the caller's expected manifest hash and fail on a concurrent pointer swap.

## Blob layout

The Blob registry maps each SHA-256 hash to an Object Store coordinate. Capability references use these owner keys:

```text
capability#<capabilityId>#manifest
capability#<capabilityId>#resource#<resourceId>
```

The browser never sees the bucket or object key. Authorized HTTP resource reads identify a Capability, resource ID, and sealed manifest hash. The API authorizes the captured catalog record, verifies the manifest, then reads the referenced Blob.

## Pointer swaps and sealed runs

An edit stores and verifies resources first, stores canonical manifest JSON, then conditionally swaps the catalog pointer. New Blob-reference registration is rolled back if the transaction fails. Superseded references stay readable for the configured retirement grace period so an in-flight run can finish from its captured hashes.

A resolver must use the catalog records returned by its BatchGet snapshot. It does not compare a captured manifest hash with the latest pointer during later reads.

## Run event storage

Each workspace has a file-backed JetStream stream for Capability events. Subjects are partitioned by workspace and run ID. The stream and Capability Object Store buckets use three replicas. Replay is cursor-paginated and available only after run authorization.

## NATS storage durability

The NATS cluster runs one daemon task on each of three ECS EC2 instances. Each instance mounts an encrypted gp3 EBS volume at `/data/jetstream`. Task restarts and deployments reuse the host volume. Streams and Object Store buckets use three replicas, so one unavailable node does not remove the only copy.

An EventBridge schedule runs `services/nats/backup-streams.sh` every six hours. The task enumerates JetStream streams, runs `nats stream backup`, uploads the snapshot tree to a versioned encrypted S3 bucket, and updates the `LATEST` marker. Bucket lifecycle rules retain recent recovery points and expire older versions.

## Restore procedure

1. Stop application writers and record the selected snapshot ID.
2. Verify the target NATS cluster is reachable and has enough storage for the snapshot.
3. Run `services/nats/restore-streams.sh <snapshot-id>` from the NATS image with the backup bucket, prefix, NATS URL, and system credentials configured.
4. List restored streams and compare stream names, subject filters, message counts, replica counts, and last sequence values with the backup inventory.
5. Read one known Capability manifest, one resource Blob, and one Capability run replay through the API authorization path.
6. Resume writers only after those reads pass.

Restoring into a non-empty cluster can conflict with existing stream names. Use an isolated recovery cluster unless the incident procedure explicitly calls for an in-place restore.

## Repair and garbage collection

Run repair with application writers active only when the procedure says the operation is idempotent.

- Rebuild missing scope and principal metadata projections from the `CAPABILITIES` authority row, current manifest, and access-list rows.
- Re-register a missing current-manifest or resource Blob reference after verifying the Blob hash and manifest membership.
- Remove a superseded Capability Blob reference only when it is older than the retirement grace period and no pending or running Capability run references that manifest hash.
- Mark a catalog row disabled when its current manifest or required resource Blob is missing. Do not silently skip it during resolution.
- Delete unregistered content-addressed objects only after the orphan grace window and a second registry check.
- Repair run rows from their durable event stream only when event sequences are contiguous. A gap is an incident, not a state to guess through.

Every repair batch is bounded below DynamoDB transaction and Object Store listing limits. Log the Capability ID, Blob hash, operation, and reason without logging resource content.

## Runtime limits

| Limit | Value |
|------|-------|
| Picker page | 20 metadata rows |
| Dependency depth | 8 |
| Resolved Capability count | 64 |
| Resolved resource count | 128 |
| Aggregate resolved resource bytes | 32 MiB |
| Aggregate text/schema resource bytes | 1 MiB |
| Character Creator reference Assets | 8 |
| Character Creator correction passes | 1 |
| Workflow retries | Manifest-bound and action-classified |
| Workflow recursion from Tool-started chat | 0 |

Action timeouts and the maximum Tool-run window are server contracts. Keep the Blob retirement grace longer than the longest permitted run.
