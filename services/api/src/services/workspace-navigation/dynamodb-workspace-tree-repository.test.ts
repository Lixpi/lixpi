import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import { DynamoDbWorkspaceTreeRepository } from './dynamodb-workspace-tree-repository.ts'
import { WorkspaceTreeConflict } from './workspace-tree-repository.ts'

const tables = {
    workspaces: 'Workspaces',
    workspacesMeta: 'Workspaces-Meta',
    workspacesAccessList: 'Workspaces-Access-List',
    workspaceTree: 'Workspace-Tree',
    workspaceTreeLocks: 'Workspace-Tree-Locks',
}

// A transaction cancelled by a failed per-item condition.
class TransactionCanceledError extends Error {
    readonly CancellationReasons = [{ Code: 'ConditionalCheckFailed' }]

    constructor() {
        super('cancelled')
        this.name = 'TransactionCanceledException'
    }
}

const cancelled = (): Error => new TransactionCanceledError()

// =============================================================================
// COMMIT
// =============================================================================

describe('DynamoDbWorkspaceTreeRepository.commit', () => {
    it('guards a lock-free commit on the organization holding no lock', async () => {
        const transactWrite = vi.fn(async () => undefined)
        await new DynamoDbWorkspaceTreeRepository({ transactWrite } as never, tables).commit({
            organizationId: 'org-1',
            changes: [{
                type: 'deleteTreeRow',
                key: {
                    pk: 'ORG#org-1#PARENT#ROOT',
                    sk: 'V#ws-1',
                },
            }],
        })

        const { operations } = transactWrite.mock.calls[0][0]
        expect(operations[0]).toEqual({
            type: 'check',
            tableName: 'Workspace-Tree-Locks',
            key: { organizationId: 'org-1' },
            conditionExpression: 'attribute_not_exists(#organizationId)',
            expressionAttributeNames: { '#organizationId': 'organizationId' },
        })
        expect(operations[1]).toMatchObject({
            type: 'delete',
            tableName: 'Workspace-Tree',
        })
    })

    it('deletes a tree row by pk and sk alone when given the whole row', async () => {
        const transactWrite = vi.fn(async () => undefined)
        await new DynamoDbWorkspaceTreeRepository({ transactWrite } as never, tables).commit({
            organizationId: 'org-1',
            changes: [{
                type: 'deleteTreeRow',
                key: {
                    pk: 'ORG#org-1#PARENT#ROOT',
                    sk: 'b#h-1',
                    entryType: 'heading',
                    entryId: 'h-1',
                    organizationId: 'org-1',
                    position: 'b',
                    name: '',
                    level: 0,
                } as never,
            }],
        })

        const { operations } = transactWrite.mock.calls[0][0]
        expect(operations[1].key).toEqual({
            pk: 'ORG#org-1#PARENT#ROOT',
            sk: 'b#h-1',
        })
    })

    it('guards a locked commit on the holder and patches both workspace rows', async () => {
        const transactWrite = vi.fn(async () => undefined)
        await new DynamoDbWorkspaceTreeRepository({ transactWrite } as never, tables).commit({
            organizationId: 'org-1',
            lockOperationId: 'op-1',
            changes: [{
                type: 'patchWorkspace',
                workspaceId: 'ws-1',
                patch: {
                    ancestorIds: ['root'],
                    parentWorkspaceId: null,
                    deletingAt: 9,
                    updatedAt: 10,
                },
                expect: {
                    ancestorIds: [],
                    notDeleting: true,
                },
            }],
        })

        const [guard, full, meta] = transactWrite.mock.calls[0][0].operations
        expect(guard.conditionExpression).toBe('#operationId = :operationId')
        expect(full).toMatchObject({
            tableName: 'Workspaces',
            updateExpression: 'SET #ancestorIds = :ancestorIds, #deletingAt = if_not_exists(#deletingAt, :deletingAt), #updatedAt = :updatedAt REMOVE #parentWorkspaceId',
            conditionExpression: 'attribute_exists(#workspaceId)',
        })
        expect(meta).toMatchObject({
            tableName: 'Workspaces-Meta',
            conditionExpression: 'attribute_exists(#workspaceId) AND attribute_not_exists(#expectDeletingAt) AND #expectAncestorIds = :expectAncestorIds',
            expressionAttributeValues: expect.objectContaining({ ':expectAncestorIds': [] }),
        })
    })

    it('reports a failed condition as a conflict and passes other failures through', async () => {
        const conflicting = new DynamoDbWorkspaceTreeRepository({ transactWrite: vi.fn(async () => { throw cancelled() }) } as never, tables)
        await expect(conflicting.commit({
            organizationId: 'org-1',
            changes: [],
        })).rejects.toBeInstanceOf(WorkspaceTreeConflict)

        const broken = new DynamoDbWorkspaceTreeRepository({ transactWrite: vi.fn(async () => { throw new Error('NETWORK') }) } as never, tables)
        await expect(broken.commit({
            organizationId: 'org-1',
            changes: [],
        })).rejects.toThrow('NETWORK')
    })

    it('creates the full row, meta row and owner grant together', async () => {
        const transactWrite = vi.fn(async () => undefined)
        await new DynamoDbWorkspaceTreeRepository({ transactWrite } as never, tables).commit({
            organizationId: 'org-1',
            changes: [{
                type: 'createWorkspace',
                workspace: {
                    workspaceId: 'ws-1',
                    organizationId: 'org-1',
                    name: 'New',
                    tagIds: [],
                    ancestorIds: [],
                    position: 'V',
                    createdAt: 1,
                    updatedAt: 1,
                    canvasState: { nodes: [] },
                },
                grant: {
                    userId: 'user-1',
                    workspaceId: 'ws-1',
                    accessLevel: 'owner',
                },
            }],
        })

        const [, full, meta, grant] = transactWrite.mock.calls[0][0].operations
        expect(full.item).toHaveProperty('canvasState')
        expect(meta.item).not.toHaveProperty('canvasState')
        expect(meta.item).toMatchObject({
            position: 'V',
            ancestorIds: [],
        })
        expect(grant).toMatchObject({
            tableName: 'Workspaces-Access-List',
            item: { accessLevel: 'owner' },
        })
    })
})

