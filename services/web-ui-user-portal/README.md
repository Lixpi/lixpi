# Web UI User Portal

The [version registry](../../versions-registry/README.md) supplies Node.js, pnpm, and package versions. Edit the central values and synchronize the native declarations before rebuilding this image.

`web-ui-user-portal` is the account-management SPA served from `user-portal.<domain>`. It uses authentication and user state from `@lixpi/auth-client`, the shared browser runtime and routing from `@lixpi/web-client-service-factory`, and renders its UI with `@lixpi/ui-kit-gentelella`.

The entry point calls `createUserPortal({ modules: [accountPortalModule], ... })` from `@lixpi/user-portal`. The account module contributes the authenticated `/` profile view and its Account navigation group.

## Module contract

`UserPortalModule` declares a stable ID, module API version, routes, navigation groups, and optional initialize/destroy hooks. The host rejects duplicate IDs and normalized route paths before starting routing. Navigation must target a route declared by the same module.

The module context provides the current-user store, authenticated token provider, router, and the shared NATS request, subscribe, and removable reconnect-listener methods. Modules initialize in composition order. Teardown first destroys the route view and router, then destroys modules in reverse order, and finally disconnects NATS. A failed initializer participates in teardown, and cleanup continues if another module's destroy hook throws.

The account view and its styles live in `packages/lixpi/user-portal`. The public service composes only the account module. Additional build-time compositions supply their own explicit module arrays. Modules own and clean up subscriptions or resources created by their hooks and route views.

## Local development

Run the service through Docker Compose. It is available at `http://localhost:3002` and uses the same local or hosted identity provider configuration as `web-ui`, with its own redirect URI. `VITE_USER_PORTAL_URL` is required in the environment file. `web-ui` reads it and opens this service in a new tab when the user clicks the sidebar avatar.

The identity-provider application must allow the portal origin as a callback URL, logout URL, and web origin. Sharing the Auth0 tenant and application gives the two SPAs single sign-on, while each origin maintains its own browser token cache.

Both SPAs configure their NATS reply inbox from the session user ID. Browser module requests use `portal.module.*.<user-token>.request.>` and events use the corresponding `.event.>` namespace. The API does not register module-specific responders. A module owns its concrete operations and must authorize every request.

For a deployment with an external artifact publisher, set `USER_PORTAL_ARTIFACT_MANAGEMENT=external` in the infrastructure environment. Pulumi owns the bucket, distribution, and DNS; the external pipeline owns builds, uploads, and invalidation. The default `infrastructure` value builds and publishes this account-only composition.

## Tests and quality checks

Use the repository TypeScript test and quality runner containers. The `web-ui-user-portal` domain covers the application composition. The `shared user-portal` package covers the module catalog, layout, and account view beside their implementations.
