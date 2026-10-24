import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import { createAuthStore } from '../stores/authStore.ts'
import { createAuthClient } from '../authClient.ts'
import { AuthenticationFailure } from '../authenticationFailure.ts'
import { createLocalAuthService } from './localAuthService.ts'

vi.mock('@lixpi/ui-primitives/gradients', () => ({
    createShiftingGradientBackground: () => ({ destroy: vi.fn() }),
}))

const config = {
    audience: 'https://api.lixpi.test',
    clientId: 'mock-client-id',
    domain: 'localhost:3000',
    logoutReturnTo: 'http://localhost:3002',
    redirectUri: 'http://localhost:3002',
}

const makeToken = (expiresInSeconds: number): string => {
    const now = Math.floor(Date.now() / 1000)
    const encode = (value: object) => btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
    const payload = {
        sub: 'local|test-user-001',
        exp: now + expiresInSeconds,
    }

    return `${encode({ alg: 'none' })}.${encode(payload)}.signature`
}

beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
})
afterEach(() => {
    localStorage.clear()
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

describe('LocalAuth0 web client service', () => {
    it.each([false, true])('does not obtain a new token without a cached session (forced refresh: %s)', async forceRefresh => {
        const store = createAuthStore()
        const service = createLocalAuthService(config, store)
        const refresh = vi.spyOn(service as any, 'refreshTokenViaIframe').mockResolvedValue(makeToken(3600))

        await service.init()

        await expect(service.getTokenSilently(forceRefresh)).resolves.toBe(false)
        expect(refresh).not.toHaveBeenCalled()
        expect(store.getMeta()).toEqual({
            isLoading: false,
            isAuthenticated: false,
            isRedirecting: false,
        })
    })

    it('discards an expired session on startup and waits for Sign in', async () => {
        const service = createLocalAuthService(config, createAuthStore())
        const refresh = vi.spyOn(service as any, 'refreshTokenViaIframe').mockResolvedValue(makeToken(3600))
        localStorage.setItem('localauth0_token', makeToken(-1))

        await service.init()

        expect(localStorage.getItem('localauth0_token')).toBeNull()
        await expect(service.getTokenSilently()).resolves.toBe(false)
        expect(refresh).not.toHaveBeenCalled()
    })

    it('uses a valid token from the application origin', async () => {
        const service = createLocalAuthService(config, createAuthStore())
        const token = makeToken(3600)
        localStorage.setItem('localauth0_token', token)

        await expect(service.getTokenSilently()).resolves.toBe(token)
    })

    it('refreshes a valid token when the caller requests a forced refresh', async () => {
        const service = createLocalAuthService(config, createAuthStore())
        localStorage.setItem('localauth0_token', makeToken(3600))
        const refresh = vi.spyOn(service as any, 'refreshTokenViaIframe').mockResolvedValue('fresh-token')

        await expect(service.getTokenSilently(true)).resolves.toBe('fresh-token')
        expect(refresh).toHaveBeenCalledTimes(1)
    })

    it('clears a rejected refresh without starting another login', async () => {
        const store = createAuthStore()
        const service = createLocalAuthService(config, store)
        const navigate = vi.spyOn(window.location, 'href', 'set').mockImplementation(() => {})
        localStorage.setItem('localauth0_token', makeToken(3600))
        await service.init()
        vi.spyOn(service as any, 'refreshTokenViaIframe').mockRejectedValue(new Error('refresh rejected'))

        await expect(service.getTokenSilently(true)).resolves.toBe(false)
        expect(localStorage.getItem('localauth0_token')).toBeNull()
        expect(store.getMeta()).toEqual({
            isLoading: false,
            isAuthenticated: false,
            isRedirecting: false,
        })
        expect(navigate).not.toHaveBeenCalled()
    })

    it('returns rejected access to the signed-out state without automatically authorizing', async () => {
        const store = createAuthStore()
        const service = createLocalAuthService(config, store)
        const navigate = vi.spyOn(window.location, 'href', 'set').mockImplementation(() => {})
        localStorage.setItem('localauth0_token', makeToken(3600))
        await service.init()

        await expect(service.recoverAccess()).rejects.toThrow('Authentication requires an explicit sign-in')

        expect(localStorage.getItem('localauth0_token')).toBeNull()
        expect(store.getMeta('isAuthenticated')).toBe(false)
        expect(store.getMeta('isRedirecting')).toBe(false)
        expect(navigate).not.toHaveBeenCalled()
    })

    it.each(['/login', '/'])('keeps the shared Lixpi screen after logout to %s and authorizes locally only on Sign in', async logoutPath => {
        const navigate = vi.spyOn(window.location, 'href', 'set').mockImplementation(() => {})
        const auth = {
            ...config,
            domain: 'tenant.us.auth0.com',
            redirectUri: window.location.origin,
            logoutReturnTo: new URL(logoutPath, window.location.origin).href,
            mock: {
                enabled: true,
                domain: config.domain,
            },
        }
        localStorage.setItem('localauth0_token', makeToken(3600))
        const client = createAuthClient({ auth })
        await expect(client.initializeSession()).resolves.toMatchObject({ userId: 'local|test-user-001' })

        await client.logout()
        expect(navigate).toHaveBeenCalledExactlyOnceWith(auth.logoutReturnTo)
        expect(localStorage.getItem('localauth0_token')).toBeNull()
        window.history.replaceState({}, '', logoutPath)
        navigate.mockClear()

        for (let reload = 0; reload < 2; reload++) {
            const signedOut = createAuthClient({ auth })
            await expect(signedOut.initializeSession()).resolves.toBeNull()
            expect(signedOut.authStore.getMeta('isRedirecting')).toBe(false)
            expect(document.querySelector('iframe')).toBeNull()
            expect(navigate).not.toHaveBeenCalled()
            const screen = new AuthenticationFailure(() => signedOut.login(true))

            try {
                screen.show(document.body)
                expect(document.querySelector('h1')?.textContent).toBe('Welcome to Lixpi')
                const buttons = document.querySelectorAll('button')
                expect(Array.from(buttons, button => button.textContent)).toEqual(['Sign in'])
                expect(document.querySelector('[role="status"]')).toBeNull()

                if (reload === 1) {
                    buttons[0].click()
                    await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce())
                    const authorization = new URL(navigate.mock.calls[0][0])
                    expect(authorization.origin).toBe('http://localhost:3000')
                    expect(authorization.pathname).toBe('/authorize')
                    expect(authorization.searchParams.get('redirect_uri')).toBe(auth.redirectUri)
                    expect(authorization.searchParams.get('audience')).toBe(auth.audience)
                    expect(authorization.searchParams.get('bypass')).toBe('true')
                }
            } finally {
                screen.destroy()
            }
        }
    })
})
