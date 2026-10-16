import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountRequestScopes, type AccountRequestScope } from './account-request-scopes.ts'

const fixture = () => {
    const account = Object.freeze({
        identityKey: '7:issuer/7:subject',
        issuer: 'issuer/',
        subject: 'subject',
        epoch: 1,
        personalOrganizationId: 'organization',
        tokenExpiresAt: Date.now() + 60_000,
    })
    const read = vi.fn(async () => account)
    const scopes = new AccountRequestScopes({ admitVerifiedToken: read })
    scopes.setControlAvailable(true)

    return {
        account,
        read,
        scopes,
    }
}

afterEach(() => void vi.useRealTimers())

describe('epoch-bound request cancellation', () => {
    it('does not authorize work without a healthy invalidation feed', async () => {
        const f = fixture()
        f.scopes.setControlAvailable(false)
        const operation = vi.fn()
        await expect(f.scopes.run({}, operation)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        expect(operation).not.toHaveBeenCalled()
        expect(f.read).not.toHaveBeenCalled()
    })

    it('rechecks after installing the active-request index and closes finished scopes', async () => {
        const f = fixture()
        let received: AccountRequestScope | undefined
        await expect(f.scopes.run({}, async scope => {
            received = scope
            expect(f.read).toHaveBeenCalledTimes(2)
            expect(scope.signal.aborted).toBe(false)

            return 'result'
        })).resolves.toBe('result')
        expect(received?.signal.aborted).toBe(true)
        expect(() => received?.assertActive()).toThrow('ACCOUNT_ADMISSION_DENIED')
    })

    it('revocation during registration prevents the operation from starting', async () => {
        const f = fixture()
        f.read.mockImplementationOnce(async () => {
            f.scopes.invalidate({
                identityKey: f.account.identityKey,
                epoch: 2,
                state: 'blocked',
            })

            return f.account
        })
        const operation = vi.fn()
        await expect(f.scopes.run({}, operation)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        expect(operation).not.toHaveBeenCalled()
    })

    it('rejects a changed durable epoch at the second read', async () => {
        const f = fixture()
        f.read.mockResolvedValueOnce(f.account).mockResolvedValueOnce({
            ...f.account,
            epoch: 2,
        })
        const operation = vi.fn()
        await expect(f.scopes.run({}, operation)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        expect(operation).not.toHaveBeenCalled()
    })

    it('immediately aborts active work and discards an uncooperative late result', async () => {
        const f = fixture()
        const started = Promise.withResolvers<AccountRequestScope>()
        const provider = Promise.withResolvers<string>()
        const running = f.scopes.run({}, async scope => {
            started.resolve(scope)

            return await provider.promise
        })
        const denied = expect(running).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        const scope = await started.promise
        const childAbort = vi.fn()
        scope.signal.addEventListener('abort', childAbort)
        f.scopes.invalidate({
            identityKey: f.account.identityKey,
            epoch: 2,
            state: 'blocked',
        })
        expect(scope.signal.aborted).toBe(true)
        expect(childAbort).toHaveBeenCalledOnce()
        await denied
        provider.resolve('late result')
        expect(() => scope.assertActive()).toThrow('ACCOUNT_ADMISSION_DENIED')
    })

    it('propagates parent cancellation even if child work ignores the signal', async () => {
        const f = fixture()
        const started = Promise.withResolvers<void>()
        const provider = Promise.withResolvers<string>()
        const parent = new AbortController()
        const running = f.scopes.run({}, async () => {
            started.resolve()

            return await provider.promise
        }, parent.signal)
        const denied = expect(running).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        await started.promise
        parent.abort()
        await denied
        provider.resolve('ignored')
    })

    it('control-feed loss cancels work and reconnect cannot resume it', async () => {
        const f = fixture()
        const started = Promise.withResolvers<AccountRequestScope>()
        const provider = Promise.withResolvers<string>()
        const running = f.scopes.run({}, async scope => { started.resolve(scope)

        return await provider.promise })
        const denied = expect(running).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        const scope = await started.promise
        f.scopes.setControlAvailable(false)
        await denied
        f.scopes.setControlAvailable(true)
        expect(() => scope.assertActive()).toThrow('ACCOUNT_ADMISSION_DENIED')
        provider.resolve('ignored')
        await expect(f.scopes.run({}, async () => 'fresh')).resolves.toBe('fresh')
        expect(f.read).toHaveBeenCalledTimes(4)
    })

    it('older invalidations cannot undo a newer epoch and equal-epoch conflicts deny', async () => {
        const f = fixture()
        f.scopes.invalidate({
            identityKey: f.account.identityKey,
            epoch: 3,
            state: 'active',
        })
        f.scopes.invalidate({
            identityKey: f.account.identityKey,
            epoch: 2,
            state: 'blocked',
        })
        f.read.mockResolvedValue({
            ...f.account,
            epoch: 3,
        })
        await expect(f.scopes.run({}, async () => 'active')).resolves.toBe('active')
        f.scopes.invalidate({
            identityKey: f.account.identityKey,
            epoch: 3,
            state: 'blocked',
        })
        f.scopes.invalidate({
            identityKey: f.account.identityKey,
            epoch: 3,
            state: 'active',
        })
        await expect(f.scopes.run({}, async () => 'unexpected')).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
    })

    it('token expiry ends a request without waiting for its provider', async () => {
        vi.useFakeTimers()
        const f = fixture()
        const started = Promise.withResolvers<void>()
        const provider = Promise.withResolvers<string>()
        const running = f.scopes.run({}, async () => { started.resolve()

        return await provider.promise })
        const denied = expect(running).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        await started.promise
        await vi.advanceTimersByTimeAsync(60_000)
        await denied
        provider.resolve('ignored')
    })
})
