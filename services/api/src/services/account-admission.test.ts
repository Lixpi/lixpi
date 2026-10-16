import { describe, expect, it, vi } from 'vitest'
import { ACCOUNT_ADMISSION_CLAIM, getAccountIdentityKey } from '@lixpi/constants'
import { AccountAdmission } from './account-admission.ts'

type Row = Record<string, any>

const fixture = (mock = false) => {
    const issuer = mock ? 'http://localauth0/' : 'https://auth.accounts.example/'
    const subject = mock ? 'local|test-user-001' : 'google-oauth2|synthetic'
    const now = Date.now()
    const tables = {
        admission: 'admission',
        users: 'users',
        organizations: 'organizations',
        memberships: 'memberships',
    }
    const token: Row = {
        iss: issuer,
        sub: subject,
        exp: Math.floor(now / 1000) + 600,
        [ACCOUNT_ADMISSION_CLAIM]: {
            v: 1,
            epoch: 1,
        },
    }
    const admission: Row = {
        identityKey: getAccountIdentityKey(issuer, subject),
        schemaVersion: 1,
        issuer,
        subject,
        userId: subject,
        personalOrganizationId: 'org-1',
        state: 'active',
        epoch: 1,
        completedAt: now,
        updatedAt: now,
        emailVerification: {
            issuer,
            subject,
            connectionId: mock ? 'localauth0' : 'con_google',
            email: 'verified@example.test',
            providerEmail: 'verified@example.test',
            source: mock ? 'local_fixture' : 'provider',
            verifiedAt: now,
        },
    }
    const records: Row[] = [admission,
        {
            userId: subject,
            email: 'verified@example.test',
            organizations: ['org-1'],
        },
        {
            organizationId: 'org-1',
            accessList: { [subject]: 'owner' },
        },
        {
            userId: subject,
            organizationId: 'org-1',
            accessLevel: 'owner',
        },
    ]
    const read = vi.fn(async request => request.items.length === 1 ? [admission] : records)
    const service = new AccountAdmission({ transactRead: read }, tables, {
        issuer,
        mock,
    })

    return {
        issuer,
        subject,
        token,
        admission,
        records,
        read,
        service,
    }
}

