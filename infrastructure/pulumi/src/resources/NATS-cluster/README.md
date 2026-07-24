# NATS Cluster Architecture with CloudMap Service Discovery

## Durable JetStream deployment

AWS NATS runs as an ECS EC2 daemon service on a dedicated three-instance cluster. Each instance has an encrypted gp3 EBS volume mounted on the host and bind-mounted into the NATS container at `/data/jetstream`. JetStream stores file data there, and application-created streams and Object Store buckets use three replicas.

Every six hours, EventBridge starts the `nats-backup` ECS task. The task executes `nats stream backup` for every stream visible in the AUTH account and copies the snapshots to the versioned, encrypted S3 backup bucket. Snapshots expire after 35 days; noncurrent S3 versions expire after seven days.

### Restore validation and procedure

Perform restores into an empty recovery cluster or after confirming the target stream does not exist. Never restore over a live stream.

1. Stop application writes to NATS and record the selected snapshot ID. Omitting the ID selects the S3 `LATEST` marker.
2. Start a one-off ECS task from the deployed NATS image, override its entry point to `/opt/nats/restore-streams.sh`, and provide `NATS_BACKUP_BUCKET`, `NATS_BACKUP_PREFIX`, `NATS_URL`, `NATS_SYS_USER`, and `NATS_SYS_PASSWORD`. Pass the snapshot ID as the first command argument when restoring a snapshot other than `LATEST`.
3. The script downloads every stream snapshot and runs `nats stream restore` in deterministic name order.
4. Run `nats stream report`, confirm every restored stream has three replicas and a current leader, then compare stream message counts with the backup task log.
5. Read at least one known Object Store object through the API before re-enabling writes.

The backup and restore scripts fail on the first unsuccessful command. A restore drill is successful only when stream counts, replica health, and a content-addressed Blob hash all match.

## Overview

This NATS cluster implementation uses AWS CloudMap for service discovery and Caddy for TLS certificate management. It provides both internal cluster communication and external client access through a dual CloudMap architecture. The system includes NATS auth callout integration with the main API service for authentication and authorization.

## Architecture Components

### 1. Service Discovery Architecture

#### Private CloudMap Namespace
- **Purpose**: Internal cluster communication and service mesh discovery
- **Domain**: `{cloudMapNamespaceName}` (private VPC namespace, e.g., `private.local`)
- **Access**: Only accessible within the VPC
- **Usage**: NATS servers discover each other for cluster formation

#### Route53 Public DNS Records
- **Purpose**: External client connections via direct DNS A records
- **Domain**: `nats.{DOMAIN_NAME}` (e.g., `nats.shelby-dev.lixpi.dev`)
- **Access**: Internet-accessible via Route53 hosted zone
- **Usage**: Client applications connect to NATS cluster with certificate domain matching

### 2. DNS Structure

```
shelby-dev.lixpi.dev (Route53 Hosted Zone)
├── nats.shelby-dev.lixpi.dev (Client connection endpoint - Certificate domain)
├── api.shelby-dev.lixpi.dev (API service domain)
└── cloudmap.shelby-dev.lixpi.dev.internal (Private CloudMap - Internal only)
```

### 3. Service Discovery Flow

#### Internal Cluster Formation
1. NATS containers start and register with **private CloudMap**
2. Each server uses `nats.{privateNamespace}:6222` for cluster routing
3. NATS gossip protocol handles automatic peer discovery
4. Private IPs are automatically registered via ECS service registry

#### External Client Access
1. Lambda sidecar monitors ECS task state changes
2. Extracts public IPs from running NATS tasks
3. Updates Route53 A record for `nats.shelby-dev.lixpi.dev` with all healthy IPs
4. Clients connect via `nats.shelby-dev.lixpi.dev:4222` or WebSocket `wss://nats.shelby-dev.lixpi.dev:443`

## NATS Auth Callout Integration

The `main-api` service acts as an authentication and authorization callout service for NATS using the external auth callout mechanism with NKey/XKey encryption.

