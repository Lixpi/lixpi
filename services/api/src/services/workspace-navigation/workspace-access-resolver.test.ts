import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    type WorkspaceMeta,
} from '@lixpi/constants'

import { DynamoDbWorkspaceTreeRepository } from './dynamodb-workspace-tree-repository.ts'
import { InMemoryWorkspaceTreeRepository } from './in-memory-workspace-tree-repository.ts'
import {
    workspaceTreeEntrySortKey,
    workspaceTreePartitionKey,
} from './table-keys.ts'
import { WorkspaceAccessResolver } from './workspace-access-resolver.ts'

const meta = (
    workspaceId: string,
    ancestorIds: string[],
    overrides: Partial<WorkspaceMeta> = {},
): WorkspaceMeta => ({
    workspaceId,
    organizationId: 'org-1',
    name: workspaceId,
    tagIds: [],
    ancestorIds,
    ...(ancestorIds.length ? { parentWorkspaceId: ancestorIds.at(-1) } : {}),
    position: 'V',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
})

// root > parent > child, plus a sibling root.
const seedTree = (repository: InMemoryWorkspaceTreeRepository): void => {
    const metas = [
        meta('root', []),
        meta('parent', ['root']),
        meta('child', ['root', 'parent']),
        meta('other-root', []),
    ]

    for (const item of metas) {
        repository.putMeta(item)
        repository.putTreeRow({
            pk: workspaceTreePartitionKey('org-1', item.parentWorkspaceId),
            sk: workspaceTreeEntrySortKey(item.position, item.workspaceId),
            entryType: 'workspace',
            entryId: item.workspaceId,
            organizationId: 'org-1',
            ...(item.parentWorkspaceId ? { parentWorkspaceId: item.parentWorkspaceId } : {}),
            position: item.position,
            createdAt: 1,
            updatedAt: 1,
        })
    }
}

let repository: InMemoryWorkspaceTreeRepository
let resolver: WorkspaceAccessResolver

beforeEach(() => {
    repository = new InMemoryWorkspaceTreeRepository()
    seedTree(repository)
    resolver = new WorkspaceAccessResolver(repository)
})

// =============================================================================
// RESOLVE
// =============================================================================

