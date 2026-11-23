import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import { NATS_SUBJECTS } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    workspace: {
        getWorkspace: vi.fn(),
        updateCanvasState: vi.fn(),
    },
    collaboration: {
        handle: vi.fn(),
        saveHumanCanvas: vi.fn(),
    },
    organization: {
        getUserOrganizations: vi.fn(),
    },
    service: {
        getUserWorkspaceTree: vi.fn(),
        createWorkspace: vi.fn(),
        deleteWorkspace: vi.fn(),
    },
}))

vi.mock('@lixpi/debug-tools', () => ({
    info: vi.fn(),
    err: vi.fn(),
    warn: vi.fn(),
}))
vi.mock('../../models/workspace.ts', () => ({ default: mocks.workspace }))
vi.mock('../../services/canvas-collaboration.ts', () => ({ canvasCollaboration: mocks.collaboration }))
vi.mock('../../models/organization.ts', () => ({ default: mocks.organization }))
vi.mock('../../services/workspace-tree-service.ts', () => ({
    workspaceTreeService: () => mocks.service,
}))

import { workspaceSubjects } from './workspace-subjects.ts'

const getHandler = (subject: string) => workspaceSubjects.find(subscription => subscription.subject === subject)!.handler

const { WORKSPACE_SUBJECTS } = NATS_SUBJECTS

beforeEach(() => {
    vi.clearAllMocks()
    mocks.organization.getUserOrganizations.mockResolvedValue([{ organizationId: 'organization-1' }])
    mocks.service.createWorkspace.mockResolvedValue({
        workspace: { workspaceId: 'ws-1' },
        tree: { roots: [] },
    })
    mocks.collaboration.saveHumanCanvas.mockResolvedValue({ success: true })
})

// =============================================================================
// BINDINGS
// =============================================================================

describe('Workspace subject bindings', () => {
    it('binds every workspace subject, with the tree subjects served by the tree service', async () => {
        const {
            CANVAS_EVENTS,
            CANVAS_INTERNAL_PRESENCE,
            ...requestSubjects
        } = WORKSPACE_SUBJECTS

        expect(workspaceSubjects.map(subscription => subscription.subject).sort()).toEqual(Object.values(requestSubjects).sort())
        expect(workspaceSubjects.map(subscription => subscription.subject)).not.toContain(CANVAS_EVENTS)
        expect(workspaceSubjects.map(subscription => subscription.subject)).not.toContain(CANVAS_INTERNAL_PRESENCE)

        mocks.service.getUserWorkspaceTree.mockResolvedValue({ organizations: [] })
        expect(await getHandler(WORKSPACE_SUBJECTS.GET_USER_WORKSPACE_TREE)({ user: { userId: 'user-1' } })).toEqual({ organizations: [] })
        expect(mocks.service.getUserWorkspaceTree).toHaveBeenCalledWith('user-1')

        mocks.service.deleteWorkspace.mockResolvedValue({
            deletedWorkspaceIds: ['ws-1'],
            tree: { roots: [] },
        })
        expect(await getHandler(WORKSPACE_SUBJECTS.DELETE_WORKSPACE)({
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
        })).toMatchObject({ deletedWorkspaceIds: ['ws-1'] })
    })
})

// =============================================================================
// CREATE
// =============================================================================

describe('Workspace creation', () => {
    it('creates under the first organization when the request names none', async () => {
        await getHandler(WORKSPACE_SUBJECTS.CREATE_WORKSPACE)({
            user: { userId: 'user-1' },
            name: 'New',
        })

        expect(mocks.service.createWorkspace).toHaveBeenCalledWith('user-1', expect.objectContaining({
            organizationId: 'organization-1',
            name: 'New',
        }))
    })

    it('passes a named organization and placement through for the service to authorize', async () => {
        await getHandler(WORKSPACE_SUBJECTS.CREATE_WORKSPACE)({
            user: { userId: 'user-1' },
            organizationId: 'organization-2',
            parentWorkspaceId: 'parent-1',
            afterEntryId: 'sibling-1',
            name: 'Child',
        })

        expect(mocks.organization.getUserOrganizations).not.toHaveBeenCalled()
        expect(mocks.service.createWorkspace).toHaveBeenCalledWith('user-1', expect.objectContaining({
            organizationId: 'organization-2',
            parentWorkspaceId: 'parent-1',
            afterEntryId: 'sibling-1',
        }))
    })

    it('refuses a user with no organization', async () => {
        mocks.organization.getUserOrganizations.mockResolvedValue([])

        expect(await getHandler(WORKSPACE_SUBJECTS.CREATE_WORKSPACE)({
            user: { userId: 'user-1' },
            name: 'New',
        })).toEqual({ error: 'ORGANIZATION_ACCESS_DENIED' })
        expect(mocks.service.createWorkspace).not.toHaveBeenCalled()
    })
})

// =============================================================================
// READ AND CANVAS SAVE
// =============================================================================

describe('Workspace read and canvas save', () => {
    it('binds collaboration to the authenticated user and queues each request for one replica', async () => {
        const request = {
            user: { userId: 'verified-user' },
            userId: 'client-claimed-user',
            workspaceId: 'ws-1',
            sessionId: 'tab-1',
            action: 'join',
        }
        const collaboration = workspaceSubjects.find(subscription => subscription.subject === WORKSPACE_SUBJECTS.CANVAS_COLLABORATE)

        await getHandler(WORKSPACE_SUBJECTS.CANVAS_COLLABORATE)(request)

        expect(collaboration?.queue).toBe('workspaceCanvasCollaboration')
        expect(mocks.collaboration.handle).toHaveBeenCalledWith('verified-user', request)
    })

    it('reads a workspace for the requesting user', async () => {
        mocks.workspace.getWorkspace.mockResolvedValue({ workspaceId: 'ws-1' })

        expect(await getHandler(WORKSPACE_SUBJECTS.GET_WORKSPACE)({
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
        })).toEqual({ workspaceId: 'ws-1' })
        expect(mocks.workspace.getWorkspace).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            userId: 'user-1',
        })
    })

    it('saves the canvas for an inherited editor and refuses a viewer or a deleting workspace', async () => {
        const request = {
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
            canvasState: { nodes: [] },
            expectedCanvasStateUpdatedAt: 4,
        }

        mocks.workspace.getWorkspace.mockResolvedValue({
            workspaceId: 'ws-1',
            accessLevel: 'editor',
        })
        expect(await getHandler(WORKSPACE_SUBJECTS.UPDATE_CANVAS_STATE)(request)).toEqual({ success: true })
        expect(mocks.collaboration.saveHumanCanvas).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: 'ws-1',
            expectedCanvasStateUpdatedAt: 4,
            persistViewport: false,
        }))

        mocks.workspace.getWorkspace.mockResolvedValue({
            workspaceId: 'ws-1',
            accessLevel: 'viewer',
        })
        expect(await getHandler(WORKSPACE_SUBJECTS.UPDATE_CANVAS_STATE)(request)).toEqual({ error: 'PERMISSION_DENIED' })

        mocks.workspace.getWorkspace.mockResolvedValue({
            workspaceId: 'ws-1',
            accessLevel: 'owner',
            deletingAt: 9,
        })
        expect(await getHandler(WORKSPACE_SUBJECTS.UPDATE_CANVAS_STATE)(request)).toEqual({ error: 'WORKSPACE_DELETING' })
    })
})