### Auth Callout Configuration
```conf
accounts {
    SYS: {
        users: [
            { user: sys, password: sys_password147372yDHj2yr821 }
        ]
    }
    AUTH: {
        jetstream: enabled
        users: [
            { user: regular_user, password: regular_password273yhfhheh273jhHBJMWH }
        ]
    }
}

system_account: SYS

authorization {
    auth_callout {
        issuer: $NATS_AUTH_NKEY_ISSUER_PUBLIC
        account: AUTH
        auth_users: [ regular_user ]
        xkey: $NATS_AUTH_XKEY_ISSUER_PUBLIC
    }
}
```

### Auth Callout Flow
1. **Client Connection**: WebSocket client connects to NATS with JWT token in `auth_token` field
2. **Auth Request**: NATS server publishes encrypted auth request to `$SYS.REQ.USER.AUTH` subject
3. **API Subscription**: Main API service subscribes to `$SYS.REQ.USER.AUTH` as `regular_user` in AUTH account
4. **Token Validation**: API service validates Auth0 JWT token and extracts user permissions
5. **Response Generation**: API service generates NATS user JWT with appropriate permissions
6. **Response Delivery**: API service responds via `msg.respond()` with encrypted JWT response
7. **Client Authorization**: NATS server validates response and authorizes client with generated permissions

### Critical Auth Callout Connection Requirement

**⚠️ CRITICAL**: The API service **MUST** connect to NATS using `tls://` protocol, not `nats://` protocol.

#### Why TLS is Required for Auth Callout

The auth callout mechanism requires **bidirectional trust** between the API service and NATS server:

**Subscription Phase** (works with both protocols):
- API service subscribes to `$SYS.REQ.USER.AUTH`
- This is a basic NATS operation that works with plain connections

**Response Phase** (requires TLS):
- API service calls `msg.respond()` to publish auth response to internal reply inbox
- NATS server creates internal subscription using `acc.subscribeInternal(reply, processReply)`
- **Plain connections lack trust level to publish to internal reply subjects**
- **TLS connections establish trusted client status required for reply operations**

#### Environment Configuration

**Local Development** (.env.shelby-local):
```bash
NATS_SERVERS="tls://lixpi-nats-1:4222, tls://lixpi-nats-2:4222, tls://lixpi-nats-3:4222"
```

**AWS Production** (.env.shelby-dev):
```bash
NATS_SERVERS="tls://nats.cloudmap.shelby-dev.lixpi.dev.internal:4222"
```

#### Troubleshooting Auth Callout Issues

**Symptom**: Auth callout timeouts, clients cannot authenticate
**Diagnosis**: Check NATS_SERVERS protocol in environment configuration

```bash
# ❌ WRONG - Will cause auth callout timeouts
NATS_SERVERS="nats://nats.cloudmap.shelby-dev.lixpi.dev.internal:4222"

# ✅ CORRECT - Establishes trusted connection for auth callout responses
NATS_SERVERS="tls://nats.cloudmap.shelby-dev.lixpi.dev.internal:4222"
```

**Root Cause Analysis**:
1. Plain `nats://` connections can subscribe to subjects (including `$SYS.REQ.USER.AUTH`)
2. But reply operations to internal subjects require trusted connection status
3. TLS connections authenticate the API service as a trusted client
4. Trusted status allows publishing responses to reply inbox subjects created by `acc.subscribeInternal()`

This issue is subtle because:
- Subscription works (API receives auth requests)
- Only response delivery fails (timeouts waiting for replies)
- Local and AWS networking differences can mask the real cause

### Auth Callout Security Architecture

#### NKey/XKey Encryption
- **NKey**: Used for JWT signing and account authentication
- **XKey**: Used for request/response encryption between NATS and API service
- **Dual Encryption**: Auth requests encrypted with XKey, responses signed with NKey

#### Account Isolation
- **SYS Account**: System operations and cluster management
- **AUTH Account**: Auth callout service and user management
- **User Accounts**: Dynamic assignment based on auth callout response

#### Permission Template System
```typescript
const resolvedPermissions = {
    pub: {
        allow: ["_INBOX.>", ...userSpecificSubjects]
    },
    sub: {
        allow: ["_INBOX.>", ...userSpecificSubjects]
    }
}
```

