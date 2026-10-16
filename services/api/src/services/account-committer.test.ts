import { describe, expect, it, vi } from 'vitest'
import { AccountCommitter } from './account-committer.ts'
import { AccountRequestScopes } from './account-request-scopes.ts'

const fixture = () => {
    const account = {
        identityKey: 'trusted-identity',
        issuer: 'https://issuer.example/',
        subject: 'auth0|subject',
        epoch: 7,
        personalOrganizationId: 'personal-org',
        tokenExpiresAt: Date.now() + 60_000,
    }
    const scopes = new AccountRequestScopes({ admitVerifiedToken: vi.fn(async () => account) })
    scopes.setControlAvailable(true)
    const write = vi.fn(async (_request: Parameters<ConstructorParameters<typeof AccountCommitter>[0]['transactWrite']>[0]) => 'committed')
    const committer = new AccountCommitter({ transactWrite: write }, 'admission')

    return {
        account,
        scopes,
        write,
        committer,
    }
}

describe('account-scoped database commits', () => {
    it('keeps resource conditions and the verified admission epoch in one transaction', async () => {
        const f = fixture()
        await f.scopes.run({}, async scope => f.committer.commit(scope, [{
            type: 'update',
            tableName: 'workspaces',
            key: { workspaceId: 'workspace' },
            updates: { name: 'renamed' },
            conditionExpression: '#owner = :owner',
            expressionAttributeNames: { '#owner': 'userId' },
            expressionAttributeValues: { ':owner': 'auth0|subject' },
        }], 'workspace.rename'))
        expect(f.write).toHaveBeenCalledOnce()
        const request = f.write.mock.calls[0][0]
        expect(request.operations).toHaveLength(2)
        expect(request.operations[0]).toMatchObject({
            type: 'check',
            tableName: 'admission',
            key: { identityKey: f.account.identityKey },
            expressionAttributeValues: {
                ':epoch': 7,
                ':subject': f.account.subject,
                ':active': 'active',
                ':false': false,
            },
        })
        expect(request.operations[1]).toMatchObject({ conditionExpression: '#owner = :owner' })
    })

    it('does not retry a failed admission fence as an unguarded write', async () => {
        const f = fixture()
        f.write.mockRejectedValueOnce(new Error('TransactionCanceledException'))
        await expect(f.scopes.run({}, async scope => f.committer.commit(scope, [{
            type: 'delete',
            tableName: 'workspaces',
            key: { workspaceId: 'workspace' },
        }], 'workspace.delete'))).rejects.toThrow('TransactionCanceledException')
        expect(f.write).toHaveBeenCalledOnce()
    })

    it('refuses a user mutation of admission itself', async () => {
        const f = fixture()
        await expect(f.scopes.run({}, async scope => f.committer.commit(scope, [{
            type: 'update',
            tableName: 'admission',
            key: { identityKey: f.account.identityKey },
            updates: { epoch: 8 },
        }], 'invalid'))).rejects.toThrow('Invalid account-scoped transaction')
        expect(f.write).not.toHaveBeenCalled()
    })

    it('cancels the write transport and discards its response after disable', async () => {
        const f = fixture()
        const started = Promise.withResolvers<void>()
        const late = Promise.withResolvers<string>()
        let signal: AbortSignal | undefined
        f.write.mockImplementationOnce(async request => {
            signal = request.abortSignal
            started.resolve()

            return await late.promise
        })
        const running = f.scopes.run({}, async scope => f.committer.commit(scope, [{
            type: 'put',
            tableName: 'workspaces',
            item: { workspaceId: 'workspace' },
        }], 'workspace.create'))
        const rejected = expect(running).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        await started.promise
        f.scopes.invalidate({
            identityKey: f.account.identityKey,
            epoch: 8,
            state: 'blocked',
        })
        await rejected
        expect(signal?.aborted).toBe(true)
        late.resolve('late commit acknowledgement')
        expect(f.write).toHaveBeenCalledOnce()
    })
})
