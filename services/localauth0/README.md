# LocalAuth0 Mock Service

LocalAuth0 is a zero-configuration Auth0 mock service for local development, enabling the Lixpi application to run completely offline without requiring an Auth0 account.

## Purpose

- **Zero-configuration setup**: Automatically initializes on first `docker-compose up`
- **No Auth0 account required**: Perfect for open-source contributors and local development
- **Production-like behavior**: Uses same RS256 JWT signatures and OAuth flows as real Auth0
- **Persistent state**: User configurations and permissions persist between container restarts

## How It Works

When `VITE_MOCK_AUTH=true` is set in your environment:

1. **LocalAuth0 container starts** and generates random RSA keypairs for JWT signing
2. **Initialization script runs** automatically, configuring:
   - Default test user (`test@local.dev`)
   - Custom claims (e.g., `stripe_customer_id`)
   - Permissions for the API audience
3. **Web-UI redirects** to LocalAuth0 instead of real Auth0 for authentication
4. **API service validates** JWTs using LocalAuth0's JWKS endpoint
5. **Everything works offline** - no internet connection required

## Automatic Initialization

On container startup, `init-localauth0.sh` automatically:

- Waits for LocalAuth0 to be healthy
- Configures custom claims via POST to `/oauth/token/custom_claims`
- Sets user info via POST to `/oauth/token/user_info`
- Configures permissions for audience `http://localhost:3005`

No manual configuration needed!

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
    "client_id": "mock-client-id",
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
    "custom_claims": [{
      "name": "stripe_customer_id",
      "value": "cus_mock_stripe_test"
    }]
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

LocalAuth0 is configured via inline environment variable in `docker-compose.yml`:

```yaml
environment:
  LOCALAUTH0_CONFIG: |
    issuer = "http://localhost:3000/"

    [user_info]
    subject = "local|test-user-001"
    email = "test@local.dev"
    name = "Test User"
    # ... more fields
```

You can also mount a `localauth0.toml` file if preferred. See `services/localauth0/localauth0.toml` for reference.

## Default Test User

The automatically configured test user:

```
User ID: local|test-user-001
Email: test@local.dev
Name: Test User
Given Name: Test
Family Name: User
Custom Claims:
  - stripe_customer_id: cus_mock_stripe_test
```

## Persistent Storage

LocalAuth0 state is persisted in the `localauth0-data` Docker volume. This includes:
- Generated RSA keypairs
- User configurations
- Custom claims
- Permissions

To reset to defaults, remove the volume:
```bash
docker-compose down
docker volume rm lixpi_localauth0-data
docker-compose up
```

## Troubleshooting

### Container Won't Start

Check Docker logs:
```bash
docker logs lixpi-localauth0
```

Verify health check:
```bash
docker-compose ps lixpi-localauth0
```

### Init Script Fails

View init script logs:
```bash
docker logs lixpi-localauth0-init
```

The init script retries up to 30 times with 2-second intervals. If it still fails:
1. Ensure LocalAuth0 container is healthy
2. Check network connectivity between containers
3. Verify `init-localauth0.sh` has executable permissions

### JWT Validation Errors

Common causes:
- **Issuer mismatch**: API expects `http://localhost:3000/` but LocalAuth0 configured differently
- **Audience mismatch**: Ensure audience matches `AUTH0_API_IDENTIFIER` (default: `http://localhost:3005`)
- **JWKS not accessible**: API container can't reach `http://localauth0:3000/.well-known/jwks.json`

Debug by checking:
```bash
# From API container
curl http://localauth0:3000/.well-known/jwks.json

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

This ensures LocalAuth0 can never accidentally be used in staging or production deployments.

## Differences from Real Auth0

While LocalAuth0 mimics most Auth0 functionality, there are some differences:

- **No social login**: LocalAuth0 doesn't support Google, GitHub, etc. providers
- **No MFA**: Multi-factor authentication is not implemented
- **No user database**: Only one user at a time (sufficient for local development)
- **Random keypairs**: RSA keys are randomly generated on startup (vs Auth0's stable keys)
- **Simplified flows**: Only implicit grant and client credentials are fully supported

For local development, these limitations are acceptable. Production deployments use real Auth0.

## Technical Details

- **Image**: `public.ecr.aws/primaassicurazioni/localauth0:0.8.*`
- **Language**: Rust
- **Ports**:
  - `3000` - HTTP API and Web UI
  - `3001` - HTTPS (if configured)
- **Volume**: `/data` - Persistent state storage
- **Health Check**: `/localauth0 healthcheck` command

## Further Reading

- [LocalAuth0 GitHub Repository](https://github.com/primait/localauth0)
- [Auth0 Documentation](https://auth0.com/docs)
- [JWT.io - Decode and verify JWTs](https://jwt.io)