### Auth Callout Implementation Details

#### API Service Setup
```typescript
await startNatsAuthCalloutService({
    natsService: await NATS_Service.getInstance(),
    subscriptions,
    nKeyIssuerSeed: env.NATS_AUTH_NKEY_ISSUER_SEED,
    xKeyIssuerSeed: env.NATS_AUTH_XKEY_ISSUER_SEED,
    jwtAudience: env.AUTH0_API_IDENTIFIER,
    jwtIssuer: `${env.AUTH0_DOMAIN}/`,
    algorithms: ['RS256'],
    jwksUri: `${env.AUTH0_DOMAIN}/.well-known/jwks.json`,
    natsAuthAccount: env.NATS_AUTH_ACCOUNT,
})
```

#### Client Connection Example
```javascript
// WebSocket client connects with Auth0 token
const nc = await connect({
    servers: ["wss://nats.shelby-dev.lixpi.dev:443"],
    auth_token: auth0JWT, // Auth0 JWT token
})
```

The auth callout service validates the Auth0 token, extracts user information, and generates appropriate NATS permissions for the client session.

## Deployment Architecture

```mermaid
graph TB
    subgraph "Route53 DNS Management"
        MainZone["shelby-dev.lixpi.dev<br/>(Main Hosted Zone)"]
        NATSRecord["nats.shelby-dev.lixpi.dev<br/>(A Record with Multiple IPs)"]
        MainZone --> NATSRecord
    end

    subgraph "Certificate Management"
        CaddyLambda["Caddy Lambda<br/>(Certificate Manager)"]
        SecretsManager["AWS Secrets Manager<br/>(Certificate Storage)"]
        CaddyLambda -->|DNS-01 Challenge| MainZone
        CaddyLambda -->|Store Certs| SecretsManager
    end

    subgraph "ECS Fargate Cluster (Public Subnets)"
        subgraph "NATS Service (3 nodes)"
            NATS1["NATS Server 1<br/>(Public + Private IP)"]
            NATS2["NATS Server 2<br/>(Public + Private IP)"]
            NATS3["NATS Server 3<br/>(Public + Private IP)"]
        end

        NATS1 <-->|Cluster Gossip<br/>Port 6222| NATS2
        NATS2 <-->|Cluster Gossip<br/>Port 6222| NATS3
        NATS1 <-->|Cluster Gossip<br/>Port 6222| NATS3
    end

    subgraph "ECS Fargate Cluster (Private Subnets)"
        API["Main API Service<br/>(Auth Callout Handler)"]

        NATS1 -.->|"Auth Callout<br/>$SYS.REQ.USER.AUTH"| API
        NATS2 -.->|"Auth Callout<br/>$SYS.REQ.USER.AUTH"| API
        NATS3 -.->|"Auth Callout<br/>$SYS.REQ.USER.AUTH"| API

        API -.->|"TLS Connection<br/>tls://cloudmap"| NATS1
    end

    subgraph "CloudMap Service Discovery (Internal)"
        PrivateCM["Private CloudMap<br/>cloudmap.shelby-dev.lixpi.dev.internal<br/>(Cluster Formation Only)"]

        NATS1 -->|Register Private IP| PrivateCM
        NATS2 -->|Register Private IP| PrivateCM
        NATS3 -->|Register Private IP| PrivateCM
    end

    subgraph "Route53 Service Discovery (External)"
        Lambda["Lambda Sidecar<br/>(IP Health Monitor)"]
        Lambda -->|Monitor Task Health| NATS1
        Lambda -->|Monitor Task Health| NATS2
        Lambda -->|Monitor Task Health| NATS3
        Lambda -->|Update A Record| NATSRecord
    end

    SecretsManager -->|Retrieve TLS Certs| NATS1
    SecretsManager -->|Retrieve TLS Certs| NATS2
    SecretsManager -->|Retrieve TLS Certs| NATS3

    Client["External WebSocket Clients"]
    Client -->|DNS Lookup| NATSRecord
    NATSRecord -->|Return Healthy IPs| Client
    Client -->|"Connect wss://nats.shelby-dev.lixpi.dev:443"| NATS1
```

