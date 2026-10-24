import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { LoadingStatus } from '@lixpi/constants'

import { createAuthClient } from './authClient.ts'
import { createAuthStore } from './stores/authStore.ts'
import { createUserStore } from './stores/userStore.ts'
import { createSessionAccountHint } from './sessionHandoff.ts'

const mocks = vi.hoisted(() => ({
    getTokenSilently: vi.fn(),
    getUser: vi.fn(),
    init: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    clearSession: vi.fn(),
    recoverAccess: vi.fn(),
    confirmAccess: vi.fn(),
}))

vi.mock('./auth/createAuthService.ts', () => ({
    createAuthService: () => mocks,
}))

const tokenForUser = (userId: string): string => [
    'header',
    Buffer.from(JSON.stringify({ sub: userId })).toString('base64url'),
    'signature',
].join('.')

beforeEach(() => window.history.replaceState({}, '', '/'))
afterEach(() => vi.restoreAllMocks())

describe('authentication origin', () => {
    it.each([
        ['http://localhost:3001', 'https://localhost:3443'],
        ['http://localhost:3002', 'https://localhost:3444'],
    ])('moves %s to %s before consuming handoff or initializing authentication', async (origin, destination) => {
        vi.resetAllMocks()
        const path = '/settings?organization=one&auth=continue&auth_account=hint#history'
        vi.spyOn(window.location, 'origin', 'get').mockReturnValue(origin)
        vi.spyOn(window.location, 'href', 'get').mockReturnValue(`${origin}${path}`)
        const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
        const client = createAuthClient({ auth: {
            audience: 'audience',
            clientId: 'client',
            domain: 'tenant.auth0.com',
            logoutReturnTo: destination,
            redirectUri: destination,
        } })

        await expect(client.initializeSession()).resolves.toBeNull()
        await client.init()
        await client.login(true)
        await expect(client.getTokenSilently()).resolves.toBe(false)
        expect(replace).toHaveBeenCalledExactlyOnceWith(`${destination}${path}`)
        expect(mocks.init).not.toHaveBeenCalled()
        expect(mocks.login).not.toHaveBeenCalled()
        expect(mocks.getTokenSilently).not.toHaveBeenCalled()
        expect(client.authStore.getMeta('isRedirecting')).toBe(true)
        expect(client.authStore.getMeta('isLoading')).toBe(true)
    })

    it.each([
        '?code=private-code&state=private-state',
        '?error=access_denied&error_description=private-details&state=private-state',
    ])('does not forward a callback from another origin: %s', async search => {
        vi.resetAllMocks()
        vi.spyOn(window.location, 'href', 'get').mockReturnValue(`http://localhost:3001/${search}#private-fragment`)
        const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
        const client = createAuthClient({ auth: {
            audience: 'audience',
            clientId: 'client',
            domain: 'tenant.auth0.com',
            logoutReturnTo: 'https://localhost:3443',
            redirectUri: 'https://localhost:3443',
        } })

        await expect(client.initializeSession()).resolves.toBeNull()
        expect(replace).toHaveBeenCalledExactlyOnceWith('https://localhost:3443/')
        expect(mocks.init).not.toHaveBeenCalled()
    })

    it('leaves callbacks on their configured origin for SDK verification', async () => {
        vi.resetAllMocks()
        window.history.replaceState({}, '', '/?code=private-code&state=private-state')
        const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
        mocks.getTokenSilently.mockResolvedValue(tokenForUser('current-user'))
        const client = createAuthClient({ auth: {
            audience: 'audience',
            clientId: 'client',
            domain: 'tenant.auth0.com',
            logoutReturnTo: window.location.origin,
            redirectUri: `${window.location.origin}/callback`,
        } })

        expect((await client.initializeSession())?.userId).toBe('current-user')
        expect(mocks.init).toHaveBeenCalledOnce()
        expect(replace).not.toHaveBeenCalled()
        expect(window.location.search).toBe('?code=private-code&state=private-state')
    })
})

