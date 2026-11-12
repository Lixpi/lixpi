import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const mocks = vi.hoisted(() => ({
    getWorkspace: vi.fn(),
    publish: vi.fn(),
}))

vi.mock('../../models/workspace.ts', () => ({
    default: { getWorkspace: mocks.getWorkspace },
}))

vi.mock('@lixpi/nats-service', () => ({
    default: { getInstance: () => ({ publish: mocks.publish }) },
}))

import { ConversationAdapters } from './conversation-adapters.ts'

const dynamo = {
    getItem: vi.fn(),
    queryItems: vi.fn(),
    transactRead: vi.fn(),
}

const authorizedChild = (grant: {
    grantWorkspaceId: string
    accessLevel: 'owner' | 'editor' | 'viewer'
}) => ({
    workspaceId: 'child',
    organizationId: 'org-1',
    accessLevel: grant.accessLevel,
    accessGrant: {
        ...grant,
        ancestorIds: ['root'],
    },
})

beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as Record<string, unknown>).dynamoDBService = dynamo
})

// =============================================================================
// WRITE FENCES
// =============================================================================

describe('ConversationAdapters.authorize', () => {
    it('fences agent writes on the inherited grant row and on the workspace ancestors', async () => {
        mocks.getWorkspace.mockResolvedValue(authorizedChild({
            grantWorkspaceId: 'root',
            accessLevel: 'editor',
        }))

        const access = await new ConversationAdapters({} as never).authorize('child', 'user-1', true)

        expect(access).toMatchObject({
            userId: 'user-1',
            organizationId: 'org-1',
            workspaceId: 'child',
        })
        // A revoked parent grant deletes the row the first check reads, and a
        // move rewrites the ancestors the second check compares, so either
        // change cancels the agent's next write.
        expect(access.fences).toEqual([
            expect.objectContaining({
                type: 'check',
                key: {
                    userId: 'user-1',
                    workspaceId: 'root',
                },
                conditionExpression: '#accessLevel = :accessLevel',
                expressionAttributeValues: { ':accessLevel': 'editor' },
            }),
            expect.objectContaining({
                type: 'check',
                key: { workspaceId: 'child' },
                conditionExpression: '#organizationId = :organizationId AND #ancestorIds = :ancestorIds AND attribute_not_exists(#deletingAt)',
                expressionAttributeValues: {
                    ':organizationId': 'org-1',
                    ':ancestorIds': ['root'],
                },
            }),
        ])
    })

    it('refuses writes to a viewer and access to a deleting workspace', async () => {
        mocks.getWorkspace.mockResolvedValue(authorizedChild({
            grantWorkspaceId: 'root',
            accessLevel: 'viewer',
        }))
        const adapters = new ConversationAdapters({} as never)

        await expect(adapters.authorize('child', 'user-1', true)).rejects.toThrow('CONVERSATION_WORKSPACE_ACCESS_DENIED')
        await expect(adapters.authorize('child', 'user-1', false)).resolves.toMatchObject({ workspaceId: 'child' })

        mocks.getWorkspace.mockResolvedValue({
            ...authorizedChild({
                grantWorkspaceId: 'root',
                accessLevel: 'owner',
            }),
            deletingAt: 5,
        })

        await expect(adapters.authorize('child', 'user-1', false)).rejects.toThrow('CONVERSATION_WORKSPACE_ACCESS_DENIED')
    })
})

// =============================================================================
// EVENT FANOUT
// =============================================================================

describe('ConversationAdapters.publish', () => {
    it('delivers events to users whose only grant is on an ancestor', async () => {
        // The navigation fence reads each organization lock and head together.
        dynamo.transactRead.mockImplementation(async ({ items }: { items: Array<{ key: { sk?: string } }> }) => items.map(item => (item.key.sk === 'HEAD'
            ? {
                revision: 1,
                revisionId: 'navigation-1',
                schemaVersion: 1,
            }
            : undefined)))
        dynamo.getItem.mockImplementation(async ({ origin }: { origin: string }) => {
            if (origin === 'WorkspaceTree.getWorkspaceMeta')
                return {
                    workspaceId: 'child',
                    organizationId: 'org-1',
                    ancestorIds: ['root'],
                }

            throw new Error(`Unexpected workspace read: ${origin}`)
        })
        dynamo.queryItems.mockImplementation(async ({ keyConditions }: { keyConditions: { workspaceId: string } }) => ({
            items: keyConditions.workspaceId === 'root'
                ? [{
                    userId: 'ancestor-only',
                    workspaceId: 'root',
                    accessLevel: 'viewer',
                }]
                : [{
                    userId: 'direct',
                    workspaceId: 'child',
                    accessLevel: 'owner',
                }],
        }))

        await new ConversationAdapters({} as never).publish({
            workspaceId: 'child',
            conversationAssetId: 'conversation-1',
        } as never)

        const subjects = mocks.publish.mock.calls.map(([subject]) => subject as string)
        expect(subjects).toHaveLength(2)
        expect(subjects.every(subject => subject.endsWith('.child.conversation-1'))).toBe(true)
        expect(dynamo.queryItems).toHaveBeenCalledWith(expect.objectContaining({ indexName: 'workspaceId-userId' }))
    })

    it('skips a workspace that is being deleted', async () => {
        dynamo.getItem.mockResolvedValue({
            workspaceId: 'child',
            ancestorIds: [],
            deletingAt: 3,
        })

        await new ConversationAdapters({} as never).publish({
            workspaceId: 'child',
            conversationAssetId: 'conversation-1',
        } as never)

        expect(mocks.publish).not.toHaveBeenCalled()
    })
})