### Key Architecture Points

1. **Dual Service Discovery**:
   - **CloudMap (Internal)**: Used only for NATS cluster formation between servers
   - **Route53 (External)**: Direct A records for client connections with certificate domain match

2. **Network Separation**:
   - **NATS Servers**: Public subnets (dual-homed with public IPs for client access)
   - **API Service**: Private subnets (connects to NATS via CloudMap internal DNS)

3. **Auth Callout Network Flow**:
   - API service uses TLS connection to CloudMap internal endpoint
   - NATS servers publish auth requests to `$SYS.REQ.USER.AUTH`
   - API service responds via trusted TLS connection for reply delivery

## Deployment Sequence

```mermaid
sequenceDiagram
    participant Pulumi
    participant Route53
    participant CaddyLambda
    participant SecretsManager
    participant ECS
    participant CloudMap
    participant SidecarLambda
    participant NATS
    participant API

    Note over Pulumi: Infrastructure Deployment Starts

    Pulumi->>Route53: Create subdomain hosted zone
    Pulumi->>CloudMap: Create private namespace (internal cluster)

    Note over Pulumi: Certificate Generation Phase
    Pulumi->>Route53: Create placeholder A record for nats.domain
    Pulumi->>CaddyLambda: Deploy certificate manager Lambda
    Pulumi->>CaddyLambda: Invoke certificate generation
    CaddyLambda->>Route53: DNS-01 challenge (TXT records)
    CaddyLambda->>SecretsManager: Store generated certificates

    Note over Pulumi: Service Discovery Setup
    Pulumi->>SidecarLambda: Deploy Route53 health monitor
    SidecarLambda->>Route53: Create initial NATS A record

    Note over Pulumi: NATS Cluster Deployment
    Pulumi->>ECS: Deploy NATS cluster (3 nodes)
    ECS->>NATS: Start NATS containers in public subnets
    NATS->>SecretsManager: Retrieve TLS certificates
    NATS->>CloudMap: Register internal IPs for cluster

    Note over NATS: Internal Cluster Formation
    NATS->>NATS: Gossip protocol discovers peers via CloudMap
    NATS->>NATS: Establish cluster routing (port 6222)

    Note over Pulumi: API Service Deployment
    Pulumi->>ECS: Deploy API service in private subnets
    ECS->>API: Start API container
    API->>NATS: Connect via TLS to CloudMap endpoint
    API->>NATS: Subscribe to $SYS.REQ.USER.AUTH (auth callout)

    Note over SidecarLambda: Health Monitoring Starts
    SidecarLambda->>ECS: Monitor NATS task state changes
    SidecarLambda->>NATS: Extract public IPs from healthy tasks
    SidecarLambda->>Route53: Update A record with healthy IPs

    Note over Pulumi: Client Access Ready
    Note over Route53: nats.shelby-dev.lixpi.dev → [IP1, IP2, IP3]
    Note over NATS: TLS certificates installed and auth callout active
```

## Local vs AWS Deployment Differences

### Local Development

#### NATS Configuration
- **Cluster**: 3-node cluster (lixpi-nats-1, lixpi-nats-2, lixpi-nats-3)
- **Ports**:
  - 4222: Client connections (exposed on first node only)
  - 8222: HTTP monitoring (exposed on first node only)
  - 9222: WebSocket TLS mapped to container port 443 (exposed on first node only)
  - 6222: Cluster routing (internal Docker network)
- **Auth**: FULL auth callout enabled - same as production!
  - Uses NKEY/XKEY authentication
  - Auth callout to lixpi-api service
- **Service Discovery**: Static routing via Docker container names
  - Routes: `nats://sys:sys_password147372yDHj2yr821@lixpi-nats-1:6222,nats://sys:sys_password147372yDHj2yr821@lixpi-nats-2:6222,nats://sys:sys_password147372yDHj2yr821@lixpi-nats-3:6222`
- **TLS**: ENABLED using Caddy-generated certificates
  - WebSocket TLS on port 9222 (host) → 443 (container)
  - Certificates from caddy-certs volume

