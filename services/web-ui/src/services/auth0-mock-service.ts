'use strict'

import { authStore } from '../stores/authStore.ts'

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

            // Check if we have a token
            const token = localStorage.getItem('localauth0_token')

            if (token) {
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

    private async refreshMockToken(): Promise<string> {
        // Get a fresh token from LocalAuth0
        const authUrl = `http://${AUTH0_DOMAIN}/authorize?` + new URLSearchParams({
            client_id: AUTH0_CLIENT_ID,
            audience: AUTH0_AUDIENCE,
            redirect_uri: AUTH0_REDIRECT_URI,
            scope: 'openid profile email',
            response_type: 'token',
            bypass: 'true'
        }).toString()

        // Fetch the token directly without redirect
        const response = await fetch(authUrl, { redirect: 'manual' })
        const redirectUrl = response.headers.get('Location')

        if (redirectUrl) {
            const hash = redirectUrl.split('#')[1]
            if (hash) {
                const params = new URLSearchParams(hash)
                const accessToken = params.get('access_token')
                if (accessToken) {
                    localStorage.setItem('localauth0_token', accessToken)
                    return accessToken
                }
            }
        }

        throw new Error('Failed to refresh mock token')
    }

    public async getTokenSilently(): Promise<string | false> {
        try {
            let token = localStorage.getItem('localauth0_token')

            // Check if token is expired or missing
            if (!token || this.isTokenExpired(token)) {
                console.log('Mock token expired or missing, refreshing...')
                try {
                    token = await this.refreshMockToken()
                } catch (error) {
                    console.error('Failed to refresh mock token:', error)
                    await this.login()
                    return false
                }
            }

            return token
        } catch (error) {
            await this.login()
            return false
        }
    }
}

export default Auth0MockService.getInstance()
