'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getTokenSilentlyMock = vi.hoisted(() => vi.fn())
const isAuthenticatedMock = vi.hoisted(() => vi.fn())
const loginWithRedirectMock = vi.hoisted(() => vi.fn())
const handleRedirectCallbackMock = vi.hoisted(() => vi.fn())
const getUserMock = vi.hoisted(() => vi.fn())

vi.mock('@auth0/auth0-spa-js', () => ({
    createAuth0Client: vi.fn(async () => ({
        getTokenSilently: getTokenSilentlyMock,
        isAuthenticated: isAuthenticatedMock,
        loginWithRedirect: loginWithRedirectMock,
        handleRedirectCallback: handleRedirectCallbackMock,
        getUser: getUserMock,
        logout: vi.fn(),
    })),
    Auth0Client: class {},
}))

vi.mock('$src/stores/authStore.ts', () => ({
    authStore: {
        setMetaValues: vi.fn(),
        setDataValues: vi.fn(),
    },
}))

import authService from '$src/services/auth0-service.ts'

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null

// =============================================================================
// Auth0Service.getTokenSilently — cache mode forwarding + error fallback
// =============================================================================

describe('Auth0Service — getTokenSilently', () => {
    beforeEach(async () => {
        getTokenSilentlyMock.mockReset()
        loginWithRedirectMock.mockReset().mockResolvedValue(undefined)
        // Keep init()'s updateAuthData quiet: report not-authenticated so it does
        // not try to resolve a user profile.
        isAuthenticatedMock.mockReset().mockResolvedValue(false)
        handleRedirectCallbackMock.mockReset()
        getUserMock.mockReset()
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

        // Wire up the underlying (mocked) Auth0 client on the singleton.
        await authService.init()
    })

    afterEach(() => {
        consoleErrorSpy?.mockRestore()
        consoleErrorSpy = null
    })

    it('uses the cache by default (no cacheMode override)', async () => {
        getTokenSilentlyMock.mockResolvedValue('cached-token')

        const result = await authService.getTokenSilently()

        expect(result).toBe('cached-token')
        expect(getTokenSilentlyMock).toHaveBeenCalledWith(undefined)
    })

    it('bypasses the cache when forceRefresh is true', async () => {
        getTokenSilentlyMock.mockResolvedValue('fresh-token')

        const result = await authService.getTokenSilently(true)

        expect(result).toBe('fresh-token')
        expect(getTokenSilentlyMock).toHaveBeenCalledWith({ cacheMode: 'off' })
    })

    it('returns false and redirects to login when token retrieval throws', async () => {
        getTokenSilentlyMock.mockRejectedValue(new Error('login_required'))

        const result = await authService.getTokenSilently(true)

        expect(result).toBe(false)
        expect(loginWithRedirectMock).toHaveBeenCalledTimes(1)
    })
})
