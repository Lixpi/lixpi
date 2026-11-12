import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const mocks = vi.hoisted(() => ({
    removeAllWorkspaceReferences: vi.fn(),
    cleanupMediaRequests: vi.fn(),
    stopWorkspace: vi.fn(),
    getSelfMembership: vi.fn(),
}))

vi.mock('@lixpi/debug-tools', () => ({
    info: vi.fn(),
    err: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
}))
vi.mock('../models/asset.ts', () => ({ default: { removeAllWorkspaceReferences: mocks.removeAllWorkspaceReferences } }))
vi.mock('../models/organization.ts', () => ({ default: { getSelfMembership: mocks.getSelfMembership } }))
vi.mock('./media-generation-request-service.ts', () => ({
    MediaGenerationRequestService: class {
        cleanupWorkspace = mocks.cleanupMediaRequests
    },
}))
vi.mock('../llm/agent/conversation-adapters.ts', () => ({
    ConversationAdapters: class {
        service = () => ({ stopWorkspace: mocks.stopWorkspace })
    },
}))
vi.mock('../llm/agent/conversation-repository.ts', () => ({
    ConversationRepository: class {},
}))

import { workspaceTreeService } from './workspace-tree-service.ts'

type Ports = {
    deletion: {
        stopConversations: (workspace: object, userId: string) => Promise<void>
        cleanupWorkspace: (workspace: object, userId: string) => Promise<void>
    }
    organizations: {
        getMembershipLevel: (userId: string, organizationId: string) => Promise<string | undefined>
    }
    createWorkspaceContent: () => Record<string, unknown>
}

const ports = (): Ports => (workspaceTreeService() as unknown as { options: Ports }).options

const workspace = {
    workspaceId: 'ws-1',
    organizationId: 'org-1',
    name: 'Doomed',
    tagIds: [],
    ancestorIds: ['parent'],
    position: 'V',
    deletingAt: 5,
    createdAt: 1,
    updatedAt: 1,
}

beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as Record<string, unknown>).dynamoDBService = {}
})

// =============================================================================
// DELETION PORTS
// =============================================================================

describe('API workspace tree deletion ports', () => {
    it('cleans a deleting workspace as its owner, scoped to that workspace alone', async () => {
        mocks.cleanupMediaRequests.mockResolvedValue(2)
        mocks.removeAllWorkspaceReferences.mockResolvedValue(3)

        await ports().deletion.cleanupWorkspace(workspace, 'user-1')

        expect(mocks.cleanupMediaRequests).toHaveBeenCalledWith('ws-1')
        expect(mocks.removeAllWorkspaceReferences).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            requester: {
                userId: 'user-1',
                workspaceIds: ['ws-1'],
                editableWorkspaceIds: ['ws-1'],
                organizationIds: ['org-1'],
            },
        })
    })

    it('stops the workspace conversations through the system stop', async () => {
        mocks.stopWorkspace.mockResolvedValue(1)

        await ports().deletion.stopConversations(workspace, 'user-1')

        expect(mocks.stopWorkspace).toHaveBeenCalledWith('org-1', 'ws-1')
    })
})

// =============================================================================
// ORGANIZATIONS AND CONTENT
// =============================================================================

describe('API workspace tree organization and content ports', () => {
    it('reports a non-member as having no organization level', async () => {
        mocks.getSelfMembership.mockResolvedValueOnce({ accessLevel: 'editor' })
        mocks.getSelfMembership.mockRejectedValueOnce(new Error('ORGANIZATION_ACCESS_DENIED'))

        expect(await ports().organizations.getMembershipLevel('user-1', 'org-1')).toBe('editor')
        expect(await ports().organizations.getMembershipLevel('user-2', 'org-1')).toBeUndefined()
    })

    it('starts every workspace with an empty canvas and a save token', () => {
        expect(ports().createWorkspaceContent()).toMatchObject({
            canvasState: {
                nodes: [],
                edges: [],
            },
            canvasStateUpdatedAt: expect.any(Number),
        })
    })
})