describe('auth client', () => {
    it('resumes an application handoff once through Auth0 when the destination has no usable token', async () => {
        vi.resetAllMocks()
        window.history.replaceState({}, '', '/settings?organization=one&auth=continue#history')
        mocks.getTokenSilently.mockResolvedValue(false)
        const client = createAuthClient({ auth: {
            audience: 'audience',
            clientId: 'client',
            domain: 'tenant.auth0.com',
            logoutReturnTo: 'https://example.com',
            redirectUri: window.location.origin,
        } })

        await expect(client.initializeSession()).resolves.toBeNull()
        expect(mocks.login).toHaveBeenCalledExactlyOnceWith(false, undefined)
        expect(mocks.getTokenSilently).toHaveBeenCalledOnce()
        expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/settings?organization=one#history')

        mocks.getTokenSilently.mockResolvedValue(false)
        await expect(client.initializeSession()).resolves.toBeNull()
        expect(mocks.login).toHaveBeenCalledOnce()
    })

    it('uses the same account at the destination without another authorization redirect', async () => {
        vi.resetAllMocks()
        const hint = await createSessionAccountHint('auth0|current-user')
        window.history.replaceState({}, '', `/?auth=continue&auth_account=${hint}`)
        mocks.getTokenSilently.mockResolvedValue(tokenForUser('auth0|current-user'))
        const client = createAuthClient({ auth: {
            audience: 'audience',
            clientId: 'client',
            domain: 'tenant.auth0.com',
            logoutReturnTo: 'https://example.com',
            redirectUri: window.location.origin,
        } })
        expect((await client.initializeSession())?.userId).toBe('auth0|current-user')
        expect(mocks.login).not.toHaveBeenCalled()
        expect(window.location.search).toBe('')
        expect(mocks.clearSession).not.toHaveBeenCalled()
        const destination = new URL(client.createSessionHandoffUrl('https://workspace.example.com'))
        expect(destination.searchParams.get('auth_account')).toMatch(/^[a-f0-9]{32}\.[a-f0-9]{64}$/)
    })

    it.each(['different', 'missing', 'malformed'])('replaces a cached account through SSO when the source account hint is %s', async hintKind => {
        vi.resetAllMocks()
        const hint = hintKind === 'different' ? await createSessionAccountHint('email|new-user') : hintKind === 'malformed' ? 'invalid' : ''
        window.history.replaceState({}, '', `/onboarding?auth=continue&auth_account=${hint}`)
        mocks.getTokenSilently.mockResolvedValue(tokenForUser('google-oauth2|previous-user'))
        const client = createAuthClient({ auth: {
            audience: 'audience',
            clientId: 'client',
            domain: 'tenant.auth0.com',
            logoutReturnTo: 'https://example.com',
            redirectUri: window.location.origin,
        } })
        client.userStore.setDataValues({ userId: 'google-oauth2|previous-user' })

        await expect(client.initializeSession()).resolves.toBeNull()
        expect(client.userStore.getData('userId')).toBe('')
        expect(mocks.clearSession).toHaveBeenCalledOnce()
        expect(mocks.logout).not.toHaveBeenCalled()
        expect(mocks.login).toHaveBeenCalledExactlyOnceWith(false, undefined)
        expect(mocks.clearSession.mock.invocationCallOrder[0]).toBeLessThan(mocks.login.mock.invocationCallOrder[0])
        expect(window.location.search).toBe('')

        // The verified callback supplies the new account; the consumed marker
        // cannot send it into another authorization loop.
        mocks.getTokenSilently.mockResolvedValue(tokenForUser('email|new-user'))
        expect((await client.initializeSession())?.userId).toBe('email|new-user')
        expect(mocks.login).toHaveBeenCalledOnce()
        await client.clearSession()
        expect(new URL(client.createSessionHandoffUrl('https://workspace.example.com')).searchParams.has('auth_account')).toBe(false)
    })

    it('accepts a successful callback without comparing an untrusted handoff hint', async () => {
        vi.resetAllMocks()
        window.history.replaceState({}, '', '/?code=verified-by-sdk&state=bound&auth=continue&auth_account=invalid')
        mocks.getTokenSilently.mockResolvedValue(tokenForUser('email|new-user'))
        const client = createAuthClient({ auth: {
            audience: 'audience',
            clientId: 'client',
            domain: 'tenant.auth0.com',
            logoutReturnTo: 'https://example.com',
            redirectUri: window.location.origin,
        } })
        expect((await client.initializeSession())?.userId).toBe('email|new-user')
        expect(mocks.login).not.toHaveBeenCalled()
        expect(window.location.search).toBe('?code=verified-by-sdk&state=bound')
    })

    it('does not restart a denied callback carrying a handoff marker', async () => {
        vi.resetAllMocks()
        window.history.replaceState({}, '', '/?error=access_denied&state=bound&auth=continue')
        mocks.init.mockRejectedValue(new Error('access_denied'))
        const client = createAuthClient({ auth: {
            audience: 'audience',
            clientId: 'client',
            domain: 'tenant.auth0.com',
            logoutReturnTo: 'https://example.com',
            redirectUri: window.location.origin,
        } })

        await expect(client.initializeSession()).rejects.toThrow('access_denied')
        expect(mocks.login).not.toHaveBeenCalled()
    })
    it('clears user state before cleanup, discards an in-flight token and redirects once afterwards', async () => {
        vi.resetAllMocks()
        const token = Promise.withResolvers<string>()
        const cleanup = Promise.withResolvers<void>()
        mocks.getTokenSilently.mockReturnValue(token.promise)
        const client = createAuthClient({ auth: {
            audience: 'audience',
            clientId: 'client',
            domain: 'auth.example.com',
            logoutReturnTo: 'https://example.com',
            redirectUri: window.location.origin,
        } })
        client.userStore.setDataValues({
            userId: 'user',
            email: 'private@example.com',
        })
        const pendingToken = client.getTokenSilently()
        const rejected = client.rejectAccess(async () => await cleanup.promise)
        expect(client.userStore.getData('userId')).toBe('')
        expect(mocks.login).not.toHaveBeenCalled()
        token.resolve('late-token')
        await expect(pendingToken).resolves.toBe(false)
        expect(client.rejectAccess(vi.fn())).toBe(rejected)
        cleanup.resolve()
        await rejected
        expect(mocks.clearSession).toHaveBeenCalledOnce()
        expect(mocks.recoverAccess).toHaveBeenCalledOnce()
        expect(mocks.login).not.toHaveBeenCalled()
        await expect(client.getTokenSilently()).resolves.toBe(false)
    })

    it('combines authentication and current-user loading behind one injected client', async () => {
        vi.resetAllMocks()
        const accessToken = tokenForUser('user-1')
        mocks.getTokenSilently.mockResolvedValue(accessToken)
        const userState = createUserStore()
        const request = vi.fn(async () => ({
            userId: 'user-1',
            email: 'user@example.com',
        }))
        const authState = createAuthStore()
        const client = createAuthClient({
            auth: {
                audience: 'audience',
                clientId: 'client-id',
                domain: 'auth.example.com',
                logoutReturnTo: 'https://example.com',
                redirectUri: window.location.origin,
            },
            authStore: authState,
            userStore: userState,
        })

        await client.init()
        await client.loadCurrentUser({ requestClient: { request } })

        expect(mocks.init).toHaveBeenCalledOnce()
        expect(client.authStore).toBe(authState)
        expect(client.userStore).toBe(userState)
        expect(request).toHaveBeenCalledWith(
            expect.any(String),
            { token: accessToken },
        )
        expect(userState.getData('userId')).toBe('user-1')
        expect(userState.getMeta('loadingStatus')).toBe(LoadingStatus.success)
        expect(mocks.confirmAccess).toHaveBeenCalledOnce()
    })

    it('owns isolated auth and current-user stores by default', () => {
        const firstClient = createAuthClient({
            features: {
                auth: false,
                currentUser: false,
            },
        })
        const secondClient = createAuthClient({
            features: {
                auth: false,
                currentUser: false,
            },
        })

        firstClient.authStore.setMetaValues({ isAuthenticated: true })
        firstClient.userStore.setDataValues({ userId: 'user-1' })

        expect(secondClient.authStore.getMeta('isAuthenticated')).toBe(false)
        expect(secondClient.userStore.getData('userId')).toBe('')
    })

    it('enables authentication and current-user loading by default', () => {
        const client = createAuthClient({
            auth: {
                audience: 'audience',
                clientId: 'client-id',
                domain: 'auth.example.com',
                logoutReturnTo: 'https://example.com',
                redirectUri: window.location.origin,
            },
        })

        expect(client.features).toEqual({
            auth: true,
            currentUser: true,
        })
    })

    it('initializes an access-token session for injected transports', async () => {
        vi.resetAllMocks()
        const accessToken = tokenForUser('auth0|user-1')
        mocks.getTokenSilently.mockResolvedValue(accessToken)
        const client = createAuthClient({
            auth: {
                audience: 'audience',
                clientId: 'client-id',
                domain: 'auth.example.com',
                logoutReturnTo: 'https://example.com',
                redirectUri: window.location.origin,
            },
        })

        const session = await client.initializeSession()

        expect(mocks.init).toHaveBeenCalledOnce()
        expect(session?.accessToken).toBe(accessToken)
        expect(session?.userId).toBe('auth0|user-1')
        await session?.refreshToken()
        expect(mocks.getTokenSilently).toHaveBeenLastCalledWith(true)
    })

    it('returns no session for a signed-out visitor but preserves callback failures', async () => {
        vi.resetAllMocks()
        mocks.getTokenSilently.mockResolvedValue(false)
        const client = createAuthClient({
            auth: {
                audience: 'audience',
                clientId: 'client-id',
                domain: 'tenant.auth0.com',
                logoutReturnTo: 'https://example.com',
                redirectUri: window.location.origin,
            },
        })

        await expect(client.initializeSession()).resolves.toBeNull()
        const callbackError = new Error('access_denied')
        mocks.init.mockRejectedValue(callbackError)
        await expect(client.initializeSession()).rejects.toBe(callbackError)
    })

    it('rejects a session token without a user identity', async () => {
        vi.resetAllMocks()
        mocks.getTokenSilently.mockResolvedValue([
            'header',
            Buffer.from('{}').toString('base64url'),
            'signature',
        ].join('.'))
        const client = createAuthClient({
            auth: {
                audience: 'audience',
                clientId: 'client-id',
                domain: 'auth.example.com',
                logoutReturnTo: 'https://example.com',
                redirectUri: window.location.origin,
            },
        })

        await expect(client.initializeSession()).rejects.toThrow('Authentication token has no user identity')
    })

    it('skips disabled authentication and current-user loading', async () => {
        vi.resetAllMocks()
        const request = vi.fn()
        const client = createAuthClient({
            auth: {
                audience: 'audience',
                clientId: 'client-id',
                domain: 'auth.example.com',
                logoutReturnTo: 'https://example.com',
                redirectUri: window.location.origin,
            },
            features: {
                auth: false,
                currentUser: false,
            },
        })

        await client.init()
        await expect(client.getTokenSilently()).resolves.toBe(false)
        await client.loadCurrentUser({ requestClient: { request } })

        expect(mocks.init).not.toHaveBeenCalled()
        expect(mocks.getTokenSilently).not.toHaveBeenCalled()
        expect(request).not.toHaveBeenCalled()
    })
})
