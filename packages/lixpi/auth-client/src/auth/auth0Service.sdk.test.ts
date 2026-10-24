import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { webcrypto } from 'node:crypto'
import { createAuthStore } from '../stores/authStore.ts'
import { createAuth0Service } from './auth0Service.ts'
import { createAuthClient } from '../authClient.ts'

const config = {
    audience: 'https://api.lixpi.test',
    clientId: 'logout-test-client',
    domain: 'auth.lixpi.test',
    logoutReturnTo: window.location.origin,
    redirectUri: window.location.origin,
}

beforeEach(() => {
    window.history.replaceState({}, '', '/')
    localStorage.clear()
    sessionStorage.clear()
    vi.spyOn(window.location, 'assign').mockImplementation(() => {})
    vi.spyOn(window, 'fetch').mockRejectedValue(new Error('Unexpected network request'))
})

afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
})

describe('Auth0 SDK logout integration', () => {
    it('creates a PKCE continuation from an empty origin without requiring an SDK session cookie', async () => {
        window.history.replaceState({}, '', '/settings?auth=continue&organization=one')
        const client = createAuthClient({ auth: {
            ...config,
            domain: 'tenant.us.auth0.com',
        } })
        await expect(client.initializeSession()).resolves.toBeNull()
        expect(client.authStore.getMeta('isRedirecting')).toBe(true)
        const authorize = new URL(vi.mocked(window.location.assign).mock.calls[0][0])
        expect(authorize.pathname).toBe('/authorize')
        expect(authorize.searchParams.has('prompt')).toBe(false)
        expect(authorize.searchParams.has('max_age')).toBe(false)
        expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
        const transaction = JSON.parse(sessionStorage.getItem(`a0.spajs.txs.${config.clientId}`)!)
        expect(transaction.state).toBe(authorize.searchParams.get('state'))
        expect(transaction.appState.returnTo).toBe('/settings?organization=one')
        expect(window.fetch).not.toHaveBeenCalled()
    })
    it('retains SDK state, nonce and PKCE through logout with a single browser navigation', async () => {
        const service = createAuth0Service(config, createAuthStore())
        await service.init()
        await service.logout()

        expect(window.location.assign).toHaveBeenCalledOnce()
        const logout = new URL(vi.mocked(window.location.assign).mock.calls[0][0])
        expect(logout.origin).toBe('https://auth.lixpi.test')
        expect(logout.pathname).toBe('/v2/logout')
        const authorize = new URL(logout.searchParams.get('returnTo')!)
        expect(authorize.origin).toBe(logout.origin)
        expect(authorize.pathname).toBe('/authorize')
        expect(authorize.searchParams.get('prompt')).toBe('login')
        expect(authorize.searchParams.get('max_age')).toBe('0')
        expect(authorize.searchParams.get('redirect_uri')).toBe(config.redirectUri)

        // Verify the transaction survived the real SDK's logout cache cleanup.
        const transaction = JSON.parse(sessionStorage.getItem(`a0.spajs.txs.${config.clientId}`)!)
        expect(transaction.state).toBe(authorize.searchParams.get('state'))
        expect(transaction.nonce).toBe(authorize.searchParams.get('nonce'))
        expect(transaction.appState).toEqual({ returnTo: '/' })
        expect(transaction.code_verifier).toBeTruthy()
        const challenge = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(transaction.code_verifier))).toString('base64url')
        expect(authorize.searchParams.get('code_challenge')).toBe(challenge)
        expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
        expect(window.fetch).not.toHaveBeenCalled()
    })

    it('clears the remembered tenant session and waits for a button press across reloads', async () => {
        const tenantConfig = {
            ...config,
            domain: 'tenant.us.auth0.com',
        }
        document.cookie = `auth0.${config.clientId}.is.authenticated=true; path=/`
        const service = createAuth0Service(tenantConfig, createAuthStore())
        await service.init()
        await service.logout()
        expect(document.cookie).not.toContain(`auth0.${config.clientId}.is.authenticated`)

        for (let reload = 0; reload < 2; reload++) {
            const signedOut = createAuth0Service(tenantConfig, createAuthStore())
            await signedOut.init()
            await expect(signedOut.getTokenSilently()).resolves.toBe(false)
        }

        expect(window.location.assign).toHaveBeenCalledOnce()
        const logout = new URL(vi.mocked(window.location.assign).mock.calls[0][0])
        expect(logout.searchParams.get('returnTo')).toBe(config.logoutReturnTo)
        expect(window.fetch).not.toHaveBeenCalled()
        await service.login(true)
        expect(window.location.assign).toHaveBeenCalledTimes(2)
        const authorize = new URL(vi.mocked(window.location.assign).mock.calls[1][0])
        expect(authorize.pathname).toBe('/authorize')
        expect(authorize.searchParams.get('prompt')).toBe('login')
    })
})
