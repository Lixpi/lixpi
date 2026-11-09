import { html } from '@lixpi/ui-primitives/dom'

import {
    type AuthStateStore,
    type LocalAuthConfig,
    type WebClientAuthService,
} from './types.ts'

const DEFAULT_STORAGE_KEY = 'localauth0_token'

// A browser can stop the hidden refresh frame without firing any event: WebKit
// cancels a plain-HTTP LocalAuth0 frame inside an HTTPS page. The refresh then
// fails after this long, so the caller can fall back to an explicit sign-in
// instead of waiting forever.
export const SILENT_REFRESH_TIMEOUT_MS = 10_000

// LocalAuth0 returns the refreshed token to the application's own callback
// URL, so the hidden frame loads the whole application. The frame carries this
// name so that copy leaves the token in its URL for the parent page to read
// instead of consuming it and starting a second workspace.
export const SILENT_REFRESH_FRAME_NAME = 'lixpi-localauth0-silent-refresh'

const isSilentRefreshFrame = (): boolean => window.name === SILENT_REFRESH_FRAME_NAME && window.parent !== window

const createState = (): string => Array.from(
    crypto.getRandomValues(
        new Uint8Array(16),
    ),
    byte => byte.toString(16).padStart(2, '0'),
).join('')

// Only a path on this origin can be restored after sign-in.
const isLocalPath = (path: string): boolean => path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\')

class LocalAuthService implements WebClientAuthService {
    constructor(
        private readonly config: LocalAuthConfig,
        private readonly store: AuthStateStore,
    ) {}

    async init(): Promise<void> {
        this.store.setMetaValues({ isLoading: true })

        // The parent page reads the token and removes this frame. Never
        // settling keeps this copy of the application from going further.
        if (isSilentRefreshFrame())
            return new Promise(() => {})

        await this.updateAuthData()
    }

    private get storageKey(): string {
        return this.config.storageKey ?? DEFAULT_STORAGE_KEY
    }

    private returnPathKey(state: string): string {
        return `${this.storageKey}.return.${state}`
    }

    // LocalAuth0 always returns to the configured callback URL. The page the
    // user signed in from is kept under the request's `state` and restored
    // once its token arrives.
    private takeReturnPath(state: string | null): string | null {
        if (!state)
            return null

        try {
            const key = this.returnPathKey(state)
            const path = sessionStorage.getItem(key)
            sessionStorage.removeItem(key)

            return path
                && isLocalPath(path)
                ? path
                : null
        } catch {
            return null
        }
    }

    private get authorizationEndpoint(): string {
        const domain = this.config.domain.includes('://')
            ? this.config.domain
            : `http://${this.config.domain}`

        return `${domain}/authorize`
    }

    private async updateAuthData(): Promise<void> {
        try {
            if (window.location.hash.includes('access_token=')) {
                const params = new URLSearchParams(
                    window.location.hash.substring(1),
                )
                const accessToken = params.get('access_token')

                if (accessToken) {
                    localStorage.setItem(this.storageKey, accessToken)
                    window.history.replaceState(
                        {},
                        document.title,
                        this.takeReturnPath(
                            params.get('state'),
                        ) ?? window.location.pathname,
                    )
                }
            }

            const token = localStorage.getItem(this.storageKey)

            if (
                token
                && !this.isTokenExpired(token)
            ) {
                this.store.setMetaValues({
                    isLoading: false,
                    isAuthenticated: true,
                    isRedirecting: false,
                })
                this.store.setDataValues({
                    user: {
                        userId: 'local|test-user-001',
                        name: 'Test User',
                        email: 'test@local.dev',
                    },
                })

                return
            }
        } catch {}

        await this.clearSession()
    }

    private setLoggedOut(): void {
        this.store.setMetaValues({
            isLoading: false,
            isAuthenticated: false,
            isRedirecting: false,
        })
        this.store.setDataValues({ user: null })
    }

