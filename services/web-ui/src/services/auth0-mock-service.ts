'use strict'

import { authStore } from '$src/stores/authStore.ts'

const AUTH0_DOMAIN = import.meta.env.VITE_MOCK_AUTH0_DOMAIN
const AUTH0_CLIENT_ID = 'mock-client-id'
const AUTH0_AUDIENCE = import.meta.env.VITE_AUTH0_AUDIENCE
const AUTH0_REDIRECT_URI = import.meta.env.VITE_AUTH0_REDIRECT_URI
const AUTH0_LOGIN_URL = import.meta.env.VITE_AUTH0_LOGIN_URL

class Auth0MockService {
    private static instance: Auth0MockService

    constructor() {
        if (Auth0MockService.instance) {
            return Auth0MockService.instance
        }
        Auth0MockService.instance = this
    }

    static getInstance(): Auth0MockService {
        if (!Auth0MockService.instance) {
            Auth0MockService.instance = new Auth0MockService()
        }
        return Auth0MockService.instance
    }

    public async init(): Promise<void> {
        console.log('Initializing LocalAuth0 mock client')
        await this.updateAuthData()
    }

    private async updateAuthData(): Promise<void> {
        try {
            // Handle LocalAuth0 redirect callback
            if (window.location.hash.includes('access_token=')) {
                const hash = window.location.hash.substring(1)
                const params = new URLSearchParams(hash)
                const accessToken = params.get('access_token')

                if (accessToken) {
                    localStorage.setItem('localauth0_token', accessToken)
                    window.history.replaceState({}, document.title, window.location.pathname)
                }
            }

            // Check if we have a non-expired token
            const token = localStorage.getItem('localauth0_token')

            if (token && !this.isTokenExpired(token)) {
                // Mock user object matching Auth0 format
                const user = {
                    userId: 'local|test-user-001',
                    name: 'Test User',
                    email: 'test@local.dev'
                }
                authStore.setMetaValues({ isLoading: false, isAuthenticated: true })
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
        // Redirect to LocalAuth0 authorize endpoint with bypass=true for auto-login
        const authUrl = `http://${AUTH0_DOMAIN}/authorize?` + new URLSearchParams({
            client_id: AUTH0_CLIENT_ID,
            audience: AUTH0_AUDIENCE,
            redirect_uri: AUTH0_REDIRECT_URI,
            scope: 'openid profile email',
            response_type: 'token',
            bypass: 'true'
        }).toString()
        window.location.href = authUrl
    }

    public logout(): void {
        localStorage.removeItem('localauth0_token')
        authStore.setMetaValues({ isLoading: false, isAuthenticated: false })
        authStore.setDataValues({ user: null })
        window.location.href = AUTH0_LOGIN_URL
    }

    private isTokenExpired(token: string): boolean {
        try {
            // Decode JWT without verification (we just need to check expiry)
            const parts = token.split('.')
            if (parts.length !== 3) return true

            const payload = JSON.parse(atob(parts[1]))
            const exp = payload.exp

            if (!exp) return true

            // Check if token expires in the next 60 seconds
            const now = Math.floor(Date.now() / 1000)
            return exp <= (now + 60)
        } catch {
            return true
        }
    }

    // Silent token refresh via hidden iframe. LocalAuth0's /authorize?bypass=true
    // auto-approves and redirects back with #access_token=... which we read out.
    // The iframe fires `load` once for the WASM SPA page, then again when it
    // redirects to our callback. We resolve/reject based on load events alone.
    private refreshTokenViaIframe(): Promise<string> {
        return new Promise((resolve, reject) => {
            const iframe = document.createElement('iframe')
            iframe.style.display = 'none'

            const callbackPath = new URL(AUTH0_REDIRECT_URI).pathname
            let loadCount = 0

            const cleanup = () => iframe.remove()

            iframe.addEventListener('load', () => {
                loadCount++

                try {
                    const iframeUrl = iframe.contentWindow?.location.href ?? ''

                    if (!iframeUrl.includes(callbackPath)) {
                        if (loadCount > 1) {
                            cleanup()
                            reject(new Error('Iframe navigated without reaching callback'))
                        }
                        return
                    }

                    const hash = iframe.contentWindow?.location.hash?.substring(1)
                    if (!hash) {
                        cleanup()
                        reject(new Error('No hash fragment in iframe redirect'))
                        return
                    }

                    const params = new URLSearchParams(hash)
                    const accessToken = params.get('access_token')
                    cleanup()

                    if (accessToken) {
                        localStorage.setItem('localauth0_token', accessToken)
                        resolve(accessToken)
                    } else {
                        reject(new Error('No access_token in iframe response'))
                    }
                } catch {
                    // Cross-origin read error — expected on the initial WASM page load
                    // before LocalAuth0 redirects back to our origin.
                    if (loadCount > 1) {
                        cleanup()
                        reject(new Error('Cannot read iframe after multiple loads'))
                    }
                }
            })

            iframe.addEventListener('error', () => {
                cleanup()
                reject(new Error('Iframe failed to load'))
            })

            const authUrl = `http://${AUTH0_DOMAIN}/authorize?` + new URLSearchParams({
                client_id: AUTH0_CLIENT_ID,
                audience: AUTH0_AUDIENCE,
                redirect_uri: AUTH0_REDIRECT_URI,
                scope: 'openid profile email',
                response_type: 'token',
                bypass: 'true',
                prompt: 'none',
            }).toString()

            document.body.appendChild(iframe)
            iframe.src = authUrl
        })
    }

    public async getTokenSilently(): Promise<string | false> {
        const token = localStorage.getItem('localauth0_token')
        if (token && !this.isTokenExpired(token)) {
            return token
        }

        // Try silent refresh via hidden iframe first (no page reload)
        try {
            return await this.refreshTokenViaIframe()
        } catch {
            // Iframe approach failed — fall back to full-page redirect
            console.warn('Silent token refresh failed, redirecting to LocalAuth0...')
            await this.login()
            return false
        }
    }
}

export default Auth0MockService.getInstance()
