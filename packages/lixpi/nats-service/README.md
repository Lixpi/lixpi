# Lixpi NATS Service

Shared NATS client implementation for both Python and TypeScript services.

Provides a unified API for NATS messaging with support for:
- Connection management with automatic reconnection
- Publish/subscribe patterns
- Request/reply patterns
- Queue groups for load balancing
- JetStream Object Store for file/blob storage
- Optional self-issued JWT authentication via NKeys

## ⚠️ CRITICAL: Keeping TypeScript and Python Versions in Sync

**THIS IS EXTREMELY IMPORTANT!** Both the TypeScript (`ts/nats-service.ts`) and Python (`python/nats_service.py`) implementations **MUST** remain synchronized.

### Why This Matters

Both versions are used across different services in the Lixpi ecosystem:
- **TypeScript version**: Used by `lixpi-api` and other Node.js services
- **Python version**: Used by `lixpi-llm-api` and other Python services

Any bug fix, feature addition, or behavioral change in one version **MUST** be replicated in the other version to maintain consistency across the entire system.

### Synchronization Rules

1. **Structure Alignment**: Both implementations follow the same structure:
   - Same class/method organization
   - Same configuration options
   - Same error handling patterns
   - Same connection retry behavior
   - Same middleware support

2. **Method Signatures**: Keep method signatures as similar as possible:
   ```typescript
   // TypeScript
   subscribe(subject: string, handler: MessageHandler, options: SubscriptionOptions, payloadType: 'json' | 'buffer')
   ```
   ```python
   # Python
   async def subscribe(subject: str, handler: Callable, options: Dict[str, str], payload_type: str)
   ```

3. **Behavior Parity**: Both versions must:
   - Handle connection failures the same way (retry without crashing)
   - Use identical timeout defaults (`initialConnectTimeout = 2s`, `request timeout = 3s`)
   - Apply the same authentication priority (NKey JWT → Token → User/Pass)
   - Log messages in the same format

4. **When Making Changes**:
   - ✅ **DO**: Update both TypeScript AND Python versions
   - ✅ **DO**: Test both implementations after changes
   - ✅ **DO**: Keep comments and documentation in sync
   - ✅ **DO**: Match error messages across both versions
   - ❌ **DON'T**: Change one version without updating the other
   - ❌ **DON'T**: Add features to only one implementation
   - ❌ **DON'T**: Fix bugs in only one version

5. **Known Acceptable Differences**:
   - **Async/Sync**: Python NATS is fully async, TypeScript allows sync methods for publish/subscribe
   - **Naming**: Python uses `snake_case`, TypeScript uses `camelCase`
   - **Status Monitoring**: TypeScript has status iterator, Python uses callbacks (inherent library difference)
   - **TLS Config**: Python has explicit `tls_ca_cert` parameter (platform difference)
   - **Type System**: Python uses type hints, TypeScript uses native types

6. **Validation Checklist** (use this when making changes):
   ```
   [ ] Updated TypeScript version (js/nats-service.ts)
   [ ] Updated Python version (python/nats_service.py)
   [ ] Connection retry works identically in both
   [ ] Authentication flow matches
   [ ] Error messages are consistent
   [ ] Timeout values are the same
   [ ] Both versions tested in their respective services
   [ ] README updated if API changed
   ```

### TypeScript is the Source of Truth

When in doubt about behavior or implementation details, **refer to the TypeScript version** (`ts/nats-service.ts`) as the authoritative source. The Python version should mirror its behavior as closely as Python idioms allow.

---

## Structure

```
packages/lixpi/nats-service/
├── ts/                      # TypeScript package
│   ├── nats-service.ts      # Main implementation
│   └── package.json
├── python/                  # Python package
│   ├── __init__.py
│   ├── nats_service.py      # Main implementation
│   └── pyproject.toml
└── README.md
```

## Usage

### TypeScript

