# NATS Cluster

The cluster resource runs one ECS EC2 daemon task per broker host, with embedded connection admission, persistent JetStream storage, private CloudMap discovery, public WebSocket DNS, certificate delivery, and scheduled backups. The host group starts with a minimum and maximum of three; both bounds are deployment settings.

EC2 preserves JetStream event streams, work queues, permanent organization Object Stores and NEX control data: Fargate service-task EBS volumes are deleted on termination, and persistent EFS uses NFS, which NATS advises avoiding. The default is one `t3.small` in each of three zones, a 1 GiB broker container with 256 MiB JetStream memory storage, and an encrypted 150 GiB gp3 disk with a 100 GiB JetStream file limit. This is a minimum memory budget, not benchmarked production capacity. [Architecture, vendor sources and recovery runbook](../../../../../documentation/platform/deployment/NATS-CLUSTER.md) explain the tradeoffs.

## Storage and recovery

Each instance mounts its encrypted gp3 volume at `/data/jetstream`. ECS cannot start without that mount. Broker identity persists on the disk. Object Store creation defaults to three replicas, and application event and maintenance streams request three; audit existing streams rather than assuming their settings. `sync_interval: always` trades write throughput for stronger crash durability. Instance replacement requires deliberate volume recovery or peer replacement. Automatic ASG refresh, zone rebalancing and unhealthy-host replacement are disabled so they cannot discard multiple live replicas.

EventBridge starts a private Fargate backup task every six hours with 200 GiB scratch space and a separate S3 task role. The [deployment adapter](deployment-adapter/adapter.ts) runs the vendor-neutral `lixpi-nats backup` command with a filesystem snapshot directory and only NATS credentials. That command paginates AUTH streams, captures snapshot metadata and checksums, rejects a changed stream inventory, writes `COMPLETE` and advances the directory's `LATEST`. After it exits successfully, the adapter uploads the completed tree and publishes the remote completion/latest markers. It does not use broker root disks. Snapshots expire after 35 days and noncurrent versions after seven days. These are per-stream backups, not coordinated DynamoDB recovery points; NEX account state is outside their scope. Scratch sizing must cover both staged files and completed local snapshots before upload.

The backup task receives `NATS_BACKUP_NKEY_SEED` through an ECS secret reference and a dedicated execution role. Its registered AUTH identity can list, inspect, and snapshot streams. It cannot restore or delete them.

The task emits `BackupComplete` only after S3 contains `COMPLETE` and the updated `LATEST` pointer. CloudWatch alarms detect failed schedule invocations and eight consecutive hourly periods without a completion metric. ECS task events report startup failures and nonzero exits to the backup SNS topic. `NATS_OPERATIONAL_ALERT_EMAIL` creates email subscriptions for backup and certificate alerts; confirm the SNS emails to activate delivery, or connect the exported topic ARNs to another incident destination. A failed metric upload makes the task fail even if the snapshot exists, so inspect its completion marker before deciding that recovery data is missing.

Restore into an empty, isolated AUTH recovery account:

1. Select a snapshot ID and prepare a recovery target isolated from production writers. Production keeps serving its own storage.
2. Use deployment storage tooling to download the selected snapshot tree, its completion marker and checksum manifest into a recovery volume. Mount that directory into the vendor-neutral NATS image and run `/usr/local/bin/lixpi-nats restore <snapshot-id>` with `NATS_SNAPSHOT_DIR`, `NATS_URL`, and `NATS_OPERATOR_NKEY_SEED`. Omit the snapshot ID only when the mounted directory also contains the intended `LATEST` file. The Go command does not retrieve remote objects or accept cloud credentials.
3. Restore requires a completion marker and verifies checksums and the complete manifest before creating streams. It rejects a nonempty target and compares counts, bytes, first/last sequences and consumer counts against snapshot metadata.
4. Check leaders and replica health, validate object hashes and replay, and reconcile Object Store content and event histories with DynamoDB domain references before accepting the recovery copy. After total loss of native replicas and disks, writes after the selected snapshot can be lost.

