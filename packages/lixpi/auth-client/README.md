# Auth Client

Dependency versions in `package.json` are generated from [the version registry](../../../dev-tools/versions-registry/README.md). Edit the central entry and synchronize before rebuilding a consuming service.

`@lixpi/auth-client` contains browser authentication and current-user loading for Lixpi web clients. Each client instance owns its Auth0 or LocalAuth0 adapter, auth and user Nano Stores, authenticated session, and `users.get` request flow.

The package does not start a browser application, connect to NATS, or mount UI automatically. A service composition root maps its transport-neutral auth session into its own connection dependency, then injects that dependency into `@lixpi/web-client-service-factory`. Its optional `AuthenticationFailure` view displays a branded UI-kit page with one Sign in button. Consumers import `@lixpi/ui-kit/styles/auth-panel` once at their application root. The panel starts the configured Auth0 SDK flow without checking whether an email or account exists. Auth0 owns registration; automatic email signup depends on the deployed connection policy.

`AuthenticationFailure.show(target, true)` displays a generic retry message after a known failure. A normal signed-out visit has no error message, and neither view exposes provider diagnostics or account status. Failed button redirects also leave this generic retry available. `initializeSession()` returns `null` when no token is available and propagates callback errors, allowing the composition to distinguish signed-out visits from rejected callbacks.

`initializeSession()` returns `userId` from the access token's subject alongside the token and refresh functions. This decoded value selects a client routing namespace; it is not an authorization decision. The NATS auth callout and application responders verify the token independently.

The configured `redirectUri` also defines the application's canonical origin. `initializeSession()`, `init()` and `login()` replace a different origin before initializing the SDK or consuming a session handoff. This makes direct visits to local HTTP ports safe when callbacks use Caddy HTTPS: the SDK's transaction, state and PKCE verifier are created on the same origin that receives the callback. Ordinary paths, queries, fragments and handoff hints survive the move. Callback parameters from a different origin are discarded rather than forwarded. The auth store stays loading and redirecting during navigation so consumers retain their loading layer. Disabled authentication does not redirect.

Standard Auth0 tenant hostnames (`auth0.com` and its subdomains) use the application's sign-in page. A signed-out visit or return from logout waits for Sign in. Token acquisition asks the SDK to use its cached access or refresh token even when the ID token or remembered-session cookie has expired. Standard tenants disable iframe fallback, so an empty origin does not wait for third-party cookie access. Custom Auth0 hostnames use silent session acquisition followed, when necessary, by hosted login. The auth store's `isRedirecting` flag lets the application keep its loading view during that handoff instead of flashing another sign-in form.

Application navigation uses `authClient.createSessionHandoffUrl(configuredDestination)`. Its `auth=continue` marker and randomly salted account hash carry no credentials and grant no access. `initializeSession()` consumes both parameters once and reuses the destination's SDK session only when its subject matches the account hint. A different, absent or unidentifiable session starts a normal SDK authorization transaction. When replacing an account, the client clears only its local cache, preserving Auth0's SSO session. The request does not force fresh credentials. Callback processing and same-origin return-path validation remain unchanged; a callback carrying the marker cannot start another handoff. Profile, onboarding and return-to-workspace links use this contract. Auth0 can still require its own confirmation for localhost callbacks even with consent skipping enabled; see [Auth0's consent rules](https://auth0.com/docs/get-started/applications/third-party-applications/user-consent-and-third-party-applications).

Custom-domain logout creates a fresh login transaction through the SDK and uses its authorization URL as the logout destination. Auth0 clears its session and proceeds directly to hosted sign-in, without returning through the application. The SDK retains state, nonce and PKCE, and the next account starts at `/`. The Auth0 application's Allowed Logout URLs must include `https://<custom-domain>/authorize` before this client is released. Auth0's [logout URL validation](https://auth0.com/docs/authenticate/login/logout/redirect-users-after-logout) ignores the query string, so this exact path admits SDK-generated transactions without a wildcard.

`AccessRecovery` permits one uncached token refresh after a connection authentication failure. A persistent rejection or explicit `ACCOUNT_ADMISSION_DENIED` clears the auth and user stores immediately, prevents late token/user replies from restoring the session, and waits for application teardown. It clears the Auth0 SDK cache, then returns standard tenants to application sign-in or starts fresh hosted login for custom domains. The main app and user portal install this handler; a server denial never selects a redirect URL from a reply. Failed current-user loading rejects application startup.

Auth0 callback state, code and errors are handled by the SDK and removed from the URL even on denial. A successful callback may restore only a validated path in the same application origin. For custom domains, a session-storage guard permits one automatic authorization redirect; it resets only after successful current-user loading, explicit logout, or an explicit sign-in attempt. A denied or repeatedly inadmissible callback returns to the sign-in page. Storage failure also stops automatic retries. The Sign in button calls `login(true)` through the SDK, preserving state, nonce and PKCE handling.

```typescript
import { createAuthClient } from '@lixpi/auth-client'

const authClient = createAuthClient({
    auth: {
        audience,
        clientId,
        domain,
        logoutReturnTo,
        redirectUri,
    },
})

const session = await authClient.initializeSession()
await authClient.loadCurrentUser({ requestClient })

authClient.authStore.subscribe(renderIdentity)
authClient.userStore.subscribe(renderCurrentUser)
```

`features.auth` and `features.currentUser` default to `true`. Disable either operation in the auth-client configuration when a browser application does not use it. When `features.auth` is `false`, omit the `auth` configuration entirely.

Read [Using the Auth Client](documentation/USING-AUTH-CLIENT.md) for the runtime contract, stores, and feature injection.

Run its tests and quality checks through the repository Docker runners:

```bash
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-test-runner shared auth-client
docker compose --profile dev --profile main run --rm --no-deps -T lixpi-typescript-quality-runner shared auth-client validate
```
