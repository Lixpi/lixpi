import { describe, expect, it, vi } from 'vitest'
import { CreateTableCommand, DescribeTableCommand, DescribeTimeToLiveCommand, UpdateTimeToLiveCommand } from '@aws-sdk/client-dynamodb'
import { LocalDynamoDbTableReconciler, type TableDefinition } from './local-dynamodb-table-reconciler.ts'

vi.mock('@lixpi/debug-tools', () => ({
    log: vi.fn(),
    err: vi.fn(),
}))
const table: TableDefinition = {
    name: 'Agent-Conversations-Test-Local',
    attributes: [{
        name: 'pk',
        type: 'S',
    }, {
        name: 'sk',
        type: 'S',
    }],
    hashKey: 'pk',
    rangeKey: 'sk',
    ttl: {
        attributeName: 'expiresAt',
        enabled: true,
    },
}

describe('local DynamoDB TTL reconciliation', () => {
    it('enables execution-state expiry on an existing preserved table without recreating data', async () => {
        const send = vi.fn(async command => command instanceof DescribeTableCommand ? { Table: { ItemCount: 100 } } : command instanceof DescribeTimeToLiveCommand ? { TimeToLiveDescription: { TimeToLiveStatus: 'DISABLED' } } : {})
        await new LocalDynamoDbTableReconciler({ send } as never, false).ensureTable(table)
        expect(send.mock.calls.some(([command]) => command instanceof CreateTableCommand)).toBe(false)
        expect(send.mock.calls.find(([command]) => command instanceof UpdateTimeToLiveCommand)?.[0].input).toEqual({
            TableName: table.name,
            TimeToLiveSpecification: {
                AttributeName: 'expiresAt',
                Enabled: true,
            },
        })
    })

    it('enables expiry after creating a missing table and leaves matching TTL untouched', async () => {
        const send = vi.fn(async command => {
            if (command instanceof DescribeTableCommand) {
                const error = new Error('missing')
                error.name = 'ResourceNotFoundException'

                throw error
            }

            if (command instanceof DescribeTimeToLiveCommand)
                return { TimeToLiveDescription: { TimeToLiveStatus: 'DISABLED' } }

            return {}
        })
        await new LocalDynamoDbTableReconciler({ send } as never, false).ensureTable(table)
        expect(send.mock.calls.some(([command]) => command instanceof CreateTableCommand)).toBe(true)
        expect(send.mock.calls.some(([command]) => command instanceof UpdateTimeToLiveCommand)).toBe(true)
        send.mockClear()
        send.mockImplementation(async command => command instanceof DescribeTableCommand ? { Table: {} } : { TimeToLiveDescription: {
            TimeToLiveStatus: 'ENABLING',
            AttributeName: 'expiresAt',
        } })
        await new LocalDynamoDbTableReconciler({ send } as never, false).ensureTable(table)
        expect(send.mock.calls.some(([command]) => command instanceof UpdateTimeToLiveCommand)).toBe(false)
    })

    it('propagates expiry setup failure instead of reporting successful initialization', async () => {
        const send = vi.fn(async command => {
            if (command instanceof DescribeTableCommand)
                return { Table: {} }

            throw new Error('TTL_UNAVAILABLE')
        })
        await expect(new LocalDynamoDbTableReconciler({ send } as never, false).ensureTable(table)).rejects.toThrow('TTL_UNAVAILABLE')
    })
})
