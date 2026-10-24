# LocalAuth0 Mock Service

The upstream image tag comes from [the version registry](../../dev-tools/versions-registry/README.md). Synchronize its central value before rebuilding the local mock image.

LocalAuth0 is a zero-configuration Auth0 mock service for local development, enabling the Lixpi application to run completely offline without requiring an Auth0 account.

## Purpose

- **Zero-configuration setup**: Automatically initializes on first `docker compose up`
- **No Auth0 account required**: Perfect for open-source contributors and local development
- **Production-like behavior**: Uses same RS256 JWT signatures and OAuth flows as real Auth0
- **Repeatable configuration**: The image loads the fixed identity, claims, and permissions from its TOML file on startup

## How It Works

When `VITE_MOCK_AUTH=true` and `MOCK_AUTH0=true` are set in your local environment:

1. **LocalAuth0 container starts** and generates random RSA keypairs for JWT signing
2. **The TOML configuration loads**, supplying:
   - Default test user (`test@local.dev`)
   - Profile fields and the fixed admission claim
   - Permissions for the API audience
3. **Web-UI redirects** to LocalAuth0 instead of real Auth0 for authentication
4. **API service validates** JWTs using LocalAuth0's JWKS endpoint
5. **Authentication works offline** after the images are built

## Automatic Initialization

The image loads `localauth0.toml` through `LOCALAUTH0_CONFIG_PATH`. It fixes the issuer to `http://localhost:3000/` and subject to `local|test-user-001`. Its admission claim is `https://lixpi.ai/admission: { v: 1, epoch: 1 }`. A small patch adds JSON-valued custom claims to the pinned upstream release; existing string/list claims keep their format. The Docker build compiles the server and browser frontend from that release with their Cargo lockfiles. The frontend patch declares Trunk's Rust entry point, enables the WebAssembly randomness features, and makes its JavaScript redirect return the promise expected by Rust. The build rejects output without a module loader or WebAssembly binary. Trunk's version comes from the version registry. When updating the upstream image version, update the source commit and review both patches in the same change. `init-localauth0.sh` is an optional API configuration helper; the image does not run or include it.

Both compilers use two jobs and BuildKit memory mounts for Cargo downloads and intermediate outputs. Those temporary files consume build memory instead of accumulating in Docker's disk cache. The [API's opt-in local authentication test](../api/README.md) checks the served frontend assets and authenticated application requests against the running mock.

The public DynamoDB initializer loads the matching account fixture after preparing application tables. It belongs to the `main` and `deploy` profiles, and Compose waits for its successful exit before starting the API. Compose defaults `LOCAL_DYNAMODB_FORCE_RECREATE` to `false`, so repeated setup preserves existing tables. The fixture creates the fixed user, personal organization, owner membership, and `Account-Admission-<ORG_NAME>-<STAGE>` row in one conditional transaction. A coherent older mock account keeps its existing personal organization. Repeated loading validates the records and does not rewrite them. Partial or ambiguous records fail with a repair instruction.

The fixture requires `ENVIRONMENT=local`, both mock flags enabled, the fixed mock issuer, and a local DynamoDB endpoint. Real Auth0 mode skips it; mismatched flags and hosted database endpoints are refused. It creates the admission table only when absent and never recreates tables or deletes records. Hosted admission tables belong to the private provisioner, not the main Pulumi stack.

Build the tooling and mock images through Compose:

```bash
docker compose --env-file .env.shelby-local build lixpi-pulumi-init lixpi-localauth0
```

To load or validate the fixture without running the table initializer:

```bash
docker compose --env-file .env.shelby-local run --rm --no-deps -T lixpi-pulumi-init pnpm run fixture:local load
docker compose --env-file .env.shelby-local run --rm --no-deps -T lixpi-pulumi-init pnpm run fixture:local validate
```

For an existing partial mock account, stop application writers, inspect its organization grants, then run `fixture:local repair <existing-organization-id>` through the same container. The selected organization must already grant this fixed user owner access. Repair adds only a missing user association, matching owner membership, or fixed user record. It can replace this fixture's active epoch-1 receipt after an explicitly requested table reset; it refuses conflicting roles, email, blocked/reconciling/superseded receipts, and another epoch or identity. `fixture:local repair new` is allowed only when the fixed user has no organization association, membership, or embedded grant. All writes remain conditional. These commands accept no arbitrary user identity.

For isolated verification, the same image can run on a disposable Docker network against a DynamoDB Local container with network alias `lixpi-dynamodb`, port 8000, and `-inMemory -sharedDb`. Pass the explicit local fixture environment variables and run `pnpm run deploy:local`, followed by `pnpm run fixture:local validate`. Do not attach a persistent database volume to that verification container.

## Web UI

Access the LocalAuth0 web interface at:

```
http://localhost:3000
```

Here you can:
- View and generate JWTs
- Manage permissions for different audiences
- Configure custom claims
- Update user information
- Rotate JWKS keys

## API Endpoints

### Authentication

- `POST /oauth/token` - Get a fresh JWT
  ```json
  {
    "client_id": "client_id",
    "client_secret": "client_secret",
    "audience": "http://localhost:3005",
    "grant_type": "client_credentials"
  }
  ```

- `GET /authorize` - SSO authorization endpoint (used by web-ui)
  - Query params: `redirect_uri`, `audience`, `response_type=token`, `bypass=true`
  - Returns access token in URL fragment