```typescript
import NatsService, { generateSelfIssuedJWT } from '@lixpi/nats-service'
import type { NatsServiceConfig } from '@lixpi/nats-service'

// Basic authentication with token
const config: NatsServiceConfig = {
    servers: ['nats://localhost:4222'],
    name: 'my-service',
    token: 'your-token'
}

// Or with self-issued JWT (for services that require it)
const configWithJWT: NatsServiceConfig = {
    servers: ['nats://nats.example.com:4222'],
    name: 'llm-service',
    nkeySeed: process.env.NATS_NKEY_SEED,
    userId: 'svc:llm-service'
}

// Initialize and connect
const natsService = await NatsService.init(config)

// Publish
natsService.publish('subject.name', { message: 'hello' })

// Subscribe
await natsService.subscribe(
    'subject.name',
    async (data, msg) => {
        console.log('Received:', data)
    },
    { queue: 'workers' }  // Optional queue group
)

// Request/reply
const response = await natsService.request('subject.name', { query: 'data' })

// Reply handler
await natsService.reply(
    'subject.name',
    async (data, msg) => {
        return { result: 'processed' }
    },
    { queue: 'workers' }
)

// Disconnect
await natsService.disconnect()
```

### JetStream Object Store (TypeScript)

```typescript
// Create an Object Store bucket
const os = await natsService.createObjectStore('my-bucket', {
    description: 'My object store',
    maxBytes: 1024 * 1024 * 100  // 100MB
})

// Or open an existing bucket
const os = await natsService.getObjectStore('my-bucket')

// Store an object (bytes)
const data = new TextEncoder().encode('Hello World')
await natsService.putObject('my-bucket', 'hello.txt', data)

// Store from a ReadableStream
await natsService.putObjectFromReadable('my-bucket', 'large-file.bin', readableStream)

// Retrieve an object as bytes
const content = await natsService.getObject('my-bucket', 'hello.txt')

// Retrieve as a stream
const stream = await natsService.getObjectStream('my-bucket', 'large-file.bin')

// Get object metadata
const info = await natsService.getObjectInfo('my-bucket', 'hello.txt')

// List all objects
const objects = await natsService.listObjects('my-bucket')

// Delete an object
await natsService.deleteObject('my-bucket', 'hello.txt')

// Delete a bucket
await natsService.deleteObjectStore('my-bucket')
```

### Python

```python
from lixpi_nats_service import NatsService, NatsServiceConfig, generate_self_issued_jwt

# Basic authentication with token
config = NatsServiceConfig(
    servers=["nats://localhost:4222"],
    name="my-service",
    token="your-token"
)

# Or with self-issued JWT (for services that require it)
config_with_jwt = NatsServiceConfig(
    servers=["nats://nats.example.com:4222"],
    name="llm-service",
    nkey_seed=os.environ["NATS_NKEY_SEED"],
    user_id="svc:llm-service",
    tls_ca_cert="/path/to/ca.crt"  # Optional TLS CA certificate
)

# Initialize and connect
nats_service = await NatsService.init(config)

# Publish
nats_service.publish("subject.name", {"message": "hello"})

# Subscribe
async def message_handler(data, msg):
    print(f"Received: {data}")

await nats_service.subscribe(
    "subject.name",
    message_handler,
    queue="workers"  # Optional queue group
)

# Request/reply
response = await nats_service.request("subject.name", {"query": "data"})

# Reply handler
async def reply_handler(data, msg):
    return {"result": "processed"}

await nats_service.reply(
    "subject.name",
    reply_handler,
    queue="workers"
)

# Disconnect
await nats_service.disconnect()
```

### JetStream Object Store (Python)

