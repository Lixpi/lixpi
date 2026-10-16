import { describe, expect, it, vi } from 'vitest'
import { type AccountPolicyRequest } from '@lixpi/constants'
import { AccountBrokerPolicy } from './account-broker-policy.ts'

const fixture = () => {
    const request: AccountPolicyRequest = {
        version: 1,
        nonce: 'a'.repeat(64),
        revision: 'b'.repeat(64),
        applicationRevision: 'c'.repeat(64),
        userNKey: `U${'A'.repeat(55)}`,
        issuer: 'https://auth.example.com/',
        audience: 'lixpi',
        subject: 'auth0|one',
        claim: {
            v: 1,
            epoch: 3,
        },
        tokenExpiresAt: Math.floor(Date.now() / 1000) + 600,
        grantExpiresAt: Math.floor(Date.now() / 1000) + 55,
    }
    const admission = { admitVerifiedToken: vi.fn(async () => ({
        issuer: request.issuer,
        subject: request.subject,
        epoch: 3,
        personalOrganizationId: 'org',
        identityKey: 'identity',
        tokenExpiresAt: request.tokenExpiresAt * 1000,
    })) }
    const ready = vi.fn(() => true)

    return {
        request,
        admission,
        ready,
        policy: new AccountBrokerPolicy(admission, {
            issuer: request.issuer,
            audience: request.audience,
            applicationRevision: request.applicationRevision,
        }, ready),
    }
}

// =============================================================================
// PRIVATE BROKER ADMISSION POLICY
// =============================================================================

describe('broker account admission decisions', () => {
    it('returns a request-bound decision after durable admission validation', async () => {
        const f = fixture()
        const controller = new AbortController()
        expect(await f.policy.check(f.request, controller.signal)).toEqual({
            version: 1,
            nonce: f.request.nonce,
            revision: f.request.revision,
            applicationRevision: f.request.applicationRevision,
            userNKey: f.request.userNKey,
            subject: f.request.subject,
            allowed: true,
            epoch: 3,
            expiresAt: f.request.grantExpiresAt,
        })
        expect(f.admission.admitVerifiedToken).toHaveBeenCalledExactlyOnceWith({
            iss: f.request.issuer,
            sub: f.request.subject,
            exp: f.request.tokenExpiresAt,
            'https://lixpi.ai/admission': f.request.claim,
        }, controller.signal)
    })

    it.each(['issuer', 'audience', 'applicationRevision'] as const)('denies a different %s before database access', async field => {
        const f = fixture()
        f.request[field] = field === 'applicationRevision' ? 'd'.repeat(64) : 'different'
        expect((await f.policy.check(f.request)).allowed).toBe(false)
        expect(f.admission.admitVerifiedToken).not.toHaveBeenCalled()
    })

    it('denies when revocation delivery is unavailable before or during validation', async () => {
        const f = fixture()
        f.ready.mockReturnValue(false)
        expect((await f.policy.check(f.request)).allowed).toBe(false)
        expect(f.admission.admitVerifiedToken).not.toHaveBeenCalled()
        f.ready.mockReturnValueOnce(true).mockReturnValue(false)
        expect((await f.policy.check(f.request)).allowed).toBe(false)
        expect(f.admission.admitVerifiedToken).toHaveBeenCalledTimes(1)
    })

    it('turns missing or blocked registration into a denial without exposing account state', async () => {
        const f = fixture()
        f.admission.admitVerifiedToken.mockRejectedValue(new Error('private account state'))
        const decision = await f.policy.check(f.request)
        expect(decision.allowed).toBe(false)
        expect(decision.epoch).toBe(0)
        expect(JSON.stringify(decision).includes('private account state')).toBe(false)
    })

    it('rejects a mismatched epoch, cancellation, and an extended lease', async () => {
        const f = fixture()
        expect((await f.policy.check({
            ...f.request,
            claim: {
                v: 1,
                epoch: 2,
            },
        })).allowed).toBe(false)
        expect((await f.policy.check(f.request, AbortSignal.abort())).allowed).toBe(false)
        expect((await f.policy.check({
            ...f.request,
            grantExpiresAt: f.request.tokenExpiresAt,
        })).allowed).toBe(false)
    })

    it.each([null, {}, {
        nonce: '*',
        subject: 'other',
    }])('refuses malformed requests without database access', async input => {
        const f = fixture()
        await expect(f.policy.check(input)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        expect(f.admission.admitVerifiedToken).not.toHaveBeenCalled()
    })
})
