import { afterEach, describe, expect, it, vi } from 'vitest'
import DynamoDBService from '@lixpi/dynamodb-service'
import { AccountDatabaseService } from './account-database-service.ts'
import { AccountRequestContext } from './account-request-context.ts'
import { AccountRequestScope } from './account-request-scopes.ts'
import { updateAccountItem } from './account-model-update.ts'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const fixture = (reconciliationTables: ReadonlySet<string> = new Set()) => {
    const scope = new AccountRequestScope({
        identityKey: 'verified',
        issuer: 'issuer/',
        subject: 'subject',
        epoch: 7,
        personalOrganizationId: 'organization',
        tokenExpiresAt: Date.now() + 60_000,
    }, () => true)
    vi.spyOn(AccountRequestContext, 'current').mockReturnValue(scope)
    const write = vi.spyOn(DynamoDBService.prototype, 'transactWrite').mockResolvedValue({ $metadata: {} })
    const service = new AccountDatabaseService({
        region: 'us-east-1',
        endpoint: 'http://dynamodb.invalid',
    }, 'admission', {
        grants: 'principalId',
        memberships: 'userId',
    }, reconciliationTables)

    return {
        scope,
        write,
        service,
    }
}

describe('API database admission fence', () => {
    it('blocks resource reads and fences every writer while a large aggregate is being reconciled', async () => {
        const f = fixture(new Set(['assets']))
        const get = vi.spyOn(DynamoDBService.prototype, 'getItem').mockResolvedValue({
            assetId: 'asset',
            accountReconciliationOperation: 'link-operation',
        })
        await expect(f.service.getItem({
            tableName: 'assets',
            key: { assetId: 'asset' },
        })).rejects.toThrow('ACCOUNT_RESOURCE_RECONCILING')
        expect(get).toHaveBeenCalledOnce()
        const mutation = {
            type: 'update' as const,
            tableName: 'assets',
            key: { assetId: 'asset' },
            updates: { title: 'changed' },
            conditionExpression: '#accountReconciliation = :revision',
            expressionAttributeNames: { '#accountReconciliation': 'revision' },
            expressionAttributeValues: { ':revision': 2 },
        }
        await f.service.transactWrite({ operations: [mutation] })
        expect(f.write.mock.calls[0][0].operations[1]).toMatchObject({
            conditionExpression: '(#accountReconciliation = :revision) AND attribute_not_exists(#accountReconciliation_)',
            expressionAttributeNames: {
                '#accountReconciliation': 'revision',
                '#accountReconciliation_': 'accountReconciliationOperation',
            },
        })
        vi.spyOn(AccountRequestContext, 'current').mockReturnValue(undefined)
        await f.service.transactWrite({ operations: [mutation] })
        expect(f.write.mock.calls[1][0].operations[0]).toMatchObject({
            conditionExpression: '(#accountReconciliation = :revision) AND attribute_not_exists(#accountReconciliation_)',
        })
        const update = vi.spyOn(DynamoDBService.prototype, 'updateItem').mockResolvedValue(undefined)
        await f.service.updateItem({
            tableName: 'assets',
            key: { assetId: 'asset' },
            updates: { title: 'changed' },
        })
        expect(update.mock.calls[0][0]).toMatchObject({ conditionExpression: 'attribute_not_exists(#accountReconciliation)' })
        await expect(f.service.putItem({
            tableName: 'assets',
            item: { assetId: 'asset' },
        })).rejects.toThrow('ACCOUNT_RESOURCE_TRANSACTION_REQUIRED')
        await expect(f.service.deleteItems({
            tableName: 'assets',
            key: { assetId: 'asset' },
        })).rejects.toThrow('ACCOUNT_RESOURCE_TRANSACTION_REQUIRED')
        await expect(f.service.batchWriteItems({
            tableName: 'assets',
            items: [],
        })).rejects.toThrow('ACCOUNT_RESOURCE_TRANSACTION_REQUIRED')
        f.scope.cancel()
    })

    it('includes target users in the grant transaction and deduplicates the requester', async () => {
        const f = fixture()
        await f.service.transactWrite({ operations: [
            {
                type: 'put',
                tableName: 'grants',
                item: {
                    principalId: 'recipient',
                    resourceId: 'one',
                },
            },
            {
                type: 'put',
                tableName: 'grants',
                item: {
                    principalId: 'recipient',
                    resourceId: 'two',
                },
            },
            {
                type: 'put',
                tableName: 'memberships',
                item: {
                    userId: 'subject',
                    organizationId: 'organization',
                },
            },
        ] })
        const checks = f.write.mock.calls[0][0].operations.filter(operation => operation.type === 'check')
        expect(checks).toHaveLength(2)
        expect(checks[1]).toMatchObject({
            tableName: 'admission',
            expressionAttributeValues: {
                ':subject': 'recipient',
                ':active': 'active',
                ':issuer': 'issuer/',
            },
        })
        f.write.mockClear()
        await expect(f.service.transactWrite({ operations: [{
            type: 'put',
            tableName: 'grants',
            item: { resourceId: 'one' },
        }] })).rejects.toThrow('ACCOUNT_TARGET_REQUIRED')
        expect(f.write).not.toHaveBeenCalled()
        f.scope.cancel()
    })

    it('fences a model transaction without dropping its resource conditions or caller cancellation', async () => {
        const f = fixture()
        const caller = new AbortController()
        const mutation = {
            type: 'update' as const,
            tableName: 'workspaces',
            key: { workspaceId: 'workspace' },
            updates: { name: 'renamed' },
            conditionExpression: '#revision = :expected',
            expressionAttributeNames: { '#revision': 'revision' },
            expressionAttributeValues: { ':expected': 2 },
        }
        await f.service.transactWrite({
            operations: [mutation],
            abortSignal: caller.signal,
            origin: 'workspace',
        })
        const request = f.write.mock.calls[0][0]
        expect(request.operations[1]).toEqual(mutation)
        expect(request.operations[0]).toMatchObject({
            type: 'check',
            tableName: 'admission',
            key: { identityKey: 'verified' },
            expressionAttributeValues: {
                ':epoch': 7,
                ':active': 'active',
            },
        })
        caller.abort()
        expect(request.abortSignal?.aborted).toBe(true)
        f.scope.cancel()
    })

    it('never retries a failed admission fence as an ordinary write', async () => {
        const f = fixture()
        const update = vi.spyOn(DynamoDBService.prototype, 'updateItem')
        f.write.mockRejectedValue(new Error('TransactionCanceledException'))
        vi.stubGlobal('dynamoDBService', f.service)
        await expect(updateAccountItem({
            tableName: 'assets',
            key: { assetId: 'asset' },
            updates: { lease: 'changed' },
        })).rejects.toThrow('TransactionCanceledException')
        expect(f.write).toHaveBeenCalledOnce()
        expect(update).not.toHaveBeenCalled()
        f.scope.cancel()
    })

    it('refuses unfenced mutation entry points inside user execution', async () => {
        const f = fixture()
        await expect(f.service.putItem({
            tableName: 'users',
            item: { userId: 'other' },
        })).rejects.toThrow('ACCOUNT_SCOPED_TRANSACTION_REQUIRED')
        await expect(f.service.updateItem({
            tableName: 'assets',
            key: { assetId: 'asset' },
            updates: { name: 'other' },
        })).rejects.toThrow('ACCOUNT_SCOPED_TRANSACTION_REQUIRED')
        await expect(f.service.deleteItems({
            tableName: 'assets',
            key: { assetId: 'asset' },
        })).rejects.toThrow('ACCOUNT_SCOPED_TRANSACTION_REQUIRED')
        expect(f.write).not.toHaveBeenCalled()
        f.scope.cancel()
    })

    it('allows internal housekeeping through the original transaction path', async () => {
        const f = fixture()
        vi.spyOn(AccountRequestContext, 'current').mockReturnValue(undefined)
        const request = { operations: [{
            type: 'delete' as const,
            tableName: 'leases',
            key: { id: 'expired' },
        }] }
        await f.service.transactWrite(request)
        expect(f.write).toHaveBeenCalledWith(request)
        f.scope.cancel()
    })
})