describe('WorkspaceAccessResolver.resolve', () => {
    it('grants through a direct grant', async () => {
        repository.putGrant({
            userId: 'user-1',
            workspaceId: 'child',
            accessLevel: 'editor',
        })

        expect(await resolver.resolve({
            userId: 'user-1',
            workspaceId: 'child',
        })).toMatchObject({
            status: 'granted',
            grant: {
                grantWorkspaceId: 'child',
                accessLevel: 'editor',
                ancestorIds: ['root', 'parent'],
            },
        })
    })

    it('grants through an inherited grant and a higher child grant', async () => {
        repository.putGrant({
            userId: 'user-1',
            workspaceId: 'root',
            accessLevel: 'viewer',
        })

        expect(await resolver.resolve({
            userId: 'user-1',
            workspaceId: 'child',
        })).toMatchObject({
            status: 'granted',
            grant: {
                grantWorkspaceId: 'root',
                accessLevel: 'viewer',
            },
        })

        repository.putGrant({
            userId: 'user-1',
            workspaceId: 'parent',
            accessLevel: 'owner',
        })

        expect(await resolver.resolve({
            userId: 'user-1',
            workspaceId: 'child',
        })).toMatchObject({
            grant: {
                grantWorkspaceId: 'parent',
                accessLevel: 'owner',
            },
        })
    })

    it('denies without a grant on the chain and never reaches up to a parent', async () => {
        repository.putGrant({
            userId: 'user-1',
            workspaceId: 'child',
            accessLevel: 'owner',
        })

        expect(await resolver.resolve({
            userId: 'user-1',
            workspaceId: 'parent',
        })).toEqual({ status: 'denied' })
        expect(await resolver.resolve({
            userId: 'user-2',
            workspaceId: 'child',
        })).toEqual({ status: 'denied' })
    })

    it('reports a missing workspace and a deleting ancestor', async () => {
        repository.putGrant({
            userId: 'user-1',
            workspaceId: 'root',
            accessLevel: 'owner',
        })

        expect(await resolver.resolve({
            userId: 'user-1',
            workspaceId: 'missing',
        })).toEqual({ status: 'not-found' })

        repository.putMeta(meta('parent', ['root'], { deletingAt: 5 }))

        expect(await resolver.resolve({
            userId: 'user-1',
            workspaceId: 'child',
        })).toMatchObject({ status: 'deleting' })
    })

    it('rereads the chain when the workspace moved between reads', async () => {
        repository.putGrant({
            userId: 'user-1',
            workspaceId: 'other-root',
            accessLevel: 'editor',
        })
        const readAccessChain = repository.readAccessChain
        let calls = 0
        repository.readAccessChain = async (userId, workspaceIds, organizationId) => {
            calls += 1

            // The first chain read sees the workspace already moved under
            // other-root, while the meta read still saw the old parent.
            if (calls === 1)
                repository.putMeta(meta('child', ['other-root']))

            return await readAccessChain(userId, workspaceIds, organizationId)
        }

        expect(await resolver.resolve({
            userId: 'user-1',
            workspaceId: 'child',
        })).toMatchObject({
            status: 'granted',
            grant: {
                grantWorkspaceId: 'other-root',
                ancestorIds: ['other-root'],
            },
        })
        expect(calls).toBe(2)
    })

    it('fences the decision with the organization lock in the same chain read, without separate fence reads', async () => {
        repository.putGrant({
            userId: 'user-1',
            workspaceId: 'root',
            accessLevel: 'viewer',
        })
        const readAccessChain = vi.spyOn(repository, 'readAccessChain')
        const readNavigationFences = vi.spyOn(repository, 'readNavigationFences')
        const getLock = vi.spyOn(repository, 'getLock')

        expect(await resolver.resolve({
            userId: 'user-1',
            workspaceId: 'child',
        })).toMatchObject({ status: 'granted' })
        expect(readAccessChain).toHaveBeenCalledExactlyOnceWith('user-1', ['root', 'parent', 'child'], 'org-1')
        expect(readNavigationFences).not.toHaveBeenCalled()
        expect(getLock).not.toHaveBeenCalled()
    })

    it('reports a held organization lock as busy, except for a workspace already being deleted', async () => {
        repository.putGrant({
            userId: 'user-1',
            workspaceId: 'root',
            accessLevel: 'owner',
        })
        await repository.acquireLock({
            organizationId: 'org-1',
            operationId: 'operation-1',
            operation: 'saveNavigation',
            entryId: 'operation-1',
            userId: 'user-1',
            phase: 'start',
            parameters: {},
            acquiredAt: 1,
            expiresAt: 5000,
        })

        await expect(resolver.resolve({
            userId: 'user-1',
            workspaceId: 'child',
        })).rejects.toMatchObject({ code: 'WORKSPACE_TREE_BUSY' })

        repository.putMeta(meta('parent', ['root'], { deletingAt: 5 }))

        expect(await resolver.resolve({
            userId: 'user-1',
            workspaceId: 'child',
        })).toMatchObject({
            status: 'deleting',
            deletingAt: 5,
        })
    })
})

// =============================================================================
// ACCESSIBLE WORKSPACES AND EVENT AUDIENCE
// =============================================================================

