import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import { NATS_SUBJECTS } from '@lixpi/constants'
import { jwtAuthMiddleware } from './nats-auth-middleware.ts'

const { authenticateTokenOnRequestMock } = vi.hoisted(() => ({
    authenticateTokenOnRequestMock: vi.fn(),
}))

vi.mock('../../helpers/auth.ts', () => ({
    authenticateTokenOnRequest: authenticateTokenOnRequestMock,
}))

vi.mock('@lixpi/debug-tools', () => ({
    log: vi.fn(),
    info: vi.fn(),
    infoStr: vi.fn(),
    warn: vi.fn(),
    err: vi.fn(),
}))

const membershipSubject = NATS_SUBJECTS.ORGANIZATION_SUBJECTS.GET_MEMBERSHIP

// =============================================================================
// Application authentication and NATS protocol requests
// =============================================================================

describe('jwtAuthMiddleware', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        authenticateTokenOnRequestMock.mockResolvedValue({
            decoded: {
                sub: 'user:verified',
                exp: Math.floor(Date.now() / 1000) + 60,
            },
        })
    })

    it.each([
        '$SYS.REQ.USER.AUTH',
        membershipSubject,
        'user.get',
        '$SYS.REQ.USER.AUTH.extra',
        '$SYS.REQ.OTHER',
    ])('rejects a tokenless request on %s, including forged identities', async subject => {
        await expect(jwtAuthMiddleware(
            { user: { userId: 'user:forged' } },
            { subject } as any,
        )).rejects.toThrow('Authentication required')
        expect(authenticateTokenOnRequestMock).not.toHaveBeenCalled()
    })

    it.each([undefined, null, '', 123, {}])('rejects a missing or non-string token: %j', async token => {
        await expect(jwtAuthMiddleware(
            { token },
            { subject: membershipSubject } as any,
        )).rejects.toThrow('Authentication required')
    })

    it('freshly verifies membership tokens and replaces caller-supplied identity', async () => {
        const data = {
            token: 'access-token',
            user: { userId: 'user:forged' },
            organizationId: 'org:one',
        }
        const msg = { subject: membershipSubject } as any

        const result = await jwtAuthMiddleware(data, msg)

        expect(authenticateTokenOnRequestMock).toHaveBeenCalledWith({
            token: 'access-token',
            eventName: membershipSubject,
            requireFreshVerification: true,
        })
        expect(result).toEqual({
            data: {
                user: { userId: 'user:verified' },
                organizationId: 'org:one',
            },
            msg,
        })
    })

    it.each([
        { error: 'Invalid signature' },
        { decoded: {
            sub: 'user:verified',
            exp: 1,
        } },
        { decoded: { sub: 'user:verified' } },
        { decoded: {
            sub: '',
            exp: Number.MAX_SAFE_INTEGER,
        } },
        { decoded: {
            sub: 123,
            exp: Number.MAX_SAFE_INTEGER,
        } },
    ])('rejects invalid or expired verified claims: %j', async verification => {
        authenticateTokenOnRequestMock.mockResolvedValue(verification)

        await expect(jwtAuthMiddleware(
            { token: 'invalid-token' },
            { subject: membershipSubject } as any,
        )).rejects.toThrow('Authentication failed: Invalid or expired token')
    })
})
