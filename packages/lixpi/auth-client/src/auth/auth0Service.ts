import { Auth0Client } from '@auth0/auth0-spa-js'

import {
    type AuthStateStore,
    type WebClientAuthConfig,
    type WebClientAuthService,
} from './types.ts'

class Auth0Service implements WebClientAuthService {
    private auth0: Auth0Client | null = null

    constructor(
        private readonly config: WebClientAuthConfig,
        private readonly store: AuthStateStore,
    ) {}

    async init(): Promise<void> {
        this.store.setMetaValues({ isLoading: true })

        try {
            this.auth0 = new Auth0Client({
                domain: this.config.domain,
                clientId: this.config.clientId,
                useRefreshTokens: true,
                useRefreshTokensFallback: true,
                cacheLocation: 'localstorage',
                authorizationParams: {
                    redirect_uri: this.config.redirectUri,
                    audience: this.config.audience,
                    scope: 'openid profile email',
                },
            })
            await this.updateAuthData()
        } catch (error) {
            this.setLoggedOut()

            throw error
        }
    }

    private getClient(): Auth0Client {
        if (!this.auth0)
            throw new Error('Auth0 client has not been initialized')

        return this.auth0
    }

    private get usesHostedLogin(): boolean {
        const domain = new URL(this.config.domain.includes('://') ? this.config.domain : `https://${this.config.domain}`).hostname

        // The standard tenant uses the application's login page. Custom
        // domains use their hosted login directly, without a second prompt.
        return domain !== 'auth0.com' && !domain.endsWith('.auth0.com')
    }

    private async updateAuthData(): Promise<void> {
        const client = this.getClient()
        const searchParams = new URLSearchParams(window.location.search)

        if (
            searchParams.has('code')
            || searchParams.has('error')
        ) {
            let returnTo: unknown

            try {
                if (
                    searchParams.getAll('state').length !== 1
                    || searchParams.getAll('code').length + searchParams.getAll('error').length !== 1
                )
                    throw new Error('Sign-in callback is incomplete')

                const result = await client.handleRedirectCallback()
                returnTo = result?.appState?.returnTo
            } finally {
                // Even denied callbacks must lose their single-use code/state.
                window.history.replaceState(
                    {},
                    document.title,
                    window.location.pathname,
                )
            }

            const destination = this.localReturnPath(returnTo)

            if (destination)
                window.history.replaceState(
                    {},
                    document.title,
                    destination,
                )
        }

        const isAuthenticated = await client.isAuthenticated()

        if (!isAuthenticated) {
            this.setLoggedOut()

            return
        }

        const user = await client.getUser()
        this.store.setMetaValues({
            isLoading: false,
            isAuthenticated: true,
            isRedirecting: false,
        })
        this.store.setDataValues({ user: user ?? null })
    }

    private setLoggedOut(): void {
        this.store.setMetaValues({
            isLoading: false,
            isAuthenticated: false,
            isRedirecting: false,
        })
        this.store.setDataValues({ user: null })
    }

    async login(
        forceFresh = false,
        screenHint?: 'signup',
    ): Promise<void> {
        // A button press explicitly starts another attempt. Automatic recovery
        // uses the separate method below and cannot reset this guard.
        this.markRedirect()
        await this.redirect(forceFresh, screenHint)
    }

