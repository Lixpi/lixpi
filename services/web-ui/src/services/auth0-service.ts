'use strict'

import { Auth0Client, createAuth0Client } from '@auth0/auth0-spa-js'
import { authStore } from '$src/stores/authStore.ts'

const AUTH0_DOMAIN = import.meta.env.VITE_AUTH0_DOMAIN
const AUTH0_CLIENT_ID = import.meta.env.VITE_AUTH0_CLIENT_ID
const AUTH0_AUDIENCE = import.meta.env.VITE_AUTH0_AUDIENCE
const AUTH0_REDIRECT_URI = import.meta.env.VITE_AUTH0_REDIRECT_URI
const AUTH0_LOGIN_URL = import.meta.env.VITE_AUTH0_LOGIN_URL

class Auth0Service {
    private static instance: Auth0Service
    private auth0: Auth0Client | null = null

    constructor() {
        if (Auth0Service.instance) {
            return Auth0Service.instance
        }
        Auth0Service.instance = this
    }

    static getInstance(): Auth0Service {
        if (!Auth0Service.instance) {
            Auth0Service.instance = new Auth0Service()
        }
        return Auth0Service.instance
    }

    public async init(): Promise<void> {
        try {
            this.auth0 = await createAuth0Client({
                domain: AUTH0_DOMAIN,
                clientId: AUTH0_CLIENT_ID,
                useRefreshTokens: true,
                cacheLocation: 'localstorage',
                authorizationParams: {
                    redirect_uri: AUTH0_REDIRECT_URI,
                    audience: AUTH0_AUDIENCE,
                    scope: 'openid profile email',
                },
            })
            console.log('Auth0 client initialized successfully', this.auth0)

            // Tauri delivers the OAuth callback URL via a deep-link event instead of a navigation,
            // so window.location.search will not contain the auth code. Subscribe to the deep-link
            // plugin when running inside Tauri (no-op in the browser build).
            if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
                const { onOpenUrl, getCurrent } = await import('@tauri-apps/plugin-deep-link')
                const initial = await getCurrent()
                if (initial?.length) {
                    await this.handleCallbackUrl(initial[0])
                }
                await onOpenUrl(async (urls) => {
                    if (urls[0]) await this.handleCallbackUrl(urls[0])
                })
            }
        } catch (error) {
            console.error('Error initializing Auth0 client:', error)
        } finally {
            await this.updateAuthData()
        }
    }

    private async handleCallbackUrl(url: string): Promise<void> {
        if (url.includes('code=') && url.includes('state=')) {
            await this.auth0!.handleRedirectCallback(url)
            await this.updateAuthData()
        }
    }

    private async updateAuthData(): Promise<void> {
        try {
            if (window.location.search.includes('code=') && window.location.search.includes('state=')) {
                await this.auth0.handleRedirectCallback()
                window.history.replaceState({}, document.title, window.location.pathname)
            }

            const isAuthenticated = await this.auth0.isAuthenticated()

            if (isAuthenticated) {
                const user = await this.auth0.getUser()
                authStore.setMetaValues({ isLoading: false, isAuthenticated })
                authStore.setDataValues({ user })
            } else {
                authStore.setMetaValues({ isLoading: false, isAuthenticated: false })
                authStore.setDataValues({ user: null })
            }
        } catch (error) {
            authStore.setMetaValues({ isLoading: false, isAuthenticated: false })
            authStore.setDataValues({ user: null })
        }
    }

    public async login(): Promise<void> {
        await this.auth0.loginWithRedirect({ redirect_uri: AUTH0_REDIRECT_URI })
    }

    public logout(): void {
        this.auth0.logout({ returnTo: AUTH0_LOGIN_URL })
        authStore.setMetaValues({ isLoading: false, isAuthenticated: false })
        authStore.setDataValues({ user: null })
    }

    public async getTokenSilently(): Promise<string | false> {
        try {
            return await this.auth0.getTokenSilently() ?? false
        } catch (error) {
            await this.login()
            return false
        }
    }
}

export default Auth0Service.getInstance()
