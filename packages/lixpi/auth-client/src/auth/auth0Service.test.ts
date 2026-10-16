import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const mocks = vi.hoisted(() => ({
    getTokenSilently: vi.fn(),
    getUser: vi.fn(),
    handleRedirectCallback: vi.fn(),
    isAuthenticated: vi.fn(),
    loginWithRedirect: vi.fn(),
    logout: vi.fn(),
}))

vi.mock('@auth0/auth0-spa-js', () => ({
    Auth0Client: vi.fn(class {
        constructor() { return mocks }
    }),
}))

import { Auth0Client } from '@auth0/auth0-spa-js'
import { createAuthStore } from '../stores/authStore.ts'
import { createAuth0Service } from './auth0Service.ts'

const config = {
    audience: 'https://api.lixpi.test',
    clientId: 'client-id',
    domain: 'auth.lixpi.test',
    logoutReturnTo: 'https://user-portal.lixpi.test',
    redirectUri: 'https://user-portal.lixpi.test',
}

beforeEach(() => {
    vi.resetAllMocks()
    mocks.isAuthenticated.mockResolvedValue(false)
    window.history.replaceState({}, '', '/')
    sessionStorage.clear()
})

describe('Auth0 web client service', () => {
    it('starts signup through the SDK with fresh authentication and a local return path', async () => {
        const service = createAuth0Service(config, createAuthStore())
        await service.init()
        await service.login(true, 'signup')
        expect(mocks.loginWithRedirect).toHaveBeenCalledWith({
            appState: { returnTo: '/' },
            authorizationParams: {
                redirect_uri: config.redirectUri,
                screen_hint: 'signup',
                prompt: 'login',
                max_age: 0,
            },
        })
    })

    it('does not silently redirect after a denied forced refresh and clears cached sessions before fresh login', async () => {
        const store = createAuthStore()
        const service = createAuth0Service(config, store)
        await service.init()
        mocks.getTokenSilently.mockRejectedValue(new Error('access_denied'))
        await expect(service.getTokenSilently(true)).resolves.toBe(false)
        expect(mocks.loginWithRedirect).not.toHaveBeenCalled()
        await service.clearSession()
        expect(mocks.logout).toHaveBeenCalledWith({ openUrl: false })
        await service.login(true)
        expect(mocks.loginWithRedirect).toHaveBeenCalledWith({
            appState: { returnTo: '/' },
            authorizationParams: {
                redirect_uri: config.redirectUri,
                prompt: 'login',
                max_age: 0,
            },
        })
    })

    it('projects the authenticated Auth0 profile into the auth store', async () => {
        const store = createAuthStore()
        const service = createAuth0Service(config, store)
        const user = {
            sub: 'auth0|user-1',
            name: 'User One',
        }
        mocks.isAuthenticated.mockResolvedValue(true)
        mocks.getUser.mockResolvedValue(user)

        await service.init()

        expect(Auth0Client).toHaveBeenCalledWith(expect.objectContaining({
            useRefreshTokens: true,
            useRefreshTokensFallback: true,
            cacheLocation: 'localstorage',
        }))
        expect(store.getMeta()).toEqual({
            isAuthenticated: true,
            isLoading: false,
        })
        expect(store.getData('user')).toEqual(user)
    })

    it('bypasses the SDK cache when a forced token refresh is requested', async () => {
        const service = createAuth0Service(config, createAuthStore())
        mocks.getTokenSilently.mockResolvedValue('fresh-token')
        await service.init()

        await expect(service.getTokenSilently(true)).resolves.toBe('fresh-token')
        expect(mocks.getTokenSilently).toHaveBeenCalledWith({ cacheMode: 'off' })
    })

    it('falls back to an Auth0 redirect when silent token acquisition fails', async () => {
        const service = createAuth0Service(config, createAuthStore())
        mocks.getTokenSilently.mockRejectedValue(new Error('login_required'))
        await service.init()

        await expect(service.getTokenSilently()).resolves.toBe(false)
        expect(mocks.loginWithRedirect).toHaveBeenCalledWith({
            appState: { returnTo: '/' },
            authorizationParams: {
                redirect_uri: config.redirectUri,
            },
        })
    })

    it('stops repeated automatic redirects across page instances until an explicit retry', async () => {
        const first = createAuth0Service(config, createAuthStore())
        await first.init()
        await first.recoverAccess()
        const callback = createAuth0Service(config, createAuthStore())
        await callback.init()
        await expect(callback.recoverAccess()).rejects.toThrow('Sign-in could not be completed')
        expect(mocks.loginWithRedirect).toHaveBeenCalledTimes(1)
        await callback.login(true)
        expect(mocks.loginWithRedirect).toHaveBeenCalledTimes(2)
        callback.confirmAccess()
        await callback.recoverAccess()
        expect(mocks.loginWithRedirect).toHaveBeenCalledTimes(3)
    })

    it('processes a denied callback through the SDK, removes it, and leaves retry available without another automatic redirect', async () => {
        window.history.replaceState({}, '', '/?error=access_denied&error_description=private&state=bound')
        mocks.handleRedirectCallback.mockRejectedValue(new Error('access_denied'))
        const service = createAuth0Service(config, createAuthStore())
        await expect(service.init()).rejects.toThrow('access_denied')
        expect(mocks.handleRedirectCallback).toHaveBeenCalledOnce()
        expect(window.location.search).toBe('')
        expect(mocks.loginWithRedirect).not.toHaveBeenCalled()
        await service.login(true)
        expect(mocks.loginWithRedirect).toHaveBeenCalledOnce()
    })

    it.each(['https://attacker.test/secret', '//attacker.test', '/\\attacker.test', '/\nunsafe'])('refuses an external or malformed callback destination %j', async returnTo => {
        window.history.replaceState({}, '', '/?code=single-use&state=bound')
        mocks.handleRedirectCallback.mockResolvedValue({ appState: { returnTo } })
        await createAuth0Service(config, createAuthStore()).init()
        expect(window.location.pathname).toBe('/')
        expect(window.location.search).toBe('')
    })

    it('restores a local destination only after the SDK accepts state and code', async () => {
        window.history.replaceState({}, '', '/?code=single-use&state=bound')
        mocks.handleRedirectCallback.mockResolvedValue({ appState: { returnTo: '/workspaces/one?view=canvas#selection' } })
        await createAuth0Service(config, createAuthStore()).init()
        expect(window.location.pathname + window.location.search + window.location.hash).toBe('/workspaces/one?view=canvas#selection')
    })

    it.each(['?error=access_denied', '?code=one&state=one&state=two', '?code=one&error=denied&state=one'])('rejects malformed callback %s instead of reusing an existing session', async query => {
        window.history.replaceState({}, '', `/${query}`)
        mocks.isAuthenticated.mockResolvedValue(true)
        await expect(createAuth0Service(config, createAuthStore()).init()).rejects.toThrow('callback is incomplete')
        expect(mocks.handleRedirectCallback).not.toHaveBeenCalled()
        expect(mocks.loginWithRedirect).not.toHaveBeenCalled()
        expect(window.location.search).toBe('')
    })
})
