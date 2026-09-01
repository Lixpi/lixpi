'use strict'

import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const mocks = vi.hoisted(() => ({
    verify: vi.fn(),
    verifyRegistration: vi.fn(),
}))

vi.mock('@lixpi/auth-service', () => ({
    createJwtVerifier: vi.fn(() => ({
        verify: mocks.verify,
    })),
}))

vi.mock('../services/registration-service.ts', () => ({
    default: class MockRegistrationService {
        verifyRegistration = mocks.verifyRegistration
    },
}))

import { authenticateTokenOnRequest } from './auth.ts'

function makeDecodedToken(overrides: Record<string, unknown> = {}) {
    return {
        sub: 'google-apps|developers@prima.it',
        stripe_customer_id: 'cus_test',
        exp: Math.floor(Date.now() / 1000) + 60,
        ...overrides,
    }
}

// =============================================================================
// NATS AUTH REQUEST CACHE
// =============================================================================

describe('authenticateTokenOnRequest', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.verify.mockResolvedValue({ decoded: makeDecodedToken() })
        mocks.verifyRegistration.mockResolvedValue({ user: { userId: 'user-1' } })
    })

    it('reuses successful same-subject token authentication without another registration lookup', async () => {
        const firstResult = await authenticateTokenOnRequest({
            token: 'token-document-submit-steps',
            eventName: 'document.submitSteps',
        })
        const secondResult = await authenticateTokenOnRequest({
            token: 'token-document-submit-steps',
            eventName: 'document.submitSteps',
        })

        expect(firstResult).toEqual(secondResult)
        expect(mocks.verify).toHaveBeenCalledOnce()
        expect(mocks.verifyRegistration).toHaveBeenCalledOnce()
        expect(mocks.verifyRegistration).toHaveBeenCalledWith({
            decodedToken: expect.objectContaining({ sub: 'google-apps|developers@prima.it' }),
            accessToken: 'token-document-submit-steps',
        })
    })

    it('does not reuse the cache across different NATS subjects', async () => {
        await authenticateTokenOnRequest({
            token: 'token-subject-scoped-cache',
            eventName: 'document.submitSteps',
        })
        await authenticateTokenOnRequest({
            token: 'token-subject-scoped-cache',
            eventName: 'document.resume',
        })

        expect(mocks.verify).toHaveBeenCalledTimes(2)
        expect(mocks.verifyRegistration).toHaveBeenCalledTimes(2)
    })

    it('does not cache failed token verification', async () => {
        mocks.verify.mockResolvedValue({ error: 'token expired' })

        const firstResult = await authenticateTokenOnRequest({
            token: 'token-failed-auth',
            eventName: 'document.submitSteps',
        })
        const secondResult = await authenticateTokenOnRequest({
            token: 'token-failed-auth',
            eventName: 'document.submitSteps',
        })

        expect(firstResult).toEqual({ error: 'token expired' })
        expect(secondResult).toEqual({ error: 'token expired' })
        expect(mocks.verify).toHaveBeenCalledTimes(2)
        expect(mocks.verifyRegistration).not.toHaveBeenCalled()
    })
})
