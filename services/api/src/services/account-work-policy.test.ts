import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_WORK_ADMISSION_SUBJECT, getAccountIdentityKey } from '@lixpi/constants'
import { AccountRequestScopes } from './account-request-scopes.ts'
import { AccountWorkPolicy } from './account-work-policy.ts'

const runtime = vi.hoisted(() => ({ current: vi.fn() }))
vi.mock('./account-admission-runtime.ts', () => ({ AccountAdmissionRuntime: runtime }))

const account = {
    issuer: 'https://auth.example.com/',
    subject: 'user',
    epoch: 1,
    identityKey: getAccountIdentityKey('https://auth.example.com/', 'user'),
    personalOrganizationId: 'org',
    tokenExpiresAt: Math.floor(Date.now() / 1000) * 1000 + 60000,
}

describe('private worker policy', () => {
    let callback: (error: unknown, message: unknown) => void
    let scopes: AccountRequestScopes
    let policy: AccountWorkPolicy
    const unsubscribe = vi.fn()

    beforeEach(() => {
        vi.stubEnv('ACCOUNT_ADMISSION_ENABLED', 'true')
        scopes = new AccountRequestScopes({ admitVerifiedToken: vi.fn(async () => account) })
        scopes.setControlAvailable(true)
        runtime.current.mockReturnValue({ scopes })
        policy = new AccountWorkPolicy({ getConnection: () => ({ subscribe: (subject, options) => {
            expect(subject).toBe(ACCOUNT_WORK_ADMISSION_SUBJECT)
            callback = options.callback

            return { unsubscribe }
        } }) } as never)
        policy.start()
    })
    afterEach(() => { policy.stop(); vi.unstubAllEnvs() })

    const request = async (payload: unknown, size = 200): Promise<any> => {
        const response = Promise.withResolvers<unknown>()
        callback(null, {
            reply: '_INBOX.worker',
            data: new Uint8Array(size),
            json: () => payload,
            respond: data => response.resolve(JSON.parse(data)),
        })

        return await response.promise
    }

    it('binds a short lease to the original account and request nonce', async () => {
        const nonce = '11111111-1111-1111-1111-111111111111'
        const before = Date.now()
        const reply = await request({
            version: 1,
            nonce,
            accountContext: account,
        })
        expect(reply).toMatchObject({
            version: 1,
            nonce,
            accountContext: account,
        })
        expect(reply.expiresAt).toBeGreaterThan(before)
        expect(reply.expiresAt).toBeLessThanOrEqual(Date.now() + 30000)
    })

    it('denies revoked, altered and malformed work without exposing account state', async () => {
        const payload = {
            version: 1,
            nonce: '11111111-1111-1111-1111-111111111111',
            accountContext: account,
        }

        for (const invalid of [null, {}, {
            ...payload,
            nonce: 'invalid',
        }, {
            ...payload,
            accountContext: {
                ...account,
                epoch: 2,
            },
        }])
            expect(await request(invalid)).toEqual({ error: 'ACCOUNT_ADMISSION_DENIED' })

        expect(await request(payload, 4097)).toEqual({ error: 'ACCOUNT_ADMISSION_DENIED' })
        scopes.invalidate({
            identityKey: account.identityKey,
            epoch: 2,
            state: 'blocked',
        })
        expect(await request(payload)).toEqual({ error: 'ACCOUNT_ADMISSION_DENIED' })
    })
})