#### Certificate Management
- **Caddy Mode**: `CADDY_LOCAL_MODE=true`
- **Certificate Authority**: Local CA generated by Caddy
- **Storage**: Docker volume (`caddy-certs`) mounted read-only to all NATS nodes
- **Certificate Path**: `/opt/nats/certs` in containers
- **Trust**: Manual browser/system trust of CA certificate required
- **Domain**: `localhost` (configured in lixpi-caddy service)

More details about how certificate validation works can be found in `infrastructure/pulumi/src/resources/certificate-manager/README.md`
That page describes how certificate validation works locally and when deployed to AWS.

### AWS Production Deployment

#### NATS Configuration
- **Cluster**: Multi-node HA cluster (default: 3 nodes)
- **Ports**:
  - 4222: Client connections (public)
  - 443: WebSocket TLS (public)
  - 6222: Cluster routing (VPC only)
  - 8222: HTTP monitoring (VPC only)
- **Auth**: Full auth callout to API service
- **Service Discovery**: CloudMap DNS-based discovery
- **TLS**: Required, uses Let's Encrypt certificates

#### Certificate Management
- **Caddy Mode**: Production mode (Lambda execution)
- **Certificate Authority**: Let's Encrypt via ACME
- **Storage**: AWS Secrets Manager
- **Trust**: Publicly trusted certificates
- **Domains**: Real domains (e.g., `nats.shelby-dev.lixpi.dev`)
- **Challenge**: Route53 DNS-01 challenges

```typescript
// AWS certificate storage
const secretName = `${prefix}-${domain.replace(/\*/g, 'wildcard').replace(/\./g, '-')}`
```

## Operational Relationships

### Service Dependencies

```mermaid
graph LR
    subgraph "Startup Dependencies"
        Cert[Certificate Manager] -->|Blocks| NATS[NATS Cluster]
        API[API Service] -->|Independent| Start
        Sidecar[Discovery Sidecar] -->|Independent| Start
    end

    subgraph "Runtime Dependencies"
        NATS -->|Auth Callout| API
        NATS -->|Public IP Discovery| Sidecar
        Client[Clients] -->|Connect| NATS
        Client -->|API Calls| API
    end
```

### Health Monitoring

1. **NATS Health**: `/healthz` endpoint on port 8222 (VPC internal only)
2. **ECS Health Checks**: HTTP checks every 30 seconds against `/healthz`
3. **Lambda Health Monitoring**: Monitors ECS task state changes via CloudWatch Events
4. **Route53 Health**: Automatic removal of unhealthy IPs from DNS A record
5. **Certificate Renewal**: Caddy Lambda checks every 30 days and auto-renews

### Health Management Flow

```mermaid
sequenceDiagram
    participant ECS as ECS Task
    participant CW as CloudWatch Events
    participant Lambda as Sidecar Lambda
    participant Route53 as Route53 A Record
    participant Client as WebSocket Client

    Note over ECS: NATS task health change occurs

    ECS->>CW: Emit task state change event
    CW->>Lambda: Trigger Lambda with event
    Lambda->>ECS: Query all NATS tasks in cluster
    Lambda->>Lambda: Filter RUNNING/HEALTHY tasks only
    Lambda->>ECS: Extract public IPs from healthy tasks

    alt Healthy IPs found
        Lambda->>Route53: UPSERT A record with healthy IPs
        Route53->>Client: DNS query returns healthy IPs only
        Client->>ECS: Connect to healthy NATS servers
    else No healthy IPs
        Lambda->>Route53: DELETE A record (remove all IPs)
        Note over Route53: DNS returns NXDOMAIN
        Note over Client: Connection attempts fail fast
    end
```

## Previously Resolved Issues (✅ COMPLETED)

### Issue 1: WebSocket TLS Connection Failures (✅ RESOLVED)

**Status: ✅ RESOLVED** - Certificate domain mismatch issue resolved by implementing Route53 direct A records.

#### Problem Description (Historical)
- **Certificate Domain**: `nats.shelby-dev.lixpi.dev` (manageable via Route53)
- **Previous Client Connection**: `nats.cloudmap.shelby-dev.lixpi.dev` (CloudMap managed)
- **Issue**: TLS certificate didn't match the connection hostname
- **Solution**: Clients now connect directly to `nats.shelby-dev.lixpi.dev` which matches the certificate