The Go commands keep credential seeds in memory. The operator restore identity is distinct from the scheduled backup identity; neither command receives callout issuer or XKey seeds.

## Load scaling

`NATS_MIN_NODES`, `NATS_MAX_NODES` and `NATS_DESIRED_NODES` set the EC2 group bounds and initial size. Their defaults are three. The minimum cannot be below three because the application requests R3 streams. There is no three-node maximum in the resource: raising `NATS_MAX_NODES` allows the existing CPU policy to add hosts. Pulumi ignores subsequent desired-capacity drift so a deployment does not undo scaling. The daemon service follows those hosts and does not use ECS DesiredCount autoscaling.

`NATS_SCALE_OUT_CPU_PERCENT` defaults to 60 and `NATS_INSTANCE_WARMUP_SECONDS` to 300. The one-minute controller considers scale-in after 15 complete low-CPU samples below `NATS_SCALE_IN_CPU_PERCENT` (default 30), with separate checks of live process CPU, memory headroom, replica health and host state. Missing metrics or incomplete inventory prevent scale-in. New hosts provide capacity for new connections and new stream placements; adding hosts does not redistribute every existing stream or persistent connection, and cannot fix a single hot stream by itself.

Scale-in is serialized and never removes the last host in a zone. The controller records its candidate in an ASG tag, removes its placement tags through SSM and reloads NATS. A marker on the retained disk preserves that fence across task restarts. An empty, temporary AUTH stream constrained to the retiring server proves that the metadata leader has observed the fence. The controller then asks NATS to evacuate streams and consumers while application writes continue. It waits for zero local streams and consumers and healthy replacement replicas before removing the peer from metadata. Only a later verified observation permits termination of that specific instance. Errors do not turn into timed permission to destroy a host. Increased demand before peer removal cancels retirement and restores its placement tags.

AWS target tracking has direct scale-in disabled, and instances retain ASG scale-in protection. The controller has the specific terminate permission needed after its checks. Automatic EC2 refresh, unhealthy replacement and AZ rebalance remain disabled because those paths bypass JetStream evacuation. A failed host still needs the recovery runbook. Removed data disks remain encrypted and retained; review and remove obsolete volumes after recovery acceptance to avoid accumulating storage charges.

The deployment adapter reads EC2 metadata and supplies the placement zone to the broker through a file. Broker `az:` tags use that value, and `unique_tag: az:` separates stream replicas across zones. Local Compose uses a synthetic zone per container. Existing clusters require two deployments: first use `NATS_JETSTREAM_UNIQUE_TAG=server:` while publishing both server and AZ tags on every broker; verify all members report the expected zones; then use `NATS_JETSTREAM_UNIQUE_TAG=az:`. This avoids changing placement rules before enough eligible zones exist. Keep the maximum at its initial value through this migration. Existing stream placements need a separate audit because changing the selection rule does not relocate them. Explicit negative `az:` or `server:` placement overrides are incompatible with automatic retirement and make the controller stop.