    async login(): Promise<void> {
        this.store.setMetaValues({ isRedirecting: true })
        const state = createState()

        try {
            sessionStorage.setItem(
                this.returnPathKey(state),
                `${window.location.pathname}${window.location.search}`,
            )
        } catch {}

        const query = new URLSearchParams({
            client_id: this.config.clientId,
            audience: this.config.audience,
            redirect_uri: this.config.redirectUri,
            scope: 'openid profile email',
            response_type: 'token',
            bypass: 'true',
            state,
        })
        window.location.href = `${this.authorizationEndpoint}?${query.toString()}`
    }

    async logout(): Promise<void> {
        await this.clearSession()
        window.location.href = this.config.logoutReturnTo
    }

    recoverAccess = async (): Promise<void> => {
        await this.clearSession()

        throw new Error('Authentication requires an explicit sign-in')
    }

    confirmAccess = (): void => {}

    async clearSession(): Promise<void> {
        localStorage.removeItem(this.storageKey)
        this.setLoggedOut()
    }

    private isTokenExpired(token: string): boolean {
        try {
            const parts = token.split('.')

            if (parts.length !== 3)
                return true

            const payload = JSON.parse(
                atob(parts[1]),
            ) as { exp?: number }

            if (!payload.exp)
                return true

            const now = Math.floor(Date.now() / 1000)

            return payload.exp <= now + 60
        } catch {
            return true
        }
    }

    private refreshTokenViaIframe(): Promise<string> {
        return new Promise((resolve, reject) => {
            const iframe = html`<iframe style=${{ display: 'none' }}></iframe>` as HTMLIFrameElement
            iframe.name = SILENT_REFRESH_FRAME_NAME
            const callback = new URL(this.config.redirectUri)
            const timeout = setTimeout(
                () => {
                    cleanup()
                    reject(
                        new Error('Silent token refresh timed out'),
                    )
                },
                SILENT_REFRESH_TIMEOUT_MS,
            )
            const cleanup = () => {
                clearTimeout(timeout)
                iframe.remove()
            }

            // The frame first loads `about:blank` (Chrome reports that load
            // too), then LocalAuth0's page on another origin, which can't be
            // read, and finally the callback. Only the callback answers;
            // anything else waits, and the time limit ends a refresh that never
            // gets there.
            iframe.addEventListener('load', () => {
                let location: Location | undefined

                try {
                    location = iframe.contentWindow?.location

                    if (
                        !location
                        || location.origin !== callback.origin
                        || location.pathname !== callback.pathname
                    )
                        return
                } catch {
                    return
                }

                const accessToken = new URLSearchParams(
                    location.hash.substring(1),
                ).get('access_token')
                cleanup()

                if (!accessToken) {
                    reject(
                        new Error('No access_token in iframe response'),
                    )

                    return
                }

                localStorage.setItem(this.storageKey, accessToken)
                resolve(accessToken)
            })

            iframe.addEventListener('error', () => {
                cleanup()
                reject(
                    new Error('Iframe failed to load'),
                )
            })

            const query = new URLSearchParams({
                client_id: this.config.clientId,
                audience: this.config.audience,
                redirect_uri: this.config.redirectUri,
                scope: 'openid profile email',
                response_type: 'token',
                bypass: 'true',
                prompt: 'none',
            })
            document.body.appendChild(iframe)
            iframe.src = `${this.authorizationEndpoint}?${query.toString()}`
        })
    }

    async getTokenSilently(forceRefresh = false): Promise<string | false> {
        const token = localStorage.getItem(this.storageKey)

        if (!token) {
            this.setLoggedOut()

            return false
        }

        if (
            !forceRefresh
            && !this.isTokenExpired(token)
        )
            return token

        try {
            return await this.refreshTokenViaIframe()
        } catch {
            await this.clearSession()

            return false
        }
    }
}

export const createLocalAuthService = (
    config: LocalAuthConfig,
    store: AuthStateStore,
): WebClientAuthService => new LocalAuthService(config, store)
