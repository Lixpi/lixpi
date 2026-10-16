import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_ADMISSION_CHANGED_SUBJECT, ACCOUNT_WORK_ADMISSION_SUBJECT, getAccountIdentityKey, type AccountWorkContext } from '@lixpi/constants'
import { AccountWorkScope, AccountWorkScopes, AccountWorkStorage } from './account-work.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runProcess, withTempDir } from './file-conversion/transcoders/run-process.ts'

const account: AccountWorkContext = {
    issuer: 'https://auth.example.com/',
    subject: 'user',
    epoch: 1,
    identityKey: getAccountIdentityKey('https://auth.example.com/', 'user'),
    personalOrganizationId: 'org',
    tokenExpiresAt: Math.floor(Date.now() / 1000) * 1000 + 60000,
}

class Transport {
    callback?: (error: unknown, message: unknown) => void
    readonly statusUpdate = Promise.withResolvers<{ type: string }>()
    readonly request = vi.fn(async (subject, request) => ({
        version: 1,
        nonce: request.nonce,
        accountContext: request.accountContext,
        expiresAt: Date.now() + 30000,
    }))
    getConnection = () => ({
        subscribe: (subject, { callback }) => {
            expect(subject).toBe(ACCOUNT_ADMISSION_CHANGED_SUBJECT)
            this.callback = callback
        },
        status: () => this.status(),
    })
    onReconnect = vi.fn()

    async *status() {
        yield await this.statusUpdate.promise
    }

    change(identity = account.identityKey): void {
        this.callback?.(null, {
            data: new Uint8Array(),
            json: () => ({
                version: 1,
                identityKey: identity,
                epoch: 2,
                state: 'blocked',
            }),
        })
    }
}

const active: Array<{
    scopes: AccountWorkScopes
    transport: Transport
}> = []
const fixture = () => {
    const transport = new Transport()
    const scopes = new AccountWorkScopes(true)
    scopes.start(transport as never)
    const value = {
        scopes,
        transport,
    }
    active.push(value)

    return value
}
afterEach(() => {
    for (const f of active.splice(0)) {
        f.scopes.stop()
        f.transport.statusUpdate.resolve({ type: 'close' })
    }
})

describe('worker account execution', () => {
    it('checks policy on dequeue and completion and refuses missing context', async () => {
        const f = fixture()
        const operation = vi.fn(async assertActive => { assertActive()

        return 'result' })
        await expect(f.scopes.run({}, operation)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        expect(operation).not.toHaveBeenCalled()
        await expect(f.scopes.run({ accountContext: account }, operation)).resolves.toBe('result')
        expect(f.transport.request).toHaveBeenCalledTimes(2)
        expect(f.transport.request.mock.calls[0][0]).toBe(ACCOUNT_WORK_ADMISSION_SUBJECT)
    })

    it('cancels active work, prevents late storage and rejects an older queued epoch', async () => {
        const f = fixture()
        const entered = Promise.withResolvers<AbortSignal>()
        const dependency = Promise.withResolvers<void>()
        const finished = Promise.withResolvers<void>()
        const putObject = vi.fn()
        const storage = new AccountWorkStorage({
            getObject: vi.fn(),
            putObject,
        } as never)
        const running = f.scopes.run({ accountContext: account }, async () => {
            entered.resolve(AccountWorkScope.signal()!)
            await dependency.promise

            try {
                await expect(storage.putObject('bucket', 'late', new Uint8Array())).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
            } finally {
                finished.resolve()
            }
        })
        const signal = await entered.promise
        const denied = expect(running).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        f.transport.change('another-account')
        expect(signal.aborted).toBe(false)
        f.transport.change()
        await denied
        expect(signal.aborted).toBe(true)
        dependency.resolve()
        await finished.promise
        expect(putObject).not.toHaveBeenCalled()
        await expect(f.scopes.run({ accountContext: account }, vi.fn())).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
    })

    it('rejects an in-flight policy response that arrives after revocation', async () => {
        const f = fixture()
        const pending = Promise.withResolvers<any>()
        const entered = Promise.withResolvers<any>()
        f.transport.request.mockImplementationOnce(async (_subject, request) => { entered.resolve(request)

        return await pending.promise })
        const operation = vi.fn()
        const running = f.scopes.run({ accountContext: account }, operation)
        const request = await entered.promise
        const denied = expect(running).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        f.transport.change()
        await denied
        pending.resolve({
            version: 1,
            nonce: request.nonce,
            accountContext: account,
            expiresAt: Date.now() + 1000,
        })
        await Promise.resolve()
        expect(operation).not.toHaveBeenCalled()
    })

    it('cancels work when its control connection disappears', async () => {
        const f = fixture()
        const entered = Promise.withResolvers<void>()
        const running = f.scopes.run({ accountContext: account }, async () => {
            entered.resolve()
            await new Promise<void>(resolve => AccountWorkScope.signal()!.addEventListener('abort', () => resolve(), { once: true }))
        })
        await entered.promise
        const denied = expect(running).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        f.transport.statusUpdate.resolve({ type: 'disconnect' })
        await denied
    })

    it.each(['nonce', 'epoch', 'identity', 'expiry'])('rejects a policy reply with the wrong %s', async fault => {
        const f = fixture()
        f.transport.request.mockImplementationOnce(async (_subject, request) => ({
            version: 1,
            nonce: fault === 'nonce' ? 'wrong' : request.nonce,
            accountContext: {
                ...account,
                epoch: fault === 'epoch' ? 2 : 1,
                identityKey: fault === 'identity' ? 'other' : account.identityKey,
            },
            expiresAt: Date.now() + (fault === 'expiry' ? 60000 : 1000),
        }))
        const operation = vi.fn()
        await expect(f.scopes.run({ accountContext: account }, operation)).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        expect(operation).not.toHaveBeenCalled()
    })

    it('kills a real conversion child process when its account is revoked', async () => {
        const f = fixture()
        await withTempDir('revoked-child-', async directory => {
            const pidFile = join(directory, 'child.pid')
            let pid: number | undefined
            const running = f.scopes.run({ accountContext: account }, async () =>
                await runProcess(process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)', pidFile]))
            const denied = expect(running).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')

            try {
                await vi.waitFor(async () => { pid = Number(await readFile(pidFile, 'utf8')); expect(pid).toBeGreaterThan(0) })
                f.transport.change()
                await denied
                await vi.waitFor(() => expect(() => process.kill(pid!, 0)).toThrow())
            } finally {
                f.scopes.stop()

                if (pid) {
                    try { process.kill(pid, 'SIGKILL') } catch {}
                }
            }
        })
    })
})
