import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountRequestScopes, type AccountRequestScope } from './account-request-scopes.ts'
import { AccountRequestContext } from './account-request-context.ts'

const runtime = vi.hoisted(() => ({ current: vi.fn() }))
vi.mock('./account-admission-runtime.ts', () => ({ AccountAdmissionRuntime: runtime }))

const account = {
    identityKey: '7:issuer/7:subject',
    issuer: 'issuer/',
    subject: 'subject',
    epoch: 1,
    personalOrganizationId: 'organization',
    tokenExpiresAt: Date.now() + 60_000,
}
const decoded = {
    iss: account.issuer,
    sub: account.subject,
    exp: Math.floor(account.tokenExpiresAt / 1000),
}
let scopes: AccountRequestScopes

class TestResponse extends EventEmitter {
    write = vi.fn().mockReturnValue(true)
    end = vi.fn()
    destroy = vi.fn()
}

beforeEach(() => {
    vi.stubEnv('ACCOUNT_ADMISSION_ENABLED', 'true')
    scopes = new AccountRequestScopes({ admitVerifiedToken: vi.fn(async () => account) })
    scopes.setControlAvailable(true)
    runtime.current.mockReturnValue({ scopes })
})
afterEach(() => vi.unstubAllEnvs())

const block = (): void => void scopes.invalidate({
    identityKey: account.identityKey,
    epoch: 2,
    state: 'blocked',
})

describe('authenticated request execution', () => {
    it('rejects forged payload identities and consumes each authentication binding once', async () => {
        const payload = {
            user: { userId: account.subject },
            decoded,
        }
        const handler = vi.fn(async () => {})
        await expect(AccountRequestContext.runPayload(payload, handler)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        AccountRequestContext.remember(payload, decoded)
        await AccountRequestContext.runPayload(payload, handler)
        expect(handler).toHaveBeenCalledOnce()
        await expect(AccountRequestContext.runPayload(payload, handler)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        expect(AccountRequestContext.current()).toBeUndefined()
    })

    it('resumes only the queued identity, epoch and organization after durable admission', async () => {
        const operation = vi.fn(async () => AccountRequestContext.workContext())
        await expect(AccountRequestContext.resumeWork(account, operation)).resolves.toEqual(account)

        for (const changed of [
            {
                ...account,
                identityKey: 'forged',
            },
            {
                ...account,
                epoch: 2,
            },
            {
                ...account,
                personalOrganizationId: 'another-organization',
            },
            {
                ...account,
                tokenExpiresAt: account.tokenExpiresAt + 1000,
            },
        ])
            await expect(AccountRequestContext.resumeWork(changed, operation)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')

        expect(operation).toHaveBeenCalledOnce()
        expect(() => AccountRequestContext.workContext()).toThrow('ACCOUNT_ADMISSION_DENIED')
        block()
        await expect(AccountRequestContext.resumeWork(account, operation)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
    })

    it('aborts the handler context and suppresses an uncooperative late response', async () => {
        const payload = {}
        AccountRequestContext.remember(payload, decoded)
        const entered = Promise.withResolvers<AccountRequestScope>()
        const dependency = Promise.withResolvers<void>()
        const publish = vi.fn()
        const running = AccountRequestContext.runPayload(payload, async assertActive => {
            entered.resolve(AccountRequestContext.current()!)
            await dependency.promise
            assertActive()
            publish('late output')
        })
        const denied = expect(running).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        const scope = await entered.promise
        block()
        await denied
        dependency.resolve()
        await Promise.resolve()
        expect(scope.signal.aborted).toBe(true)
        expect(publish).not.toHaveBeenCalled()
    })

    it('keeps detached child work indexed after its initiating handler finishes', async () => {
        const payload = {}
        AccountRequestContext.remember(payload, decoded)
        const entered = Promise.withResolvers<AccountRequestScope>()
        const provider = Promise.withResolvers<void>()
        let child: Promise<void> | undefined
        let parent: AccountRequestScope | undefined
        await AccountRequestContext.runPayload(payload, async () => {
            parent = AccountRequestContext.current()
            child = AccountRequestContext.detach(async () => {
                entered.resolve(AccountRequestContext.current()!)
                await provider.promise
            })
            await entered.promise
        })
        const scope = await entered.promise
        expect(parent?.signal.aborted).toBe(true)
        expect(scope.signal.aborted).toBe(false)
        const denied = expect(child).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        block()
        await denied
        expect(scope.signal.aborted).toBe(true)
        provider.resolve()
    })

    it('runs previously bound cleanup after revocation without reopening the cancelled request', async () => {
        const payload = {}
        AccountRequestContext.remember(payload, decoded)
        const entered = Promise.withResolvers<() => Promise<void>>()
        const finish = Promise.withResolvers<void>()
        const cleanup = vi.fn(async () => void expect(AccountRequestContext.current()).toBeUndefined())
        const running = AccountRequestContext.runPayload(payload, async () => {
            entered.resolve(AccountRequestContext.prepareCleanup(cleanup))
            await finish.promise
            expect(() => AccountRequestContext.prepareCleanup(cleanup)).toThrow('ACCOUNT_ADMISSION_DENIED')
            expect(() => AccountRequestContext.assertActive()).toThrow('ACCOUNT_ADMISSION_DENIED')
        })
        const boundCleanup = await entered.promise
        const denied = expect(running).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        block()
        await denied
        await boundCleanup()
        finish.resolve()
        await Promise.resolve()
        expect(cleanup).toHaveBeenCalledOnce()
    })

    it('destroys an active HTTP response and prevents late bytes after account disable', async () => {
        const req = new EventEmitter()
        const res = new TestResponse()
        const write = res.write
        const end = res.end
        const entered = Promise.withResolvers<AccountRequestScope>()
        const running = AccountRequestContext.runHttp(decoded, req as never, res as never, () => void entered.resolve(AccountRequestContext.current()!))
        const scope = await entered.promise
        block()
        await running
        expect(scope.signal.aborted).toBe(true)
        expect(res.destroy).toHaveBeenCalled()
        expect(() => res.write('late')).toThrow('ACCOUNT_ADMISSION_DENIED')
        expect(() => res.end('late')).toThrow('ACCOUNT_ADMISSION_DENIED')
        expect(write).not.toHaveBeenCalled()
        expect(end).not.toHaveBeenCalled()
        expect(req.listenerCount('aborted')).toBe(0)
    })

    it('releases HTTP scope after a completed response and on client abort', async () => {
        for (const event of ['finish', 'aborted']) {
            const req = new EventEmitter()
            const res = new TestResponse()
            let scope: AccountRequestScope | undefined
            await AccountRequestContext.runHttp(decoded, req as never, res as never, () => {
                scope = AccountRequestContext.current()

                if (event === 'finish')
                    res.emit('finish')
                else
                    req.emit('aborted')
            })
            expect(scope?.signal.aborted).toBe(true)
            expect(res.listenerCount('close')).toBe(0)
        }
    })
})