// =============================================================================
// LOCKS
// =============================================================================

describe('DynamoDbWorkspaceTreeRepository locks', () => {
    const lock = {
        organizationId: 'org-1',
        operationId: 'op-1',
        operation: 'move' as const,
        entryId: 'ws-1',
        userId: 'user-1',
        phase: 'start',
        parameters: {},
        acquiredAt: 1,
        expiresAt: 31,
    }

    it('acquires only when no lock exists and reports a held lock as false', async () => {
        const transactWrite = vi.fn(async () => undefined)
        const repository = new DynamoDbWorkspaceTreeRepository({ transactWrite } as never, tables)

        expect(await repository.acquireLock(lock)).toBe(true)
        expect(transactWrite.mock.calls[0][0].operations[0]).toMatchObject({
            type: 'put',
            conditionExpression: 'attribute_not_exists(#organizationId)',
        })

        transactWrite.mockRejectedValueOnce(cancelled())
        expect(await repository.acquireLock(lock)).toBe(false)
    })

    it('takes over an expired lock only while it matches what was read', async () => {
        const transactWrite = vi.fn(async () => undefined)
        await new DynamoDbWorkspaceTreeRepository({ transactWrite } as never, tables).takeOverLock(lock, {
            operationId: 'op-2',
            acquiredAt: 50,
            expiresAt: 80,
        })

        expect(transactWrite.mock.calls[0][0].operations[0]).toMatchObject({
            conditionExpression: '#operationId = :operationId AND #expiresAt = :expiresAt',
            expressionAttributeValues: {
                ':operationId': 'op-1',
                ':expiresAt': 31,
                ':nextOperationId': 'op-2',
            },
        })
    })
})

