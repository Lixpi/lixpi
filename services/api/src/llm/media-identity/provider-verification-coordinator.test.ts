'use strict'

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    createProviderVerificationState,
    normalizeProviderExpiresAt,
    verifyProviderVerificationState,
} from './provider-verification-coordinator.ts'

const state = (expiresAt: number) => ({
    sessionId: 'session-1',
    generationRequestId: 'request-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    provider: 'BytePlus' as const,
    assetId: 'asset-1',
    assetRevision: 3,
    nonce: 'nonce-1',
    expiresAt,
})

describe('provider verification state', () => {
    beforeEach(() => {
        process.env.PROVIDER_VERIFICATION_STATE_SECRET = 'a-secure-test-secret-with-at-least-32-bytes'
        vi.spyOn(Date, 'now').mockReturnValue(1_000)
    })

    afterEach(() => {
        delete process.env.PROVIDER_VERIFICATION_STATE_SECRET
        vi.restoreAllMocks()
    })

    it('round-trips signed, user/request-scoped callback state', () => {
        const token = createProviderVerificationState(state(2_000))

        expect(token).not.toContain('nonce-1')
        expect(verifyProviderVerificationState(token)).toEqual(state(2_000))
    })

    it('rejects callback state tampering', () => {
        const token = createProviderVerificationState(state(2_000))
        const [payload, signature] = token.split('.')

        expect(() => verifyProviderVerificationState(`${payload}x.${signature}`))
            .toThrow('PROVIDER_VERIFICATION_STATE_INVALID')
    })

    it('rejects expired callback state', () => {
        const token = createProviderVerificationState(state(999))

        expect(() => verifyProviderVerificationState(token))
            .toThrow('PROVIDER_VERIFICATION_STATE_EXPIRED')
    })

    it('refuses to sign state without an adequate server secret', () => {
        process.env.PROVIDER_VERIFICATION_STATE_SECRET = 'short'

        expect(() => createProviderVerificationState(state(2_000)))
            .toThrow('PROVIDER_VERIFICATION_STATE_SECRET_REQUIRED')
    })

    it('normalizes provider expiry timestamps to epoch milliseconds', () => {
        expect(normalizeProviderExpiresAt(1_900_000_000)).toBe(1_900_000_000_000)
        expect(normalizeProviderExpiresAt(1_900_000_000_000)).toBe(1_900_000_000_000)
    })
})
