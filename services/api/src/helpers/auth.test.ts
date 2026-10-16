import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    verify: vi.fn(),
    currentAdmission: vi.fn(),
    admitVerifiedToken: vi.fn(),
    readFixture: vi.fn(),
}))
vi.mock('../services/account-admission-runtime.ts', () => ({ AccountAdmissionRuntime: { current: mocks.currentAdmission } }))
vi.mock('../services/account-admission.ts', () => ({ AccountAdmission: { forEnvironment: () => ({ admitVerifiedToken: mocks.readFixture }) } }))
vi.mock('@lixpi/auth-service', () => ({ createJwtVerifier: () => ({ verify: mocks.verify }) }))

describe('read-only request authentication', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.clearAllMocks()
        vi.stubEnv('MOCK_AUTH0', 'false')
        vi.stubEnv('ACCOUNT_ADMISSION_ENABLED', 'true')
        mocks.verify.mockResolvedValue({ decoded: {
            sub: 'google-oauth2|account',
            exp: Math.floor(Date.now() / 1000) + 60,
        } })
        mocks.currentAdmission.mockReturnValue({ admission: { admitVerifiedToken: mocks.admitVerifiedToken } })
        mocks.admitVerifiedToken.mockResolvedValue({ epoch: 1 })
        mocks.readFixture.mockResolvedValue({ epoch: 1 })
    })
    afterEach(() => vi.unstubAllEnvs())

    it('reads durable admission for every request, including repeated tokens and subjects', async () => {
        const { authenticateTokenOnRequest } = await import('./auth.ts')

        for (const eventName of ['document.submitSteps', 'document.submitSteps', 'document.resume'])
            expect(await authenticateTokenOnRequest({
                token: 'same-token',
                eventName,
            })).toHaveProperty('decoded')

        expect(mocks.admitVerifiedToken).toHaveBeenCalledTimes(3)
        expect(mocks.readFixture).not.toHaveBeenCalled()
    })

    it('enforces the same denial for HTTP, NATS and explicitly fresh verification', async () => {
        const {
            authenticateTokenOnRequest,
            jwtVerifier,
        } = await import('./auth.ts')
        mocks.admitVerifiedToken.mockRejectedValue(new Error('private account details'))
        expect(await authenticateTokenOnRequest({ token: 'missing' })).toEqual({ error: 'ACCOUNT_ADMISSION_DENIED' })
        expect(await authenticateTokenOnRequest({
            token: 'missing',
            requireFreshVerification: true,
        })).toEqual({ error: 'ACCOUNT_ADMISSION_DENIED' })
        expect(await jwtVerifier.verify('missing')).toEqual({ error: 'ACCOUNT_ADMISSION_DENIED' })
    })

    it('denies if control delivery fails before or during the read', async () => {
        const { jwtVerifier } = await import('./auth.ts')
        mocks.currentAdmission.mockImplementationOnce(() => { throw new Error('unavailable') })
        expect(await jwtVerifier.verify('token')).toEqual({ error: 'ACCOUNT_ADMISSION_DENIED' })
        expect(mocks.admitVerifiedToken).not.toHaveBeenCalled()
        mocks.currentAdmission.mockReturnValueOnce({ admission: { admitVerifiedToken: mocks.admitVerifiedToken } })
            .mockImplementationOnce(() => { throw new Error('disconnected') })
        expect(await jwtVerifier.verify('token')).toEqual({ error: 'ACCOUNT_ADMISSION_DENIED' })
    })

    it('denies real Auth0 when coordinated admission is disabled', async () => {
        vi.stubEnv('ACCOUNT_ADMISSION_ENABLED', 'false')
        const {
            authenticateTokenOnRequest,
            jwtVerifier,
        } = await import('./auth.ts')
        expect(await authenticateTokenOnRequest({ token: 'token' })).toEqual({ error: 'ACCOUNT_ADMISSION_DENIED' })
        expect(await jwtVerifier.verify('token')).toEqual({ error: 'ACCOUNT_ADMISSION_DENIED' })
        expect(mocks.readFixture).not.toHaveBeenCalled()
        expect(mocks.admitVerifiedToken).not.toHaveBeenCalled()
    })

    it('reads the existing local fixture on every mock request and propagates its denial', async () => {
        vi.stubEnv('MOCK_AUTH0', 'true')
        vi.stubEnv('ENVIRONMENT', 'local')
        vi.stubEnv('ACCOUNT_ADMISSION_ENABLED', 'false')
        const {
            authenticateTokenOnRequest,
            jwtVerifier,
        } = await import('./auth.ts')
        expect(await authenticateTokenOnRequest({ token: 'mock' })).toHaveProperty('decoded')
        mocks.readFixture.mockRejectedValueOnce(new Error('fixture missing'))
        expect(await authenticateTokenOnRequest({ token: 'mock' })).toEqual({ error: 'ACCOUNT_ADMISSION_DENIED' })
        expect(await jwtVerifier.verify('mock')).toHaveProperty('decoded')
        expect(mocks.readFixture).toHaveBeenCalledTimes(3)
    })

    it('never accepts the mock path outside local development', async () => {
        vi.stubEnv('MOCK_AUTH0', 'true')
        vi.stubEnv('ENVIRONMENT', 'production')
        vi.stubEnv('ACCOUNT_ADMISSION_ENABLED', 'false')
        const { jwtVerifier } = await import('./auth.ts')
        expect(await jwtVerifier.verify('mock')).toEqual({ error: 'ACCOUNT_ADMISSION_DENIED' })
        expect(mocks.readFixture).not.toHaveBeenCalled()
    })

    it('does not inspect account data after invalid tokens or expose dependency errors', async () => {
        const {
            authenticateTokenOnRequest,
            jwtVerifier,
        } = await import('./auth.ts')
        expect(await authenticateTokenOnRequest({ token: '' })).toEqual({ error: 'No token provided' })
        expect(mocks.verify).not.toHaveBeenCalled()
        mocks.verify.mockResolvedValueOnce({ error: 'token expired' })
        expect(await jwtVerifier.verify('expired')).toEqual({ error: 'token expired' })
        mocks.verify.mockRejectedValueOnce(new Error('private dependency failure'))
        expect(await jwtVerifier.verify('broken')).toEqual({ error: 'Invalid or expired token' })
        expect(mocks.admitVerifiedToken).not.toHaveBeenCalled()
        expect(mocks.readFixture).not.toHaveBeenCalled()
    })
})