describe('DynamoDbWorkspaceTreeRepository navigation revisions', () => {
    it('stores documents larger than one DynamoDB item as ordered immutable chunks', async () => {
        const rows: Record<string, unknown>[] = []
        const transactWrite = vi.fn(async ({ operations }) => {
            for (const operation of operations)
                rows.push(operation.item)
        })
        const queryItems = vi.fn(async () => ({ items: [...rows].reverse() }))
        const repository = new DynamoDbWorkspaceTreeRepository({
            transactWrite,
            queryItems,
        } as never, tables)
        const document = {
            type: 'doc',
            content: Array.from({ length: 400 }, (_, index) => ({
                type: 'paragraph',
                attrs: { entryId: `p-${index}` },
                content: [{
                    type: 'text',
                    text: '🦉'.repeat(1000),
                }],
            })),
        }
        await repository.putNavigationDocument('org', 'revision', document)
        expect(rows.length).toBeGreaterThan(16)
        expect(rows.every(row => new TextEncoder().encode(JSON.stringify(row)).length < 400_000)).toBe(true)
        expect(transactWrite.mock.calls.every(([request]) => request.operations.length <= 16)).toBe(true)
        expect(await repository.getNavigationDocument('org', 'revision')).toEqual(document)
        expect(queryItems).toHaveBeenCalledWith(expect.objectContaining({
            consistentRead: true,
            fetchAllItems: true,
        }))
        rows.splice(3, 1)
        await expect(repository.getNavigationDocument('org', 'revision')).rejects.toThrow('WORKSPACE_NAVIGATION_REVISION_MISSING')
    })

    it('publishes a head and mutation receipt under the operation lock in one transaction', async () => {
        const transactWrite = vi.fn(async () => undefined)
        const repository = new DynamoDbWorkspaceTreeRepository({ transactWrite } as never, tables)
        const head = {
            revision: 2,
            revisionId: 'revision-2',
            schemaVersion: 1 as const,
        }
        await repository.commit({
            organizationId: 'org',
            lockOperationId: 'operation',
            changes: [
                {
                    type: 'putNavigationRecord',
                    key: 'HEAD',
                    value: head,
                },
                {
                    type: 'putNavigationRecord',
                    key: 'MUTATION#request',
                    value: {
                        ...head,
                        userId: 'owner',
                        requestHash: 'digest',
                    },
                },
            ],
        })
        const operations = transactWrite.mock.calls[0][0].operations
        expect(operations[0]).toMatchObject({
            type: 'check',
            tableName: tables.workspaceTreeLocks,
        })
        expect(operations[1]).toMatchObject({
            type: 'put',
            item: {
                pk: 'ORG#org#NAVIGATION',
                sk: 'HEAD',
                revision: 2,
            },
        })
        expect(operations[2]).toMatchObject({
            type: 'put',
            item: {
                pk: 'ORG#org#NAVIGATION',
                sk: 'MUTATION#request',
                requestHash: 'digest',
            },
        })
    })
})


describe('DynamoDbWorkspaceTreeRepository consistent projection reads', () => {
    it('reads all workspace metadata transactionally so a published head cannot expose stale ancestry', async () => {
        const transactRead = vi.fn(async ({ items }) => items.map(item => ({
            workspaceId: item.key.workspaceId,
            ancestorIds: ['parent'],
        })))
        const repository = new DynamoDbWorkspaceTreeRepository({ transactRead } as never, tables)
        const ids = Array.from({ length: 105 }, (_, index) => `workspace-${index}`)
        const rows = await repository.getWorkspaceMetas([...ids, ids[0]])
        expect(rows).toHaveLength(105)
        expect(transactRead).toHaveBeenCalledTimes(2)
        expect(transactRead.mock.calls.map(([request]) => request.items.length)).toEqual([100, 5])
    })
})



// =============================================================================
// AUTOSAVE ADMISSION AND UNCHANGED ACKNOWLEDGEMENTS
// =============================================================================