describe('WorkspaceAccessResolver listings', () => {
    it('lists granted workspaces with their subtrees and inherited levels', async () => {
        repository.putGrant({
            userId: 'user-1',
            workspaceId: 'root',
            accessLevel: 'viewer',
        })
        repository.putGrant({
            userId: 'user-1',
            workspaceId: 'parent',
            accessLevel: 'editor',
        })

        const accessible = await resolver.listAccessibleWorkspaces('user-1')
        const levels = Object.fromEntries(accessible.map(entry => [entry.workspace.workspaceId, entry.accessLevel]))

        expect(levels).toEqual({
            root: 'viewer',
            parent: 'editor',
            child: 'editor',
        })
    })

    it('treats a granted child as an entry point and leaves out deleting subtrees', async () => {
        repository.putGrant({
            userId: 'user-1',
            workspaceId: 'parent',
            accessLevel: 'owner',
        })
        repository.putGrant({
            userId: 'user-1',
            workspaceId: 'other-root',
            accessLevel: 'owner',
        })

        expect((await resolver.listAccessibleWorkspaces('user-1')).map(entry => entry.workspace.workspaceId).sort()).toEqual(['child', 'other-root', 'parent'])

        repository.putMeta(meta('parent', ['root'], { deletingAt: 9 }))

        expect((await resolver.listAccessibleWorkspaces('user-1')).map(entry => entry.workspace.workspaceId)).toEqual(['other-root'])
    })

    it('lists every user with a grant on the workspace or an ancestor', async () => {
        repository.putGrant({
            userId: 'ancestor-only',
            workspaceId: 'root',
            accessLevel: 'viewer',
        })
        repository.putGrant({
            userId: 'direct',
            workspaceId: 'child',
            accessLevel: 'editor',
        })
        repository.putGrant({
            userId: 'elsewhere',
            workspaceId: 'other-root',
            accessLevel: 'owner',
        })

        expect((await resolver.listUsersWithAccess(meta('child', ['root', 'parent']))).sort()).toEqual(['ancestor-only', 'direct'])
    })

    it('fences a later listing on the organizations it last spanned, and rereads when the forest reaches a new one', async () => {
        const userId = 'remembered-organizations-user'
        repository.putGrant({
            userId,
            workspaceId: 'root',
            accessLevel: 'viewer',
        })
        const listUserGrants = vi.spyOn(repository, 'listUserGrants')
        const readNavigationFences = vi.spyOn(repository, 'readNavigationFences')

        await resolver.listAccessibleWorkspaces(userId)
        expect(listUserGrants).toHaveBeenCalledTimes(2)

        listUserGrants.mockClear()
        readNavigationFences.mockClear()
        await resolver.listAccessibleWorkspaces(userId)
        expect(listUserGrants).toHaveBeenCalledTimes(1)
        expect(readNavigationFences.mock.calls.map(([ids]) => ids)).toEqual([['org-1'], ['org-1']])

        repository.putMeta(meta('elsewhere', [], { organizationId: 'org-2' }))
        repository.putGrant({
            userId,
            workspaceId: 'elsewhere',
            accessLevel: 'owner',
        })
        readNavigationFences.mockClear()

        expect((await resolver.listAccessibleWorkspaces(userId)).map(entry => entry.workspace.workspaceId).sort()).toEqual(['child', 'elsewhere', 'parent', 'root'])
        expect(readNavigationFences.mock.calls.at(-1)?.[0].sort()).toEqual(['org-1', 'org-2'])
    })
})

// =============================================================================
// DYNAMODB REPOSITORY
// =============================================================================

