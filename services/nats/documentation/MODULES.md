---
title: NATS Modules and Code Responsibilities
description: What each part of the Go service does, why it is separate, and where to make a change.
---

# NATS Modules and Code Responsibilities

The packages divide the work at the points where different decisions are made. `broker` runs the server. `admission` decides where and when to verify a connecting client. `auth` decides whether the credentials are valid. `policy` supplies the permissions that a verified identity receives. `maintenance` handles the files and native NATS operations needed to keep that server running and recover its data.

For a browser connection, those parts form one path: the server asks for an authentication decision, the dispatcher reserves time and worker capacity, the verifier checks the token, and the policy resolver supplies the allowed subjects. The server installs the result on the connection. Subsequent application messages go through NATS's own routing and permission checks; they don't pass through the verifier again. [Architecture](ARCHITECTURE.md) shows this path and the peer retry path.

## Command composition

[`cmd/lixpi-nats`](../cmd/lixpi-nats/README.md) turns container configuration into running objects. It is where deployment details such as environment variables, file paths and command arguments become concrete inputs to the internal packages.

[`main.go`](../cmd/lixpi-nats/main.go) chooses the command and handles process signals and exit status. [`serve.go`](../cmd/lixpi-nats/serve.go) assembles the long-running server: it loads registration trust, checks the callout issuer key pairs, resolves node identity, installs the initial certificate and parses the NATS configuration. It then constructs a verifier, its worker and the broker runtime.

That order matters. The server needs a certificate before it can open its TLS listener, and the auth responder needs its signing keys and registration transport before it can answer a connection request. Invalid setup should fail startup rather than leave a listening broker unable to authenticate clients. Protocol tracing is rejected because CONNECT and callout traffic contain authentication material.

`serve -t` performs this setup through configuration assembly without starting the server. It still writes identity and installed-certificate files. It is useful for validating container inputs with disposable directories, but it is not a read-only syntax check.

[`maintenance.go`](../cmd/lixpi-nats/maintenance.go) assembles the other commands. `health` uses loopback HTTP and `fence` uses the local Unix socket. `backup` and `restore` connect to a broker as native NKey clients, using their own scoped reply inboxes and snapshot directory. They need neither a local server instance nor the callout issuer's private keys. Keeping that composition separate makes it possible to run a backup container with only the backup identity.

The [configuration guide](CONFIGURATION.md) lists the inputs for each command. The [command tests](../cmd/lixpi-nats/maintenance_test.go) exercise native backup and restore; the [container fixture](../cmd/lixpi-nats/container_test.go) supplies synthetic inputs for production-image checks.

## Broker lifecycle

[`internal/broker`](../internal/broker/README.md) is the part that talks to the upstream server's Go API. It starts the server, attaches Lixpi's auth responder, changes live TLS state and shuts those resources down in order. It does not implement a second message router or JetStream storage engine.

[`server.go`](../internal/broker/server.go) creates the server and waits for startup readiness. [`auth.go`](../internal/broker/auth.go) configures auth callout and its `auth_callout` user. That user is restricted to an in-process connection and the authentication subjects. Cluster route rules keep the original native callout on the accepting broker. These restrictions matter because a client able to impersonate the responder could authorize other clients.

[`runtime.go`](../internal/broker/runtime.go) holds the server, dispatcher connection and TLS certificate. It opens the dispatcher through `nats.InProcessServer`, which connects the NATS client to this server in memory. Automatic client reconnect is disabled for that connection: the runtime recreates the connection and the entire subscription set together, then checks that the dispatcher can receive its probe.

A damaged dispatcher connection should not require immediately discarding a healthy message broker. The runtime attempts a bounded repair after repeated structural health failures. It retains the same worker during repair, including slots still occupied by unfinished verification. Otherwise rebuilding the dispatcher would accidentally let stalled work escape its concurrency limit. If repair keeps failing, the runtime exits so the container supervisor can replace the process.