describe('DynamoDB navigation autosave protection', () => {
    it('shares an atomic user bucket across independent repository instances', async () => {
        const rows = new Map<string, { nextAt: number }>()
        const getItem = vi.fn(async ({ key }) => structuredClone(rows.get(key.pk)))
        const transactWrite = vi.fn(async ({ operations }) => {
            const operation = operations[0]
            const previous = rows.get(operation.item.pk)
            const expected = operation.expressionAttributeValues?.[':previous']

            if (expected === undefined ? previous !== undefined : previous?.nextAt !== expected)
                throw cancelled()

            rows.set(operation.item.pk, { nextAt: operation.item.nextAt })
        })
        const first = new DynamoDbWorkspaceTreeRepository({
            getItem,
            transactWrite,
        } as never, tables)
        const second = new DynamoDbWorkspaceTreeRepository({
            getItem,
            transactWrite,
        } as never, tables)
        const policy = {
            requestIntervalMs: 3000,
            requestBurst: 1,
        }
        const results = await Promise.all([
            first.admitNavigationWrite('user', 1000, policy),
            second.admitNavigationWrite('user', 1000, policy),
        ])

        expect(results.sort((left, right) => left - right)).toEqual([0, 3000])
        expect(await second.admitNavigationWrite('other-user', 1000, policy)).toBe(0)
        expect(await second.admitNavigationWrite('user', 4000, policy)).toBe(0)
        expect(rows.size).toBe(2)
        expect(getItem.mock.calls[0][0]).toMatchObject({
            tableName: 'Workspace-Tree',
            key: {
                pk: 'USER#user#NAVIGATION',
                sk: 'WRITE_ADMISSION',
            },
            consistentRead: true,
        })
        expect(transactWrite.mock.calls[0][0].operations[0]).toMatchObject({
            type: 'put',
            tableName: 'Workspace-Tree',
            conditionExpression: 'attribute_not_exists(#pk)',
        })
    })

    it('bounds conditional-contention retries and does not swallow database failures', async () => {
        const getItem = vi.fn(async () => undefined)
        const transactWrite = vi.fn(async () => { throw cancelled() })
        const repository = new DynamoDbWorkspaceTreeRepository({
            getItem,
            transactWrite,
        } as never, tables)
        const policy = {
            requestIntervalMs: 3000,
            requestBurst: 6,
        }

        expect(await repository.admitNavigationWrite('user', 1000, policy)).toBe(3000)
        expect(getItem).toHaveBeenCalledTimes(3)
        expect(transactWrite).toHaveBeenCalledTimes(3)
        transactWrite.mockRejectedValueOnce(new Error('DATABASE_UNAVAILABLE'))
        await expect(repository.admitNavigationWrite('user', 1000, policy)).rejects.toThrow('DATABASE_UNAVAILABLE')
    })

    it('records an unchanged receipt only with the expected head, no lock and no existing receipt', async () => {
        const transactWrite = vi.fn(async () => undefined)
        const repository = new DynamoDbWorkspaceTreeRepository({ transactWrite } as never, tables)
        const receipt = {
            revision: 4,
            revisionId: 'revision-4',
            schemaVersion: 1 as const,
            userId: 'user',
            requestHash: 'hash',
        }

        expect(await repository.recordUnchangedNavigation('org', 'mutation', receipt)).toBe(true)
        const operations = transactWrite.mock.calls[0][0].operations
        expect(operations).toHaveLength(3)
        expect(operations[0]).toMatchObject({
            type: 'check',
            tableName: 'Workspace-Tree-Locks',
            conditionExpression: 'attribute_not_exists(#organizationId)',
        })
        expect(operations[1]).toMatchObject({
            type: 'check',
            key: {
                pk: 'ORG#org#NAVIGATION',
                sk: 'HEAD',
            },
            expressionAttributeValues: {
                ':revision': 4,
                ':revisionId': 'revision-4',
            },
        })
        expect(operations[2]).toMatchObject({
            type: 'put',
            item: {
                pk: 'ORG#org#NAVIGATION',
                sk: 'MUTATION#mutation',
                ...receipt,
            },
            conditionExpression: 'attribute_not_exists(#pk)',
        })
        transactWrite.mockRejectedValueOnce(cancelled())
        expect(await repository.recordUnchangedNavigation('org', 'mutation', receipt)).toBe(false)
    })
})