#### Root Cause
AWS CloudMap hosted zones cannot be modified by external Route53 API calls, preventing DNS-01 ACME challenges:
```
AccessDenied: The resource hostedzone/Z031739517RR5QFVEAK1X can only be managed through AWS Cloud Map
```

#### Solution Implemented: Route53 Direct A Records
- **Architecture Change**: Replaced public CloudMap with direct Route53 A records for client access
- **Certificate Match**: Clients connect directly to `nats.shelby-dev.lixpi.dev`, matching certificate domain
- **Health Preservation**: Lambda sidecar updates Route53 A records instead of CloudMap registrations
- **Native Load Balancing**: DNS returns multiple IPs, NATS clients handle failover automatically

### Issue 2: NATS Auth Callout Timeouts (✅ RESOLVED)

**Status: ✅ RESOLVED** - Auth callout failures resolved by changing API service connection protocol from `nats://` to `tls://`.

#### Problem Description (Historical)
- **Symptom**: Auth callout requests timing out, clients unable to authenticate
- **Initial Diagnosis**: Suspected network connectivity between API (private subnets) and NATS (public subnets)
- **Actual Cause**: Protocol mismatch between local development (`tls://`) and AWS deployment (`nats://`)

#### Root Cause Analysis
The auth callout mechanism requires **bidirectional trust** for reply operations:

1. **Subscription Phase** (works with both protocols):
   - API service subscribes to `$SYS.REQ.USER.AUTH` successfully
   - NATS publishes auth requests to subscribed API service

2. **Response Phase** (requires TLS trust):
   - API service calls `msg.respond()` to publish auth response
   - NATS server creates internal subscription: `acc.subscribeInternal(reply, processReply)`
   - **Plain `nats://` connections lack trust level to publish to internal reply subjects**
   - **TLS `tls://` connections establish trusted status required for reply inbox access**

#### Environment Configuration Fix

**Before (Broken)**:
```bash
# AWS .env.shelby-dev
NATS_SERVERS="nats://nats.cloudmap.shelby-dev.lixpi.dev.internal:4222"
```

**After (Working)**:
```bash
# AWS .env.shelby-dev
NATS_SERVERS="tls://nats.cloudmap.shelby-dev.lixpi.dev.internal:4222"

# Local .env.shelby-local (was already correct)
NATS_SERVERS="tls://lixpi-nats-1:4222, tls://lixpi-nats-2:4222, tls://lixpi-nats-3:4222"
```

#### Why This Issue Was Subtle
1. **Subscription worked**: API could receive auth requests from NATS
2. **Response failed silently**: `msg.respond()` calls timed out without clear errors
3. **Environment difference**: Local (TLS) vs AWS (plain) masked the real cause
4. **Trust level invisible**: Connection trust level not exposed in NATS client APIs

#### Technical Details from NATS Source Code
Analysis of `auth_callout.go` and `auth.go` revealed:
- `processClientOrLeafCallout()` function creates reply subscriptions via `acc.subscribeInternal()`
- Internal subscriptions require trusted connection status for security
- TLS connections automatically establish trust level, plain connections do not
- This is a deliberate security feature to prevent unauthorized access to internal subjects

## Current Architecture Benefits

### Route53 Direct A Records (✅ IMPLEMENTED)

**Status: ✅ PRODUCTION READY** - Dual service discovery architecture providing optimal client experience while maintaining cluster integrity.

#### Architecture Benefits
- **Certificate Domain Match**: Clients connect to `nats.shelby-dev.lixpi.dev`, matching certificate exactly
- **Simplified DNS Stack**: Direct Route53 A records eliminate CloudMap subdomain complexity for public access
- **Native NATS Load Balancing**: Multiple A record IPs enable NATS client-side failover and load distribution
- **Zero Additional Infrastructure**: No load balancers or proxies - respects NATS distributed architecture
- **Fast Health Propagation**: 60-second TTL for rapid DNS cache expiration on failures

