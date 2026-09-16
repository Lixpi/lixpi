import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { LoadingStatus } from '@lixpi/constants'

import { createAuthClient } from './authClient.ts'
import { createAuthStore } from './stores/authStore.ts'
import { createUserStore } from './stores/userStore.ts'

const mocks = vi.hoisted(() => ({
    getTokenSilently: vi.fn(),
    getUser: vi.fn(),
    init: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
}))

vi.mock('./auth/createAuthService.ts', () => ({
    createAuthService: () => mocks,
}))

const tokenForUser = (userId: string): string => [
    'header',
    Buffer.from(JSON.stringify({ sub: userId })).toString('base64url'),
    'signature',
].join('.')

describe('auth client', () => {
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
                redirectUri: 'https://example.com',
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
                redirectUri: 'https://example.com',
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
                redirectUri: 'https://example.com',
            },
        })

        const session = await client.initializeSession()

        expect(mocks.init).toHaveBeenCalledOnce()
        expect(session?.accessToken).toBe(accessToken)
        expect(session?.userId).toBe('auth0|user-1')
        await session?.refreshToken()
        expect(mocks.getTokenSilently).toHaveBeenLastCalledWith(true)
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
                redirectUri: 'https://example.com',
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
                redirectUri: 'https://example.com',
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