[`health.go`](../internal/broker/health.go) exposes the distinction between a running server, a healthy broker and available admission. For example, all verification slots can be occupied while existing clients still exchange messages. Using that saturation alone as a restart signal would interrupt healthy connections without fixing the load. The meanings of the endpoints and counters are in [Operations](OPERATIONS.md#health-and-metrics).

The runtime also supplies the live TLS replacement and served-certificate probe used by `maintenance.Certificates`. A TLS callback reads the active certificate through an atomic pointer, so renewal affects future handshakes without disconnecting existing WebSockets. A full server-options reload also reauthorizes clients; it is reserved here for placement changes, which may cause reconnects.

On shutdown, the runtime withdraws its advertised verification capacity and starts NATS's connection drain. It keeps the dispatcher available while pending admissions finish, then closes the remaining connections and control listeners. [Architecture](ARCHITECTURE.md#certificates-and-shutdown) records the shutdown budget. The [runtime tests](../internal/broker/runtime_test.go) exercise supervision and TLS rotation against actual embedded servers.

## Admission coordination

[`internal/admission`](../internal/admission/README.md) keeps slow or overloaded verification from turning into unlimited work inside the broker. It separates the request's coordinator from the worker doing the credential check.

The `Dispatcher` in [dispatcher.go](../internal/admission/dispatcher.go) coordinates pending connections, keeping responsibility for each until it replies or runs out of time. The `Worker` in [worker.go](../internal/admission/worker.go) owns a fixed number of verification slots. These are Go objects in the broker process, not additional services or containers.

For example, with 16 local slots occupied, another connection can be sent to a peer with available capacity. The accepting broker still owns the client socket and the final reply. The peer only evaluates one attempt. It does not forward the request again, so a busy cluster cannot create a chain of recursive retries.

Three limits cover different work: coordinator slots bound pending originating requests, RPC-handler slots bound incoming peer requests, and worker slots bound actual credential evaluation. Local and remote evaluations share the same worker slots. The NATS subscriptions also have pending-message limits. Exhausting coordinator capacity rejects a request immediately rather than adding an application waiting queue.

A timeout stops the coordinator from waiting, but cannot forcibly terminate a Go function. If a verifier ignores cancellation, `Worker.Evaluate` keeps its slot occupied until that verifier actually returns. Releasing the slot at the timeout would allow each new request to start another goroutine while the old ones were still blocked. The [worker tests](../internal/admission/worker_test.go) exercise this case.

### Knowing which peer can help

[`peer.go`](../internal/admission/peer.go) exchanges signed membership announcements and handles requests addressed to this node. Announcements include capacity, active work and the transport and registration-trust digest. A dispatcher ignores expired or incompatible peers and chooses the lowest advertised utilization among the remaining candidates, randomizing ties. Capacity is an observation, not a reservation: the peer can become busy before a request arrives.

[`wire.go`](../internal/admission/wire.go) defines and signs those messages. It binds each attempt to a node, a particular dispatcher instance, a request correlation value and an attempt ID. A node can restart while an old reply is in flight; a coordinator must not mistake that reply for an answer from the new instance or from a later attempt.

The work request carries the original encrypted broker request and its XKey information. The peer validates it and evaluates the credentials through the same worker used for local admissions. Replies are signed, checked against the selected attempt, and rejected when late or mismatched. Peer workers do not gain permission to answer the original native callout directly.

A valid identity and an explicit credential rejection both finish the decision. Busy, unavailable and timed-out attempts may use another peer within the original deadline. An identity provider that cannot be reached is an operational failure; an invalid signature is a rejection. That distinction prevents retries from looking for a worker willing to accept a rejected credential. The [retry diagram and limits](ARCHITECTURE.md#capacity-and-peer-selection) show the full decision. [Dispatcher](../internal/admission/dispatcher_test.go) and [peer](../internal/admission/peer_test.go) tests cover stale replies, membership and retry behavior.

## Credential verification

[`internal/auth`](../internal/auth/README.md) answers two different questions: whether an authorization request is valid, and whether the client described by that request has proved its identity.

[`protocol.go`](../internal/auth/protocol.go) handles the first question. `Protocol.Open` decrypts the callout and checks the broker's signature, server identity, intended issuer, protocol type/version, connection user NKey, XKey binding and deadline. These checks bind a decision to a specific pending connection. A valid client token by itself is not enough to justify replying to an unrelated or expired request.

[`verifier.go`](../internal/auth/verifier.go) handles the client credentials:

| Credential sent at CONNECT | What proves the identity | Where permissions come from |
|---|---|---|
| Browser JWT | RS256 signature, configured issuer/audience, subject and valid supplied time claims | Browser templates expanded for the verified subject in AUTH |
| Service JWT | EdDSA signature from a registered public NKey, with the registered service ID as subject | That service registration |
| Native NKey response | Signature over the broker's connection nonce using the registered key | That service registration |

A supplied token takes precedence. If that token is invalid, the verifier rejects it rather than trying native NKey authentication as a fallback. Service JWTs are Lixpi application JWTs; they are distinct from the NATS user JWT created for the admitted session.

[`runtime.go`](../internal/auth/runtime.go) selects a service registration or browser verification profile from the snapshot pinned on the request context. It keeps bounded JWKS caches for registered endpoints. The selected issuer is still checked against the token's signature, audience and claims; reading an unverified issuer only selects the profile to try. The client keeps its private NKey seed. The snapshot supplies the public key, account and subject permissions.

After verification, `Protocol.Reply` signs a NATS user JWT with the chosen account and permissions, puts it inside the response to the requesting server and encrypts that response. A denial contains no user JWT. The authorization response expires with the request; the admitted session's user JWT has no expiry. The API's per-request token and resource checks remain necessary. See [Authentication](../../../documentation/platform/AUTHENTICATION.md).

### Why browser key lookup has its own cache

A browser JWT names a signing key with `kid`. [`jwks.go`](../internal/auth/jwks.go) obtains that public key from the configured JSON Web Key Set endpoint. Service keys are already registered and do not use this fetch.

The cache avoids one provider request per connection. It keeps usable keys for ten minutes, combines concurrent cache misses into one fetch, and limits refreshes to ten per minute. A fetch has a one-second ceiling and is also constrained by the caller's shorter deadline. Response size and key count are capped so unknown-key traffic cannot create unbounded downloads or cache growth.

A usable cached key can verify a token during a provider outage. An expired entry cannot. If a successful key-set fetch omits the requested key, the credential is denied. If the fetch fails or is throttled, verification is unavailable and the dispatcher may try a peer with a usable cache. A failed fetch preserves the existing cache rather than replacing it with an empty one. [Verifier tests](../internal/auth/verifier_test.go) and [protocol tests](../internal/auth/protocol_test.go) check these decisions separately.

## Runtime registration and permission expansion

[`internal/policy`](../internal/policy/README.md) handles the transport's declaration format. It has no list of Lixpi endpoints, service names or storage namespaces.

[`registration.go`](../internal/policy/registration.go) verifies the deployment signature and owner/account scope. It rejects malformed NKeys, subject patterns, ambiguous identities, unknown fields and unsafe empty permission directions. It produces an immutable snapshot, whose digest binds peer work to the same declarations.

[`store.go`](../internal/policy/store.go) persists signed manifests in native JetStream KV. The registration subscriber is bounded and accepts only versioned compare-and-swap updates. Admissions read the stream leader before using the cached parsed snapshot, so parsing can be reused without treating a stale cache as authoritative.

[`policy.go`](../internal/policy/policy.go) defines the internal callout, peer and maintenance protocol subjects. It also expands identity placeholders in registered browser grants. `{subjectToken}` encodes UTF-8 bytes as hex so identity text cannot become a NATS wildcard or a second subject token. Raw `{subject}` interpolation rejects identities containing subject separators, wildcards or whitespace.

[`broker/registration.go`](../internal/broker/registration.go) creates the declared application accounts and isolated registration account. It opens the internal store connection and installs its resolver on admission. The network bootstrap identity can submit a signed declaration but cannot access the backing stream. If the internal registration connection stops, readiness fails and the runtime exits for supervisor recovery.

The application-side [subject registry](../../../packages/lixpi/nats-subject-registry/README.md) prepares Lixpi manifests. Deployment signs them; API startup submits them. Changing a subject grant does not require rebuilding the Go binary. [Architecture](ARCHITECTURE.md#runtime-registration) follows the complete flow, and [registration tests](../internal/policy/registration_test.go) cover validation and ownership.

## Maintenance and storage adapters

[`internal/maintenance`](../internal/maintenance/README.md) covers the operational state that must survive or safely change around the server: its node identity, TLS certificate and recoverable stream snapshots. It does not store application Blobs through a separate persistence system. Application bytes and messages remain in native JetStream.

### Keeping a node's identity and placement

[`identity.go`](../internal/maintenance/identity.go) resolves the server name and, when persistence is enabled, saves it beside the JetStream data. A replacement container's hostname must not silently rename a broker that is reopening an existing disk. The saved name therefore takes precedence over a changed environment name.

The same file reads the configured address and placement zone, produces server/zone tags and records the placement fence. A fence removes the node's normal placement tags while an external controller evacuates it. The marker survives a restart so the node doesn't start accepting placements again halfway through retirement. The controller, not this package, decides whether evacuation has finished and whether the host can be removed.

### Installing a certificate the listener can actually serve

[`certificates.go`](../internal/maintenance/certificates.go) validates the supplied chain, hostname, lifetime and private-key match before changing the active files. It writes a complete version, switches the active symlink and asks the broker to replace its TLS certificate. It then checks that a real TLS handshake serves the expected leaf fingerprint. If replacement or that check fails, it attempts to restore the previous version.

This separation lets the same validation run before startup, when no listener exists, and during renewal, when the live listener must be checked. The broker supplies reload/probe callbacks; the maintenance package does not need to own or recreate the server. For example, a newly delivered certificate with the wrong key fails validation while the installed certificate keeps serving. [Operations](OPERATIONS.md#certificate-refresh) explains the source files, installed files and rollback sequence.

### Capturing and restoring native stream data

[`snapshot.go`](../internal/maintenance/snapshot.go) talks to the native JetStream snapshot and restore APIs. It lists streams, transfers acknowledged chunks with deadlines and checks the server's restored message, byte, sequence and consumer counts. Streaming into an `io.Writer` avoids keeping an entire archive in memory.

[`backup.go`](../internal/maintenance/backup.go) turns those per-stream transfers into a usable backup set. It stages archives and metadata, checks that stream names did not change during capture, and writes checksums and completion markers. The two levels are separate because successfully capturing one stream does not mean the account backup is complete.

[`files.go`](../internal/maintenance/files.go) supplies the production filesystem operations: reading the source certificate pair and storing snapshot files beneath a confined root. A failed write must not replace a committed file or publish a half-written `LATEST` pointer. `DirectoryStore` writes a temporary file, syncs it and renames it into place; paths cannot escape the selected directory.

Backup and restore use these pieces as NATS clients. The serving process uses only identity and certificate maintenance. No background snapshot loop is hidden inside `serve`; the deployment invokes backups separately and transports their completed files.

Writers continue during capture, so each stream has its own snapshot point. Restore validates the full backup set before its first mutation, but a later connection failure can still leave some streams restored and others missing. [Operations](OPERATIONS.md#native-backups) covers those recovery limits and the directory format. The [backup](../internal/maintenance/backup_test.go), [filesystem](../internal/maintenance/files_test.go), [certificate](../internal/maintenance/certificates_test.go) and [CLI compatibility](../internal/maintenance/snapshot_compatibility_test.go) tests cover these behaviors.