describe('DynamoDbWorkspaceTreeRepository', () => {
    const tables = {
        workspaces: 'Workspaces',
        workspacesMeta: 'Workspaces-Meta',
        workspacesAccessList: 'Workspaces-Access-List',
        workspaceTree: 'Workspace-Tree',
        workspaceTreeLocks: 'Workspace-Tree-Locks',
    }

    it('reads an ancestor chain in one consistent transaction and keeps each row with its table', async () => {
        const transactRead = vi.fn(async () => [
            meta('root', []),
            undefined,
            meta('child', ['root']),
            {
                userId: 'user-1',
                workspaceId: 'child',
                accessLevel: 'editor',
            },
        ])
        const dynamo = new DynamoDbWorkspaceTreeRepository({ transactRead } as never, tables)

        const chain = await dynamo.readAccessChain('user-1', ['root', 'child'])

        expect(transactRead).toHaveBeenCalledWith({ items: [
            {
                tableName: 'Workspaces-Meta',
                key: { workspaceId: 'root' },
            },
            {
                tableName: 'Workspaces-Access-List',
                key: {
                    userId: 'user-1',
                    workspaceId: 'root',
                },
            },
            {
                tableName: 'Workspaces-Meta',
                key: { workspaceId: 'child' },
            },
            {
                tableName: 'Workspaces-Access-List',
                key: {
                    userId: 'user-1',
                    workspaceId: 'child',
                },
            },
        ] })
        expect([...chain.metas.keys()]).toEqual(['root', 'child'])
        expect(chain.grants).toEqual([{
            userId: 'user-1',
            workspaceId: 'child',
            accessLevel: 'editor',
        }])
    })

    it('reads the organization lock in the same transaction as a fenced chain', async () => {
        const transactRead = vi.fn(async () => [
            { organizationId: 'org-1' },
            meta('child', []),
            undefined,
        ])
        const dynamo = new DynamoDbWorkspaceTreeRepository({ transactRead } as never, tables)

        const chain = await dynamo.readAccessChain('user-1', ['child'], 'org-1')

        expect(transactRead).toHaveBeenCalledExactlyOnceWith({ items: [
            {
                tableName: 'Workspace-Tree-Locks',
                key: { organizationId: 'org-1' },
            },
            {
                tableName: 'Workspaces-Meta',
                key: { workspaceId: 'child' },
            },
            {
                tableName: 'Workspaces-Access-List',
                key: {
                    userId: 'user-1',
                    workspaceId: 'child',
                },
            },
        ] })
        expect(chain.locked).toBe(true)
        expect([...chain.metas.keys()]).toEqual(['child'])
    })

    it('reads each organization lock and navigation head together', async () => {
        const transactRead = vi.fn(async () => [
            undefined,
            {
                revision: 3,
                revisionId: 'revision-1',
                schemaVersion: 1,
            },
            { organizationId: 'org-2' },
            undefined,
        ])
        const dynamo = new DynamoDbWorkspaceTreeRepository({ transactRead } as never, tables)

        const fences = await dynamo.readNavigationFences(['org-1', 'org-2', 'org-1'])

        expect(transactRead).toHaveBeenCalledExactlyOnceWith({ items: [
            {
                tableName: 'Workspace-Tree-Locks',
                key: { organizationId: 'org-1' },
            },
            {
                tableName: 'Workspace-Tree',
                key: {
                    pk: 'ORG#org-1#NAVIGATION',
                    sk: 'HEAD',
                },
            },
            {
                tableName: 'Workspace-Tree-Locks',
                key: { organizationId: 'org-2' },
            },
            {
                tableName: 'Workspace-Tree',
                key: {
                    pk: 'ORG#org-2#NAVIGATION',
                    sk: 'HEAD',
                },
            },
        ] })
        expect(Object.fromEntries(fences)).toEqual({
            'org-1': {
                locked: false,
                revisionId: 'revision-1',
                head: {
                    revision: 3,
                    revisionId: 'revision-1',
                    schemaVersion: 1,
                },
            },
            'org-2': { locked: true },
        })
    })

    it('lists a workspace grants through the workspace index', async () => {
        const queryItems = vi.fn(async () => ({ items: [] }))
        await new DynamoDbWorkspaceTreeRepository({ queryItems } as never, tables).listWorkspaceGrants('child')

        expect(queryItems).toHaveBeenCalledWith(expect.objectContaining({
            tableName: 'Workspaces-Access-List',
            indexName: 'workspaceId-userId',
            keyConditions: { workspaceId: 'child' },
        }))
    })

    it('fences a write on the grant row and on the workspace ancestors', () => {
        const operations = new DynamoDbWorkspaceTreeRepository({} as never, tables).accessFenceOperations({
            userId: 'user-1',
            workspaceId: 'child',
            organizationId: 'org-1',
            grant: {
                grantWorkspaceId: 'root',
                accessLevel: 'owner',
                ancestorIds: ['root'],
            },
        })

        expect(operations).toEqual([
            expect.objectContaining({
                type: 'check',
                tableName: 'Workspaces-Access-List',
                key: {
                    userId: 'user-1',
                    workspaceId: 'root',
                },
                expressionAttributeValues: { ':accessLevel': 'owner' },
            }),
            expect.objectContaining({
                type: 'check',
                tableName: 'Workspaces-Meta',
                key: { workspaceId: 'child' },
                expressionAttributeValues: {
                    ':organizationId': 'org-1',
                    ':ancestorIds': ['root'],
                },
            }),
        ])
    })
})