    private async redirect(
        forceFresh: boolean,
        screenHint?: 'signup',
        logoutFirst = false,
    ): Promise<void> {
        const hasCallback = new URLSearchParams(window.location.search).has('state')
        const returnTo = hasCallback ? window.location.pathname : `${window.location.pathname}${window.location.search}${window.location.hash}`
        this.store.setMetaValues({ isRedirecting: true })

        try {
            await this.getClient().loginWithRedirect({
                appState: { returnTo: logoutFirst ? '/' : this.localReturnPath(returnTo) ?? '/' },
                // Let the SDK save state, nonce and PKCE before leaving. Auth0
                // ends its session, then opens this transaction directly,
                // without loading the application between logout and login.
                ...(logoutFirst ? {
                    openUrl: (url: string) => this.getClient().logout({
                        logoutParams: { returnTo: url },
                    }),
                } : {}),
                authorizationParams: {
                    redirect_uri: this.config.redirectUri,
                    ...(screenHint ? { screen_hint: screenHint } : {}),
                    ...(forceFresh ? {
                        prompt: 'login',
                        max_age: 0,
                    } : {}),
                },
            })
        } catch (error) {
            this.store.setMetaValues({ isRedirecting: false })

            throw error
        }
    }

    private get redirectKey(): string {
        return `lixpi.auth.redirect:${this.config.domain}:${this.config.clientId}`
    }

    private markRedirect(): void {
        try {
            sessionStorage.setItem(this.redirectKey, 'pending')
        } catch {
            // Explicit login still works when browser storage is unavailable.
            // Automatic recovery fails closed when it cannot read the guard.
        }
    }

    private async automaticLogin(forceFresh: boolean): Promise<void> {
        if (!this.usesHostedLogin)
            throw new Error('Authentication requires an explicit sign-in')

        let attempted = true

        try {
            attempted = sessionStorage.getItem(this.redirectKey) === 'pending'

            if (!attempted)
                sessionStorage.setItem(this.redirectKey, 'pending')
        } catch {
            attempted = true
        }

        if (attempted)
            throw new Error('Sign-in could not be completed. Choose Sign in again to retry.')

        await this.redirect(forceFresh)
    }

    recoverAccess = (): Promise<void> => this.automaticLogin(true)

    confirmAccess = (): void => {
        try {
            sessionStorage.removeItem(this.redirectKey)
        } catch {}
    }

    private localReturnPath(value: unknown): string | undefined {
        if (
            typeof value !== 'string'
            || value.length > 2048
            || !value.startsWith('/')
            || value.startsWith('//')
            || /[\\\u0000-\u001f\u007f]/.test(value)
        )
            return undefined

        const destination = new URL(value, window.location.origin)

        if (
            destination.searchParams.has('code')
            || destination.searchParams.has('error')
        )
            return undefined

        return destination.origin === window.location.origin ? `${destination.pathname}${destination.search}${destination.hash}` : undefined
    }

    async logout(): Promise<void> {
        this.confirmAccess()

        if (this.usesHostedLogin) {
            this.setLoggedOut()
            this.markRedirect()
            await this.redirect(
                true,
                undefined,
                true,
            )

            return
        }

        await this.getClient().logout({
            logoutParams: {
                returnTo: this.config.logoutReturnTo,
            },
        })
        this.setLoggedOut()
    }

    async clearSession(): Promise<void> {
        this.setLoggedOut()
        await this.getClient().logout({ openUrl: false })
    }

    async getTokenSilently(forceRefresh = false): Promise<string | false> {
        try {
            if (
                !this.usesHostedLogin
                && !this.store.getMeta('isAuthenticated')
            ) {
                // The SDK checks its remembered-session cookie before making
                // a request. Logout removes that cookie, so this cannot start
                // authentication again after a deliberate sign-out.
                await this.getClient().checkSession()
                await this.updateAuthData()

                if (!this.store.getMeta('isAuthenticated'))
                    return false
            }

            const token = await this.getClient().getTokenSilently(forceRefresh ? { cacheMode: 'off' } : undefined)

            if (token)
                await this.updateAuthData()

            return token ?? false
        } catch {
            this.setLoggedOut()

            if (
                !forceRefresh
                && this.usesHostedLogin
            )
                await this.automaticLogin(false)

            return false
        }
    }
}

export const createAuth0Service = (
    config: WebClientAuthConfig,
    store: AuthStateStore,
): WebClientAuthService => new Auth0Service(config, store)