#### Dual Service Discovery Architecture
1. **Internal (CloudMap)**: Private namespace for NATS cluster formation and API service connection
   - Domain: `nats.cloudmap.shelby-dev.lixpi.dev.internal`
   - Purpose: Server-to-server communication within VPC
   - Benefits: Automatic private IP registration, VPC-only accessibility

2. **External (Route53)**: Direct A records for client connections
   - Domain: `nats.shelby-dev.lixpi.dev`
   - Purpose: Client-to-cluster connections from internet
   - Benefits: Certificate domain match, health-based IP filtering

#### Health Management Capabilities
- **Zero Downtime Updates**: Route53 UPSERT operations atomically replace all IPs
- **Granular Health Filtering**: Only RUNNING/HEALTHY ECS tasks get IP registration
- **Automatic Failover**: Unhealthy IPs removed from DNS immediately via CloudWatch Events
- **Multi-IP Resilience**: Route53 A records natively support multiple IPs for redundancy

#### Implementation Details
- **CloudMap Preserved**: Internal cluster communication unchanged - maintains stability
- **Lambda Enhanced**: Service discovery sidecar evolved from CloudMap to Route53 operations
- **Permission Model**: Route53 ChangeResourceRecordSets replaces CloudMap permissions
- **Certificate Generation**: Unchanged - continues using manageable Route53 domain

### Avoided Anti-Patterns
- **No Application Load Balancer**: Maintains NATS's connection affinity and clustering protocol
- **No Proxy Layer**: Direct client-to-server connections preserve WebSocket performance
- **No Custom Health Checks**: Leverages ECS native health monitoring and CloudWatch Events
- **No Certificate Workarounds**: Domain name properly matches certificate for TLS validation

This architecture respects NATS's distributed nature while providing enterprise-grade reliability and observability.

## Current Implementation Status

- ✅ **Route53 Direct A Records**: Certificate domain match resolved, clients connect to `nats.shelby-dev.lixpi.dev`
- ✅ **Auth Callout TLS Protocol**: API service uses `tls://` connection for trusted auth callout responses
- ✅ **Lambda Certificate Manager**: Deployed with Route53 DNS-01 challenges and Secrets Manager storage
- ✅ **Dual Service Discovery**: CloudMap for internal cluster, Route53 for external clients
- ✅ **ECS Fargate Deployment**: Multi-node cluster in public subnets with health monitoring
- ✅ **WebSocket TLS Connections**: End-to-end encryption with Let's Encrypt certificates
- ✅ **Auth Callout Integration**: NKey/XKey encryption with Auth0 token validation

## Service Discovery Sidecar

The Lambda sidecar function handles the critical task of maintaining Route53 DNS records for client access:

### Core Responsibilities
1. **ECS Event Processing**: Monitors CloudWatch Events for NATS task state changes
2. **Health Validation**: Filters tasks to only include RUNNING/HEALTHY instances
3. **IP Extraction**: Retrieves public IP addresses from ECS task network interfaces
4. **Route53 Management**: Updates A record with atomic UPSERT operations
5. **Failure Handling**: Removes unhealthy IPs immediately via CloudWatch triggers

### Health Monitoring Flow
```typescript
// Lambda processes ECS task state changes
const healthyIPs = await getAllHealthyNatsTaskIPs(clusterArn)

if (healthyIPs.length > 0) {
    // Update Route53 with all healthy IPs atomically
    await updateRoute53Records(ROUTE53_HOSTED_ZONE_ID, NATS_RECORD_NAME, healthyIPs)
} else {
    // Remove A record entirely if no healthy servers
    await deleteRoute53Records(ROUTE53_HOSTED_ZONE_ID, NATS_RECORD_NAME)
}
```

This ensures that DNS always reflects the current set of healthy NATS servers, enabling fast client failover without load balancers.

## Key Configuration Files

