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
        delete: vi.fn(),
        markDeleting: vi.fn(),
        getUserWorkspaces: vi.fn(),
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

describe('Workspace deletion cleans up workspace Asset references', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.workspace.getWorkspace.mockResolvedValue({
            workspaceId: 'ws-1',
            accessList: [{ userId: 'user-1', accessLevel: 'owner' }],
        })
        mocks.workspace.delete.mockResolvedValue({ status: 'deleted', workspaceId: 'ws-1' })
        mocks.workspace.markDeleting.mockResolvedValue(undefined)
        mocks.workspace.getUserWorkspaces.mockResolvedValue([{ workspaceId: 'ws-1' }])
        mocks.organization.getUserOrganizations.mockResolvedValue([{ organizationId: 'organization-1' }])
        mocks.asset.removeAllWorkspaceReferences.mockResolvedValue(2)
        mocks.mediaRequests.cleanupWorkspace.mockResolvedValue(1)
    })

    it('deletes workspace Asset references before removing the workspace', async () => {
        const result = await getHandler(NATS_SUBJECTS.WORKSPACE_SUBJECTS.DELETE_WORKSPACE)({
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
        })

        expect(mocks.workspace.markDeleting).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
        expect(mocks.mediaRequests.cleanupWorkspace).toHaveBeenCalledWith('ws-1')
        expect(mocks.asset.removeAllWorkspaceReferences).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            requester: expect.objectContaining({ userId: 'user-1' }),
        })
        expect(mocks.workspace.delete).toHaveBeenCalledWith({ userId: 'user-1', workspaceId: 'ws-1' })
        expect(result).toEqual({ success: true, workspaceId: 'ws-1' })
    })

    it('returns a cleanup-failure error and does not remove the workspace when dependency cleanup throws', async () => {
        mocks.asset.removeAllWorkspaceReferences.mockRejectedValueOnce(new Error('throttled'))

        const result = await getHandler(NATS_SUBJECTS.WORKSPACE_SUBJECTS.DELETE_WORKSPACE)({
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
        })

        expect(mocks.workspace.delete).not.toHaveBeenCalled()
        expect(result).toEqual({ error: 'WORKSPACE_DEPENDENCY_CLEANUP_FAILED' })
    })

    it('does not touch history when the workspace is inaccessible', async () => {
        mocks.workspace.getWorkspace.mockResolvedValueOnce({ error: 'PERMISSION_DENIED' })

        const result = await getHandler(NATS_SUBJECTS.WORKSPACE_SUBJECTS.DELETE_WORKSPACE)({
            user: { userId: 'user-1' },
            workspaceId: 'ws-1',
        })

        expect(result).toEqual({ error: 'PERMISSION_DENIED' })
        expect(mocks.asset.removeAllWorkspaceReferences).not.toHaveBeenCalled()
        expect(mocks.workspace.delete).not.toHaveBeenCalled()
    })
})
