'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import mockAuthService from '$src/services/auth0-mock-service.ts'

// The mock Auth0 service only touches authStore/domTemplates on the login and
// callback paths, none of which the token-refresh logic under test exercises.
// Stub them so importing the singleton has no side effects.
vi.mock('$src/stores/authStore.ts', () => ({
    authStore: {
        setMetaValues: vi.fn(),
        setDataValues: vi.fn(),
    },
}))

vi.mock('$src/utils/domTemplates.ts', () => ({
    applyStyle: vi.fn(),
}))

const STORAGE_KEY = 'localauth0_token'

// Build a syntactically valid JWT whose payload carries the given `exp` claim.
// Only the payload matters here — the mock service never verifies the signature.
const makeToken = (expSecondsFromNow: number): string => {
    const now = Math.floor(Date.now() / 1000)
    const base64url = (obj: object) =>
        btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const header = base64url({ typ: 'JWT', alg: 'none' })
    const payload = base64url({ exp: now + expSecondsFromNow })
    return `${header}.${payload}.sig`
}

let refreshSpy: ReturnType<typeof vi.spyOn>
let loginSpy: ReturnType<typeof vi.spyOn>
let consoleWarnSpy: ReturnType<typeof vi.spyOn> | null = null

// =============================================================================
// Auth0MockService.getTokenSilently — cache vs. forced refresh
// =============================================================================

describe('Auth0MockService — getTokenSilently', () => {
    beforeEach(() => {
        localStorage.clear()
        // refreshTokenViaIframe drives a hidden-iframe redirect that cannot run
        // under happy-dom, so stub it; login() would navigate the page away.
        refreshSpy = vi.spyOn(mockAuthService as any, 'refreshTokenViaIframe')
        loginSpy = vi.spyOn(mockAuthService as any, 'login').mockResolvedValue(undefined)
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    })

    afterEach(() => {
        refreshSpy.mockRestore()
        loginSpy.mockRestore()
        consoleWarnSpy?.mockRestore()
        consoleWarnSpy = null
        localStorage.clear()
    })

    it('returns the cached token without refreshing when it is still valid', async () => {
        const token = makeToken(3600)
        localStorage.setItem(STORAGE_KEY, token)

        const result = await mockAuthService.getTokenSilently()

        expect(result).toBe(token)
        expect(refreshSpy).not.toHaveBeenCalled()
    })

    it('bypasses a still-valid cached token when forceRefresh is true', async () => {
        localStorage.setItem(STORAGE_KEY, makeToken(3600))
        refreshSpy.mockResolvedValue('fresh-token')

        const result = await mockAuthService.getTokenSilently(true)

        expect(result).toBe('fresh-token')
        expect(refreshSpy).toHaveBeenCalledTimes(1)
    })

    it('refreshes when the cached token is expired', async () => {
        localStorage.setItem(STORAGE_KEY, makeToken(-10))
        refreshSpy.mockResolvedValue('fresh-token')

        const result = await mockAuthService.getTokenSilently()

        expect(result).toBe('fresh-token')
        expect(refreshSpy).toHaveBeenCalledTimes(1)
    })

    it('treats a token expiring within the 60s skew window as expired', async () => {
        localStorage.setItem(STORAGE_KEY, makeToken(30))
        refreshSpy.mockResolvedValue('fresh-token')

        const result = await mockAuthService.getTokenSilently()

        expect(result).toBe('fresh-token')
        expect(refreshSpy).toHaveBeenCalledTimes(1)
    })

    it('refreshes when no token is cached', async () => {
        refreshSpy.mockResolvedValue('fresh-token')

        const result = await mockAuthService.getTokenSilently()

        expect(result).toBe('fresh-token')
        expect(refreshSpy).toHaveBeenCalledTimes(1)
    })

    it('falls back to a full-page login and returns false when silent refresh fails', async () => {
        refreshSpy.mockRejectedValue(new Error('iframe blew up'))

        const result = await mockAuthService.getTokenSilently(true)

        expect(result).toBe(false)
        expect(loginSpy).toHaveBeenCalledTimes(1)
    })
})