### NATS Server Configuration (`nats-server.conf`)
```conf
# System account for cluster operations
system_account: SYS

accounts {
    SYS: {
        users: [{ user: sys, password: sys_password147372yDHj2yr821 }]
    }
    AUTH: {
        jetstream: enabled
        users: [{ user: regular_user, password: regular_password273yhfhheh273jhHBJMWH }]
    }
}

# Auth callout configuration requiring TLS connection
authorization {
    auth_callout {
        issuer: $NATS_AUTH_NKEY_ISSUER_PUBLIC
        account: AUTH
        auth_users: [ regular_user ]
        xkey: $NATS_AUTH_XKEY_ISSUER_PUBLIC
    }
}

# Cluster routing for multi-node deployment
cluster {
    name: "Lixpi-NATS"
    listen: 0.0.0.0:6222
    routes: [
        nats://sys:sys_password147372yDHj2yr821@nats.cloudmap.shelby-dev.lixpi.dev.internal:6222
    ]
}

# WebSocket TLS configuration
websocket {
    listen: 0.0.0.0:443
    tls {
        cert_file: "/opt/nats/certs/cert.pem"
        key_file: "/opt/nats/certs/key.pem"
    }
}
```

### Environment Configuration (Critical for Auth Callout)

**Local Development** (`.env.shelby-local`):
```bash
NATS_SERVERS="tls://lixpi-nats-1:4222, tls://lixpi-nats-2:4222, tls://lixpi-nats-3:4222"
NATS_AUTH_ACCOUNT="AUTH"
NATS_AUTH_NKEY_ISSUER_PUBLIC="UXXXXXX..."  # Account public key
NATS_AUTH_XKEY_ISSUER_PUBLIC="XXXXXV..."   # Curve public key for encryption
```

**AWS Production** (`.env.shelby-dev`):
```bash
NATS_SERVERS="tls://nats.cloudmap.shelby-dev.lixpi.dev.internal:4222"
NATS_AUTH_ACCOUNT="AUTH"
NATS_AUTH_NKEY_ISSUER_PUBLIC="UXXXXXX..."  # Same as local
NATS_AUTH_XKEY_ISSUER_PUBLIC="XXXXXV..."   # Same as local
```

**⚠️ Critical**: The `tls://` protocol prefix is **required** for auth callout functionality. Using `nats://` will cause authentication timeouts.

### Pulumi Infrastructure (`pulumiProgram.ts`)
```typescript
// Certificate generation MUST complete before NATS deployment
const natsClusterService = await createNatsClusterService({
    // ... other config
    dependencies: [caddyCertManager.initialCertificateGeneration], // 🔑 Critical dependency
    certificateHelper: natsCertHelper, // Access to TLS certificates
})

// Route53 direct A records for client access (not CloudMap)
parentHostedZoneId: subdomainDelegation.outputs.hostedZoneId,
natsRecordName: natsDomain, // nats.shelby-dev.lixpi.dev
```

### Certificate Manager (`cert-manager.sh`)
```bash
# Adaptive certificate generation with DNS pre-checks
adaptive_wait_for_cert() {
    local domain="$1"
    local max_wait=300
    local elapsed=0
    local wait_interval=5

    while [ $elapsed -lt $max_wait ]; do
        if caddy list-certificates | grep -q "$domain"; then
            return 0
        fi

        # Adaptive waiting: increase interval after initial attempts
        if [ $elapsed -gt 30 ]; then
            wait_interval=10
        fi

        sleep $wait_interval
        elapsed=$((elapsed + wait_interval))
    done
}
```

### Service Discovery Sidecar (`index.ts`)
```typescript
// Health-based Route53 A record management
const updateRoute53Records = async (
    hostedZoneId: string,
    recordName: string,
    publicIPs: string[]
): Promise<boolean> => {
    const changeRequest = {
        HostedZoneId: hostedZoneId,
        ChangeBatch: {
            Changes: [{
                Action: 'UPSERT',
                ResourceRecordSet: {
                    Name: recordName,              // nats.shelby-dev.lixpi.dev
                    Type: 'A',
                    TTL: 60,                       // Fast failover
                    ResourceRecords: publicIPs.map(ip => ({ Value: ip }))
                }
            }]
        }
    }

    return await route53Client.send(new ChangeResourceRecordSetsCommand(changeRequest))
}
```

These configurations work together to provide a fully functional NATS cluster with auth callout, health monitoring, and automatic certificate management.