```python
# Create an Object Store bucket
from nats.js.api import ObjectStoreConfig

os = await nats_service.create_object_store("my-bucket", ObjectStoreConfig(
    description="My object store",
    max_bytes=1024 * 1024 * 100  # 100MB
))

# Or open an existing bucket
os = await nats_service.get_object_store("my-bucket")

# Store an object (bytes)
await nats_service.put_object("my-bucket", "hello.txt", b"Hello World")

# Store from a file stream
with open("large-file.bin", "rb") as f:
    await nats_service.put_object_from_readable("my-bucket", "large-file.bin", f)

# Retrieve an object as bytes
content = await nats_service.get_object("my-bucket", "hello.txt")

# Retrieve by streaming to a file
with open("output.bin", "wb") as f:
    await nats_service.get_object_stream("my-bucket", "large-file.bin", f)

# Get object metadata
info = await nats_service.get_object_info("my-bucket", "hello.txt")

# List all objects
objects = await nats_service.list_objects("my-bucket")

# Delete an object
await nats_service.delete_object("my-bucket", "hello.txt")

# Delete a bucket
await nats_service.delete_object_store("my-bucket")
```

## Self-Issued JWT Authentication

Some services (like `llm-api`) use self-issued JWT authentication with NKeys for enhanced security. This is optional and only needed for specific deployment scenarios.

### How it works:

1. Service has an NKey seed (secret key)
2. On connection, service generates a JWT signed with its NKey
3. JWT includes service identity (e.g., `svc:llm-service`)
4. NATS server validates the JWT using the service's public key

### TypeScript Example:

```typescript
import { generateSelfIssuedJWT } from '@lixpi/nats-service'

const jwt = generateSelfIssuedJWT(
    nkeySeed: 'SU...',           // Your NKey seed
    userId: 'svc:my-service',    // Service identity
    expiryHours: 1               // Token validity (default: 1 hour)
)

const config = {
    servers: ['nats://nats.example.com:4222'],
    nkeySeed: process.env.NATS_NKEY_SEED,
    userId: 'svc:my-service'
}
```

### Python Example:

```python
from lixpi_nats_service import generate_self_issued_jwt

jwt = generate_self_issued_jwt(
    nkey_seed='SU...',           # Your NKey seed
    user_id='svc:my-service',    # Service identity
    expiry_hours=1               # Token validity (default: 1 hour)
)

config = NatsServiceConfig(
    servers=["nats://nats.example.com:4222"],
    nkey_seed=os.environ["NATS_NKEY_SEED"],
    user_id="svc:my-service"
)
```

## Configuration Options

### Common Options (both languages)

- `servers`: List of NATS server URLs (default: `["nats://localhost:4222"]`)
- `name`: Client name for identification
- `token`: Authentication token
- `user`/`password` (or `pass` in TS): Basic authentication
- `nkey_seed`/`nkeySeed`: NKey seed for self-issued JWT
- `user_id`/`userId`: User ID for JWT subject (used with `nkey_seed`)

### Python-specific Options

- `tls_ca_cert`: Path to TLS CA certificate
- `max_reconnect_attempts`: Maximum reconnection attempts (-1 for infinite)
- `reconnect_time_wait`: Wait time between reconnections in seconds

### TypeScript-specific Options

- `webSocket`: Use WebSocket transport instead of TCP
- `subscriptions`: Pre-configure subscriptions on connection
- `middleware`: Global message middleware
- `replyMiddleware`: Middleware for reply handlers

## Features

### Connection Management

- Automatic reconnection with configurable retry
- Connection status monitoring
- Graceful shutdown with drain

### Messaging Patterns

- **Publish**: Fire-and-forget messages
- **Subscribe**: Receive messages on a subject
- **Request/Reply**: Synchronous request-response pattern
- **Queue Groups**: Load balancing across multiple subscribers

### JetStream Object Store

- **Bucket Management**: Create, open, delete Object Store buckets
- **Object Operations**: Put, get, delete objects
- **Streaming**: Stream large objects without loading into memory
- **Metadata**: Get object info and list objects in buckets

### Payload Types

- JSON (default): Automatic encoding/decoding
- Buffer: Raw byte data

## Authentication Methods

1. **Token**: Simple token-based auth
2. **User/Password**: Basic authentication
3. **Self-Issued JWT**: Advanced authentication with NKeys (optional, for specific services)

## Examples

See the respective service implementations for real-world usage:
- TypeScript: `services/api/src/NATS/`
- Python: `services/llm-api/src/` (uses self-issued JWT)