### JWKS

- `GET /.well-known/jwks.json` - Fetch JWKS (used by API for JWT verification)
- `GET /rotate` - Rotate JWKs (discard oldest, generate new)
- `GET /revoke` - Revoke all JWKs (replace with 3 new ones)

### User Management

- `GET /oauth/token/user_info` - Get current user info
- `POST /oauth/token/user_info` - Update user info
  ```json
  {
    "subject": "local|test-user-001",
    "name": "Test User",
    "email": "test@local.dev",
    "email_verified": true
  }
  ```

### Custom Claims

- `GET /oauth/token/custom_claims` - Get custom claims
- `POST /oauth/token/custom_claims` - Set custom claims
  ```json
  {
    "custom_claims": [
      { "name": "https://lixpi.ai/admission", "value": { "Json": { "v": 1, "epoch": 1 } } }
    ]
  }
  ```

### Permissions

- `GET /permissions` - Get all audience permissions
- `GET /permissions/{audience}` - Get permissions for specific audience
- `POST /permissions` - Set permissions for audience
  ```json
  {
    "audience": "http://localhost:3005",
    "permissions": ["user:read", "user:write", "ai:chat"]
  }
  ```

## Configuration

Edit [localauth0.toml](localauth0.toml) and rebuild the mock image to change its startup configuration. Upstream also accepts `LOCALAUTH0_CONFIG` as inline TOML; it takes precedence over `LOCALAUTH0_CONFIG_PATH`. The fixed account fixture requires the configured issuer, subject, and admission epoch, so arbitrary identities are outside this mock setup.

## Default Test User

The automatically configured test user:

```
User ID: local|test-user-001
Email: test@local.dev
Name: Test User
Given Name: Test
Family Name: User
Custom Claims:
  - https://lixpi.ai/admission: { v: 1, epoch: 1 }
```

## Runtime State

LocalAuth0 keeps signing keys and API configuration changes in memory. Restarting it generates new keys and reloads the startup configuration. Existing tokens may therefore fail validation after a restart; sign in again. Compose mounts a `localauth0-data` volume, but this upstream release does not persist those caches there. Application users, organizations, memberships, and admission records live separately in DynamoDB Local and follow the fixture preservation and repair rules above.

## Troubleshooting

### Container Won't Start

Check Docker logs:
```bash
docker logs lixpi-localauth0
```

Verify health check:
```bash
docker compose ps lixpi-localauth0
```

### Configuration Does Not Load

Check `docker logs lixpi-localauth0` for TOML parse errors and confirm the image was rebuilt after editing the configuration. The upstream loader falls back to its defaults when parsing fails, so a successful JWKS health check alone does not verify the fixed identity or admission claim. Fixture validation checks DynamoDB records separately.

### JWT Validation Errors

Common causes:
- **Issuer mismatch**: API expects `http://localhost:3000/` but LocalAuth0 configured differently
- **Audience mismatch**: Ensure audience matches `AUTH0_API_IDENTIFIER` (default: `http://localhost:3005`)
- **JWKS not accessible**: API container can't reach `http://lixpi-localauth0:3000/.well-known/jwks.json`

Debug by checking:
```bash
# From API container
docker exec lixpi-api wget -q -O- http://lixpi-localauth0:3000/.well-known/jwks.json

# From host
curl http://localhost:3000/.well-known/jwks.json
```

### Token Not Stored in Browser

Check browser console for errors. LocalAuth0 redirect should include `#access_token=...` in URL fragment.

If missing:
1. Verify redirect URL in `auth0-service.ts` includes `bypass=true`
2. Check LocalAuth0 logs for authorization errors
3. Ensure `VITE_MOCK_AUTH=true` is set

## Production Safety

LocalAuth0 automatically prevents usage in non-local environments:

- **API Service** (`server.ts`): Checks `ENVIRONMENT !== 'local'` and throws fatal error if LocalAuth0 URLs detected
- **Web-UI** (`main.ts`): Checks `MODE === 'production'` and throws error if `VITE_MOCK_AUTH=true`

These guards reject mock authentication outside the supported local configuration.

## Differences from Real Auth0

While LocalAuth0 mimics most Auth0 functionality, there are some differences:

- **No social login**: LocalAuth0 doesn't support Google, GitHub, etc. providers
- **No MFA**: Multi-factor authentication is not implemented
- **No user database**: Only one user at a time (sufficient for local development)
- **Random keypairs**: RSA keys are randomly generated on startup (vs Auth0's stable keys)
- **Simplified flows**: The mock implements local token and authorization-code flows without hosted signup, email proof, or account linking

For local development, these limitations are acceptable. Production deployments use real Auth0.

## Technical Details

- **Image**: The version registry pins the upstream runtime image; the Dockerfile pins the matching source commit and applies the structured-claim patch
- **Language**: Rust
- **Ports**:
  - `3000` - HTTP API and Web UI
  - `3001` - HTTPS (if configured)
- **Health Check**: HTTP request to `/.well-known/jwks.json`

## Further Reading

- [LocalAuth0 GitHub Repository](https://github.com/primait/localauth0)
- [Auth0 Documentation](https://auth0.com/docs)
- [JWT.io - Decode and verify JWTs](https://jwt.io)
