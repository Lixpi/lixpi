---
title: Using the Auth Client
description: How browser applications configure identity-provider authentication and load the current Lixpi user.
---

# Using the Auth Client

`@lixpi/auth-client` creates composed clients with authentication and current-user operations. The caller supplies environment-specific Auth0 or LocalAuth0 configuration. `features.auth` and `features.currentUser` both default to `true` and can be disabled independently. When authentication is disabled, the caller omits the `auth` configuration and no authentication adapter is created.

## Authentication

`createAuthClient()` selects Auth0 or LocalAuth0 from the `auth.mock.enabled` flag. The resulting client exposes `init()`, `login()`, `logout()`, and `getTokenSilently()`. Auth0 uses its local-storage cache and enables silent iframe fallback when a refresh token is unavailable. LocalAuth0 stores the token under its configured storage key.

The configured Auth0 hostname selects the sign-in entry point. Standard tenant domains (`auth0.com` and its subdomains) leave signed-out users on the application's login page until an explicit `login()` call. Before returning signed-out state, the client uses the SDK's cookie-aware `checkSession()` to restore a remembered session; after logout, the SDK removes that cookie and skips the network check. Custom domains try silent authorization even on a newly opened origin, then use one guarded hosted-login redirect if needed. Consumers should retain a neutral loading view while `authStore.getMeta('isRedirecting')` is true. A successful callback resumes the requested local destination in either mode.

On a custom domain, `logout()` prepares a fresh SDK authorization transaction and uses it as the Auth0 logout destination. The browser stays with Auth0 until sign-in completes, then returns to the application's root. Deploy billing's signup policy first so the exact custom-domain `/authorize` URL is an allowed logout destination.

The main UI and user portal create separate clients because their redirect origins differ. Both can use the same Auth0 application and Universal Login session. `initializeSession()` returns the access token, its decoded subject as `userId`, and token-read and token-refresh functions. The decoded subject selects the client's routing namespace and does not authorize access. Both browser composition roots pass `getNatsUserInboxPrefix(session.userId)` to NATS; the auth callout independently verifies the token before granting that reply namespace.

## Current-user loading

`loadCurrentUser()` accepts a request client. It gets the token from the same auth client instance, sends the existing `users.get` request, then updates that client's user store with loading, success, or error state.

The service composition root calls `loadCurrentUser()` after its request dependency is connected and the application is mounted. A client that disables authentication must also disable current-user loading. The web-client factory does not inspect or invoke auth-client APIs.

## Store ownership

Every client owns isolated auth and user stores, exposed as `client.authStore` and `client.userStore`. `createAuthStore()` and `createUserStore()` remain public for tests or callers that need to inject preconfigured stores. The package does not export process-wide store instances. Generic writable, base, and router stores remain in `@lixpi/web-client-service-factory`.
