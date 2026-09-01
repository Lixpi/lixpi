'use strict'

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
        createWorkspace: vi.fn(),
        delete: vi.fn(),
        markDeleting: vi.fn(),
        getWorkspace: vi.fn(),
        getUserWorkspaces: vi.fn(),
        update: vi.fn(),
        updateCanvasState: vi.fn(),
    },
    organization: {
        getUserOrganizations: vi.fn(),
    },
    asset: {
        removeAllWorkspaceReferences: vi.fn(),
    },
    mediaRequests: {
        cleanupWorkspace: vi.fn(),
    },
}))

vi.mock('@lixpi/debug-tools', () => ({ info: vi.fn(), err: vi.fn(), warn: vi.fn() }))
vi.mock('../../models/workspace.ts', () => ({ default: mocks.workspace }))
vi.mock('../../models/organization.ts', () => ({ default: mocks.organization }))
vi.mock('../../models/asset.ts', () => ({ default: mocks.asset }))
vi.mock('../../services/media-generation-request-service.ts', () => ({
    MediaGenerationRequestService: class {
        cleanupWorkspace = mocks.mediaRequests.cleanupWorkspace
    },
}))

import { workspaceSubjects } from './workspace-subjects.ts'

const getHandler = (subject: string) => workspaceSubjects.find((subscription) => subscription.subject === subject)!.handler

const { WORKSPACE_SUBJECTS } = NATS_SUBJECTS

describe('Workspace subject handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.workspace.createWorkspace.mockResolvedValue({
            workspaceId: 'ws-1',
            name: 'Workspace',
        })
        mocks.workspace.getWorkspace.mockResolvedValue({
            workspaceId: 'ws-1',
            accessList: [{ userId: 'user-1', accessLevel: 'owner' }],
        })
        mocks.workspace.delete.mockResolvedValue({ status: 'deleted', workspaceId: 'ws-1' })
        mocks.workspace.markDeleting.mockResolvedValue(undefined)
        mocks.workspace.getUserWorkspaces.mockResolvedValue([{ workspaceId: 'ws-1' }])
        mocks.workspace.update.mockResolvedValue({ status: 'ok' })
        mocks.workspace.updateCanvasState.mockResolvedValue({ status: 'canvas-saved' })
        mocks.organization.getUserOrganizations.mockResolvedValue([{ organizationId: 'organization-1' }])
        mocks.asset.removeAllWorkspaceReferences.mockResolvedValue(2)
        mocks.mediaRequests.cleanupWorkspace.mockResolvedValue(1)
    })

    // =========================================================================
    // READS
    // =========================================================================

    it('fetches a workspace via user and workspaceId', async () => {
        const result = await getHandler(WORKSPACE_SUBJECTS.GET_WORKSPACE)({
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
        })

        expect(result).toEqual(expect.objectContaining({ workspaceId: 'ws-1' }))
        expect(mocks.workspace.getWorkspace).toHaveBeenCalledWith({
            userId: 'user-1',
            workspaceId: 'ws-1',
        })
    })

    it('enforces UNAUTHORIZED when GET_USER_WORKSPACES lacks a user id', async () => {
        const result = await getHandler(WORKSPACE_SUBJECTS.GET_USER_WORKSPACES)({
            user: {} as any,
        })

        expect(result).toEqual({ error: 'UNAUTHORIZED' })
        expect(mocks.workspace.getUserWorkspaces).not.toHaveBeenCalled()
    })

    it('fetches user workspaces for authenticated callers', async () => {
        const result = await getHandler(WORKSPACE_SUBJECTS.GET_USER_WORKSPACES)({
            user: { userId: 'user-1' },
        })

        expect(result).toEqual([{ workspaceId: 'ws-1' }])
        expect(mocks.workspace.getUserWorkspaces).toHaveBeenCalledWith({ userId: 'user-1' })
    })

    // =========================================================================
    // WRITE / COMMAND HANDLERS
    // =========================================================================

    it('creates a workspace under the resolved default organization', async () => {
        const result = await getHandler(WORKSPACE_SUBJECTS.CREATE_WORKSPACE)({
            user: { userId: 'user-1' },
            name: 'New Workspace',
        })

        expect(mocks.workspace.createWorkspace).toHaveBeenCalledWith({
            name: 'New Workspace',
            organizationId: 'organization-1',
            permissions: {
                userId: 'user-1',
                accessLevel: 'owner',
            },
        })
        expect(result).toEqual({ workspaceId: 'ws-1', name: 'Workspace' })
    })

    it('denies workspace creation for an organization the user does not belong to', async () => {
        const result = await getHandler(WORKSPACE_SUBJECTS.CREATE_WORKSPACE)({
            user: { userId: 'user-1' },
            name: 'New Workspace',
            organizationId: 'organization-2',
        })

        expect(mocks.workspace.createWorkspace).not.toHaveBeenCalled()
        expect(result).toEqual({ error: 'ORGANIZATION_ACCESS_DENIED' })
    })

    it('updates workspace metadata', async () => {
        const result = await getHandler(WORKSPACE_SUBJECTS.UPDATE_WORKSPACE)({
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
            name: 'Renamed',
        })

        expect(result).toEqual({ success: true, workspaceId: 'ws-1' })
        expect(mocks.workspace.update).toHaveBeenCalledWith({
            userId: 'user-1',
            workspaceId: 'ws-1',
            name: 'Renamed',
        })
    })

    it('forwards canvas state updates with expected save tokens', async () => {
        const result = await getHandler(WORKSPACE_SUBJECTS.UPDATE_CANVAS_STATE)({
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
            canvasState: { nodes: [] },
            expectedCanvasStateUpdatedAt: 123,
            expectedUpdatedAt: 456,
        })

        expect(result).toEqual({ status: 'canvas-saved' })
        expect(mocks.workspace.updateCanvasState).toHaveBeenCalledWith({
            userId: 'user-1',
            workspaceId: 'ws-1',
            canvasState: { nodes: [] },
            expectedCanvasStateUpdatedAt: 123,
            expectedUpdatedAt: 456,
            persistViewport: false,
        })
    })

    // =========================================================================
    // CLEANUP / DELETION
    // =========================================================================

    it('deletes the workspace after cleaning up asset references', async () => {
        const result = await getHandler(WORKSPACE_SUBJECTS.DELETE_WORKSPACE)({
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
        })

        expect(mocks.workspace.markDeleting).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
        expect(mocks.mediaRequests.cleanupWorkspace).toHaveBeenCalledWith('ws-1')
        expect(mocks.asset.removeAllWorkspaceReferences).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            requester: expect.objectContaining({ userId: 'user-1' }),
        })
        expect(mocks.workspace.delete).toHaveBeenCalledWith({
            userId: 'user-1',
            workspaceId: 'ws-1',
        })
        expect(result).toEqual({ success: true, workspaceId: 'ws-1' })
    })

    it('denies deletion for a non-owner accessor', async () => {
        mocks.workspace.getWorkspace.mockResolvedValueOnce({
            workspaceId: 'ws-1',
            accessList: [{ userId: 'user-1', accessLevel: 'editor' }],
        })

        const result = await getHandler(WORKSPACE_SUBJECTS.DELETE_WORKSPACE)({
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
        })

        expect(result).toEqual({ error: 'PERMISSION_DENIED' })
        expect(mocks.workspace.delete).not.toHaveBeenCalled()
    })
})