Controller failures raise a CloudWatch alarm to its SNS topic. Set `NATS_OPERATIONAL_ALERT_EMAIL` to create an email subscription and confirm AWS's subscription message. The controller uses a dedicated Secrets Manager secret for its SYS and AUTH operator credentials; ordinary application tasks cannot read it. [AWS target tracking](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-scaling-target-tracking.html) and [instance protection](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-instance-protection.html) explain the ASG controls. The pinned NATS server's [evacuation API](https://github.com/nats-io/nats-server/blob/v2.15.0/server/jetstream_api.go) moves live stream and consumer assignments before membership removal.

## Discovery and certificates

The discovery Lambda owns private Cloud Map A records because ECS automatic A registration does not support host networking. Running broker peers are registered privately for cluster bootstrap. Public addresses require ECS health and a successful authenticated admission probe on private port 3020. The Lambda may read only the bootstrap secret needed by that probe. Exact task-family filtering excludes backup tasks. ECS events and a one-minute reconciliation schedule repair stale records. Inventory failures trigger retries without publishing a partial result; no healthy public addresses removes the public record. Reconciliation is serialized.

Caddy's certificate-manager Lambda checks renewal every six hours using Route53 DNS-01 and keeps its complete ACME state in encrypted, versioned S3. Cluster startup depends on initial certificate generation. The deployment-adapter container reads the certificate secret and publishes a complete file pair into a shared volume. It also reads EC2 metadata and supplies a `node.json` containing `zone` and `advertiseIP`. The broker mounts that volume read-only and starts after the adapter's file health check succeeds. Brokers read certificate files every minute, validate the hostname, chain, validity and matching key, atomically switch their installed pair and TLS callback, then verify the served fingerprint. Failed refreshes retain the installed certificate. Local Compose supplies files through its Caddy volume and uses the same Go watcher. See [certificate management](../certificate-manager/README.md).

The adapter polls the broker's authenticated `/metrics` endpoint and publishes certificate delivery/refresh and validity measurements to CloudWatch. Those APIs, IAM permissions, SDK packages and instance-metadata requests live under this infrastructure resource. The broker binary and its Go module contain no cloud SDK. The adapter adds 64 CPU units and 128 MiB to the task reservation; the broker's own allocation remains 1,024 CPU units and 1,024 MiB by default. Expiry, renewal failure and missing maintenance alarms publish to exported SNS topics; subscribe them to the incident destination.

The deployment adapter uses a separate [image](deployment-adapter/Dockerfile) with the shared Alpine Node.js base, the broker executable, and its infrastructure-owned Node.js entrypoint. [The version registry](../../../../../dev-tools/versions-registry/README.md) supplies its runtime and dependency versions, along with the discovery and scaling Lambda declarations. The Lambda builds use NodeNext module resolution and explicit Node type declarations for the selected TypeScript compiler. The adapter's `serve` mode delivers files and metrics; its `backup` mode invokes the native command and then transports completed snapshots. It is not a dependency of the broker image. Build both locally inside Docker when validating this boundary:

```bash
docker build -f services/nats/Dockerfile --target embedded-runtime -t lixpi/nats-embedded .
docker build --build-arg NATS_IMAGE=lixpi/nats-embedded -t lixpi/nats-deployment-adapter infrastructure/pulumi/src/resources/NATS-cluster/deployment-adapter
docker run --rm --network none --entrypoint node lixpi/nats-deployment-adapter --experimental-transform-types --check /adapter/main.ts
docker run --rm --network none --entrypoint node lixpi/nats-deployment-adapter --experimental-transform-types --input-type=module -e "await import('/adapter/adapter.ts')"
```

The TypeScript `infrastructure` test domain covers metadata and certificate delivery failures, last-good file preservation, completed snapshot publication ordering, metrics and task wiring with mocked provider clients. It does not contact AWS.

| Port | Listener |
|---|---|
| 4222 | VPC-only client TCP, configured without TLS; private reconnect advertisements |
| 443 | WebSocket TLS |
| 6222 | Cluster routes |
| 8222 | HTTP monitoring and broker health |
| 3020 | VPC-only process, broker, authenticated admission health and metrics |

Local Compose starts the one-shot Caddy job before any broker, including under the `main` profile, so an empty certificate volume is populated before Go startup. It maps WebSocket port 443 to host port 9222. Use `nats://` for the configured 4222 listener and `wss://` for browser connections. Auth replies are authorized by broker permissions; TLS does not grant access to reply inboxes. Configuring TCP TLS separately requires matching client URLs and trust material.

## Authentication accounts

| Account | Purpose |
|---|---|
| SYS | Broker system operations |
| CALLOUT | Restricted embedded dispatchers, no application JetStream |
| REGISTRATION | Signed application declarations in a protected native JetStream KV stream |
| AUTH | Browser/API/workload identities and existing application storage |
| NEX | NEX control plane and its JetStream domain |

`auth_callout.account` is CALLOUT. Its exempt bootstrap identity is `auth_callout`, whose password is injected through a Secrets Manager reference. The broker restricts it to `IN_PROCESS` connections, the local native callout queue, node-scoped peer RPC and membership, and one reply within five seconds of a received request. Route import/export denies prevent native callout delivery to another broker.

Each broker holds the private callout issuer and XKey seeds. Its execution role can read those secrets and the bootstrap passwords. The broker always advertises native challenge nonces; the embedded worker resolves each client public key through signed registrations. Ordinary API and workload identities cannot subscribe to callout or peer-auth traffic.

Deployment supplies registration authority public keys and their owner/account scopes. The broker creates the scoped application accounts. The setup container signs Lixpi's service identities and browser profiles, and API startup submits that manifest through the restricted `registration` identity before opening its ordinary service connection. The private registration authority seed stays in deployment tooling. The manifest assigns browsers and ordinary backends to AUTH, and NEX to NEX. These are deployment choices, not compiled Go policy. Account names and JetStream directories are stable across process restarts.

## Admission and process health

The dispatcher reads registration state from the JetStream stream leader, tries bounded local verification, then tries a compatible available peer on operational failure. Explicit credential denial is terminal. Default limits are 16 verification slots, 128 admission coordinators, four attempts, 300 ms per attempt, and 1.5 seconds total. Peer selection uses signed, expiring membership with a transport/trust digest. Each connection attempt pins a registration snapshot; peers must resolve that same snapshot before verifying credentials. Neither API, DynamoDB nor JWKS availability gates structural bootstrap. Missing or unreadable registration state denies application connections.

`/live`, `/broker`, `/ready` and `/metrics` listen on 3020. Admission readiness and metrics require the bootstrap password as a bearer token. Readiness requires working subscriptions and a successful dispatcher probe; worker or JWKS outages do not restart the process. The supervisor rebuilds a structurally broken dispatcher within a bounded recovery budget and exits if that budget is exhausted. ECS checks `lixpi-nats health broker`, while public discovery checks admission separately.

The normal [init-config create/update flow](../../../../../dev-tools/config-utils/README.md) signs the application manifest on save. It supplies public trust configuration for every broker and the signed payload and bootstrap password for API startup. Registration updates require a higher manifest version; identical retries are idempotent. Established sessions retain their existing lifetime. Compose clients wait for broker admission readiness, and API startup then waits for registration to succeed. SIGTERM withdraws worker capacity and starts bounded lame-duck drain; ECS allows 120 seconds before forced termination. A placement fence is changed through the private Unix control socket with `lixpi-nats fence enable|disable`. Its full server-option reload can reconnect admitted clients; certificate replacement does not use that reload path.

## Source and operations

The [service documentation](../../../../../services/nats/README.md) explains the Go process, admission coordination, executable configuration and maintenance commands. This resource owns AWS placement, task roles, discovery, scheduling and host lifecycle.

- [Broker configuration](../../../../../services/nats/nats-server.conf)
- [Embedded entry point](../../../../../services/nats/cmd/lixpi-nats/serve.go)
- [Runtime registration validation](../../../../../services/nats/internal/policy/registration.go)
- [Authentication guide](../../../../../documentation/platform/AUTHENTICATION.md)
- [Cluster deployment guide](../../../../../documentation/platform/deployment/NATS-CLUSTER.md)

Broker `/healthz` is on port 8222. Admission readiness is separate from broker health and from provider JWKS availability. If admission fails, check dispatcher readiness, registration state availability, authority scope, client public keys, trust digests, worker capacity and sanitized errors. Do not print environment variables or decoded callout requests.