describe('read-only account admission', () => {
    it('requires a complete local-only fixture configuration before reading records', () => {
        const reader = { transactRead: vi.fn() }
        const configuration = {
            MOCK_AUTH0: 'true',
            ENVIRONMENT: 'local',
            MOCK_AUTH0_DOMAIN: 'localhost:3000',
            ORG_NAME: 'test',
            STAGE: 'local',
        }
        expect(AccountAdmission.forEnvironment(reader, configuration)).toBeInstanceOf(AccountAdmission)

        for (const changes of [{ ORG_NAME: '' }, { STAGE: '' }, { ENVIRONMENT: 'production' }, { MOCK_AUTH0_DOMAIN: '' }])
            expect(() => AccountAdmission.forEnvironment(reader, {
                ...configuration,
                ...changes,
            })).toThrow()

        expect(reader.transactRead).not.toHaveBeenCalled()
    })

    it('admits a stored native Microsoft email proof and rejects a changed mailbox', async () => {
        const f = fixture()
        f.admission.emailVerification.source = 'enterprise_otp'
        f.admission.emailVerification.connectionId = 'con_microsoft'
        await expect(f.service.admitVerifiedToken(f.token)).resolves.toBeDefined()
        f.admission.emailVerification.providerEmail = 'other@example.test'
        await expect(f.service.admitVerifiedToken(f.token)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
    })
    it('requires the consumed hosted challenge reference and provider snapshot', async () => {
        const f = fixture()
        f.admission.emailVerification = {
            ...f.admission.emailVerification,
            source: 'form_otp',
            providerEmail: null,
            providerSubject: 'synthetic',
            challengeId: '85888ee7-2cf1-42b5-a232-f21b91cdfa98',
        }
        await expect(f.service.admitVerifiedToken(f.token)).resolves.toBeDefined()

        for (const changes of [{ challengeId: '' }, { providerSubject: '' }, { providerEmail: 'x'.repeat(513) }]) {
            const original = { ...f.admission.emailVerification }
            f.admission.emailVerification = {
                ...f.admission.emailVerification,
                ...changes,
            }
            await expect(f.service.admitVerifiedToken(f.token)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
            f.admission.emailVerification = {
                ...f.admission.emailVerification,
                ...original,
            }
        }
    })
    it('requires a coherent transactional snapshot for the verified subject', async () => {
        const f = fixture()
        await expect(f.service.admitVerifiedToken(f.token)).resolves.toEqual({
            identityKey: f.admission.identityKey,
            issuer: f.issuer,
            subject: f.subject,
            epoch: 1,
            personalOrganizationId: 'org-1',
            tokenExpiresAt: f.token.exp * 1000,
        })
        expect(f.read).toHaveBeenCalledTimes(2)
        expect(f.read.mock.calls[1][0].items).toEqual([
            {
                tableName: 'admission',
                key: { identityKey: f.admission.identityKey },
            },
            {
                tableName: 'users',
                key: { userId: f.subject },
            },
            {
                tableName: 'organizations',
                key: { organizationId: 'org-1' },
            },
            {
                tableName: 'memberships',
                key: {
                    userId: f.subject,
                    organizationId: 'org-1',
                },
            },
        ])
    })

    const tokenChanges: Array<[string, (token: Row) => void]> = [
        ['missing admission', token => void (delete token[ACCOUNT_ADMISSION_CLAIM])],
        ['wrong version', token => void (token[ACCOUNT_ADMISSION_CLAIM].v = 2)],
        ['zero epoch', token => void (token[ACCOUNT_ADMISSION_CLAIM].epoch = 0)],
        ['fractional epoch', token => void (token[ACCOUNT_ADMISSION_CLAIM].epoch = 1.5)],
        ['wrong issuer', token => void (token.iss = 'https://other.example/')],
        ['missing subject', token => void (delete token.sub)],
        ['invalid Unicode subject', token => void (token.sub = '\ud800')],
        ['expired token', token => void (token.exp = 1)],
        ['missing expiry', token => void (delete token.exp)],
    ]
    it.each(tokenChanges)('denies %s without reading the database', async (_name, mutate) => {
        const f = fixture()
        mutate(f.token)
        await expect(f.service.admitVerifiedToken(f.token)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        expect(f.read).not.toHaveBeenCalled()
    })

    const recordChanges: Array<[string, (f: ReturnType<typeof fixture>) => void]> = [
        ['blocked', f => void (f.admission.state = 'blocked')],
        ['blocking intent', f => void (f.admission.blockRequested = true)],
        ['pending email proof', f => void (f.admission.emailPending = [{ subject: 'test' }])],
        ['malformed email suspension', f => void (f.admission.emailPending = {})],
        ['email verification required', f => void (f.admission.state = 'verification_required')],
        ['reconciling', f => void (f.admission.state = 'reconciling')],
        ['superseded', f => void (f.admission.state = 'superseded')],
        ['released unused reservation', f => void (f.admission.state = 'unregistered')],
        ['stale epoch', f => void (f.admission.epoch = 2)],
        ['wrong canonical user', f => void (f.admission.userId = 'other-user')],
        ['operation lock', f => void (f.admission.operationId = 'operation')],
        ['canonical alias', f => void (f.admission.canonicalSubject = 'other-user')],
        ['unsupported schema', f => void (f.admission.schemaVersion = 2)],
        ['incomplete timestamp', f => void (f.admission.completedAt = 0)],
        ['mismatched proof subject', f => void (f.admission.emailVerification.subject = 'other-user')],
        ['untrusted proof source', f => void (f.admission.emailVerification.source = 'metadata')],
        ['local proof in real mode', f => void (f.admission.emailVerification.source = 'local_fixture')],
        ['changed provider mailbox', f => void (f.admission.emailVerification.providerEmail = 'other@example.test')],
        ['changed profile mailbox', f => void (f.records[1].email = 'other@example.test')],
        ['missing association', f => void (f.records[1].organizations = [])],
        ['missing owner grant', f => void (f.records[2].accessList = {})],
        ['weaker membership', f => void (f.records[3].accessLevel = 'viewer')],
        ['wrong membership owner', f => void (f.records[3].userId = 'other-user')],
        ['wrong membership organization', f => void (f.records[3].organizationId = 'other-org')],
    ]
    it.each(recordChanges)('denies %s with the same public error', async (_name, mutate) => {
        const f = fixture()
        mutate(f)
        await expect(f.service.admitVerifiedToken(f.token)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
    })

    it.each([0, 1, 2, 3])('denies a missing snapshot record at position %s', async index => {
        const f = fixture()
        f.read.mockResolvedValueOnce([f.admission])
        f.records[index] = undefined as unknown as Row
        await expect(f.service.admitVerifiedToken(f.token)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
    })

    it('denies an organization pointer changed during the read', async () => {
        const f = fixture()
        f.read.mockResolvedValueOnce([{ ...f.admission }])
        f.admission.personalOrganizationId = 'different-org'
        await expect(f.service.admitVerifiedToken(f.token)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
    })

    it('accepts only the fixed mock identity and fixture proof in mock mode', async () => {
        const f = fixture(true)
        await expect(f.service.admitVerifiedToken(f.token)).resolves.toMatchObject({
            subject: 'local|test-user-001',
            epoch: 1,
        })
        f.admission.emailVerification.source = 'provider'
        await expect(f.service.admitVerifiedToken(f.token)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        f.token.sub = 'another-mock-user'
        f.read.mockClear()
        await expect(f.service.admitVerifiedToken(f.token)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        expect(f.read).not.toHaveBeenCalled()
    })

    it('does not return a result after request cancellation', async () => {
        const f = fixture()
        const controller = new AbortController()
        f.read.mockImplementationOnce(async () => {
            controller.abort()

            return [f.admission]
        })
        await expect(f.service.admitVerifiedToken(f.token, controller.signal)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        expect(f.read.mock.calls[0][0].abortSignal.aborted).toBe(true)
    })

    it('fails closed on a database error without exposing the dependency', async () => {
        const f = fixture()
        f.read.mockRejectedValue(new Error('table unavailable: internal-record-key'))
        await expect(f.service.admitVerifiedToken(f.token)).rejects.toThrow(/^ACCOUNT_ADMISSION_DENIED$/)
    })
})
