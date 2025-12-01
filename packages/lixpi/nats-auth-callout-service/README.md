# NATS Auth Callout Service

Centralized authentication and authorization for NATS using the auth_callout mechanism. This service handles all authentication requests for the NATS cluster, supporting both user authentication via Auth0 and service-to-service authentication using self-issued JWTs.

## Overview

NATS auth_callout delegates authentication decisions to an external service (this one). Instead of hardcoding users and permissions in NATS server config, every connection attempt is verified by calling this service. It decides whether to allow or deny the connection and what permissions to grant.

The service is completely generic - it doesn't know anything about specific services. All service configurations are passed during initialization, making it trivial to add new services without touching the auth code.

## How It Works

When a client tries to connect to NATS:
1. NATS server intercepts the connection and sends auth request to `$SYS.REQ.USER.AUTH`
2. This service receives the encrypted auth request
3. Decrypts it and extracts the client's token
4. Verifies the token (either Auth0 JWT or self-issued service JWT)
5. Returns a signed user JWT with appropriate permissions
6. NATS server allows/denies connection based on the response

## Authentication Modes

### Auth0 (Regular Users)

Used by web UI and API endpoints. Users authenticate with Auth0 and get an access token. The auth callout verifies it against Auth0's JWKS endpoint.

- Token expiration enforced
- Full audit trail via Auth0
- User-specific permissions via `{userId}` templating in subscription configs

### Self-Issued JWTs (Internal Services)

Used for machine-to-machine communication (like `llm-api`). Services sign their own JWTs using NKeys (Ed25519 keypairs).

**Why not use Auth0 for services?**
- Extra latency on every connection
- Complexity of OAuth2 client credentials flow
- External dependency for internal communication
- Additional Auth0 API costs

**Why this is better:**
- Cryptographic signatures (Ed25519) instead of shared passwords
- Short-lived tokens (1 hour) that auto-rotate on reconnect
- Zero hardcoded logic - all service configs passed at init
- No password management headaches

## Usage

### Basic Setup

```typescript
import { startNatsAuthCalloutService } from '@lixpi/nats-auth-callout-service'

await startNatsAuthCalloutService({
    natsService: natsServiceInstance,
    subscriptions: [...], // Your NATS subscriptions
    nKeyIssuerSeed: process.env.NATS_AUTH_NKEY_ISSUER_SEED,
    xKeyIssuerSeed: process.env.NATS_AUTH_XKEY_ISSUER_SEED,
    jwtAudience: process.env.AUTH0_API_IDENTIFIER,
    jwtIssuer: `${process.env.AUTH0_DOMAIN}/`,
    jwksUri: `${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
    natsAuthAccount: 'AUTH',
    serviceAuthConfigs: [
        // Service configurations go here
    ]
})
```

### Adding a Service

To allow a new service to authenticate:

1. **Generate NKey pair:**
   ```bash
   nsc generate nkey --account
   ```
   This gives you a seed (SU...) and public key (UA...).

2. **Add to environment:**
   ```bash
   NATS_MY_SERVICE_NKEY_SEED=SU...
   NATS_MY_SERVICE_NKEY_PUBLIC=UA...
   ```

3. **Configure auth callout:**
   ```typescript
   serviceAuthConfigs: [
       {
           publicKey: env.NATS_MY_SERVICE_NKEY_PUBLIC,
           userId: 'svc:my-service',
           permissions: {
               pub: { allow: ["my.service.responses"] },
               sub: { allow: ["my.service.requests"] }
           }
       }
   ]
   ```

4. **Service generates JWT:**
   The service signs a JWT with its NKey seed:
   ```python
   # Python example (see llm-api for full implementation)
   jwt_payload = {
       "sub": "svc:my-service",
       "iss": public_key,
       "iat": now,
       "exp": now + 3600
   }
   # Sign with NKey and send in NATS connect options
   ```

That's it. No changes to the auth callout code needed.

## Security

### NKey Management

**Seeds are secrets** - they're like private keys. Store them in:
- Environment variables for local dev
- AWS Secrets Manager for production
- **Never** commit to git

**Public keys are safe to share** - they're distributed to any service that needs to verify signatures.

**Rotation**: Change NKeys if compromised or every 90 days. Update both seed and public key in all relevant places.

### Permissions

Each service gets minimal permissions for its specific use case. The `svc:` prefix clearly identifies service accounts vs real users.

Example for llm-api:
- Can publish to `ai.interaction.chat.error.*` and `ai.interaction.chat.receiveMessage.*`
- Can subscribe to `ai.interaction.chat.process` and `ai.interaction.chat.stop.*`
- **Cannot** use `_INBOX.*` (no request-reply)
- **Cannot** publish to system subjects
- **Cannot** access admin operations

### Monitoring

Watch for:
- Failed auth attempts from `svc:*` identities
- JWT signature verification failures (possible key compromise)
- Permission violations
- Connections from unexpected IPs

Set alerts for >5 failed auths or >10 permission violations per minute.

## Architecture

**Generic by design** - the auth callout has zero knowledge of specific services. All policies are defined where services are configured (in `server.ts`), not in the auth code.

This means:
- Adding a service: 4 lines of config
- No need to modify/redeploy auth callout
- Clear separation: auth callout verifies signatures, caller defines policies
- Easy to audit (all service permissions in one place)

## Reference

See `services/llm-api/src/nats_client/client.py` for a complete example of a service implementing self-issued JWT authentication.

For NATS server configuration, see `services/nats/nats-server.conf` - look for the `auth_callout` section.
