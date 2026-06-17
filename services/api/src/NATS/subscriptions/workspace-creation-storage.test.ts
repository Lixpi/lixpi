'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NATS_SUBJECTS } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    natsService: {
        createObjectStore: vi.fn(),
        deleteObjectStore: vi.fn(),
    },
    workspace: {
        createWorkspace: vi.fn(),
        delete: vi.fn(),
        getBucketName: vi.fn((workspaceId: string) => `workspace-${workspaceId}-files`),
    },
    feature: {
        listPromotedByOriginWorkspaceForCleanup: vi.fn(),
        listByScope: vi.fn(),
        deleteFeature: vi.fn(),
    },
    mediaLibraryItem: {
        listWorkspaceItemsForCleanup: vi.fn(),
        deleteImageItem: vi.fn(),
        deleteVideoItem: vi.fn(),
    },
    aiChatThread: {
        deleteWorkspaceAiChatThreads: vi.fn(),
    },
    extractionRun: {
        deleteWorkspaceRuns: vi.fn(),
    },
    getMediaLibraryWorkspaceBucketName: vi.fn((workspaceId: string) =>
        `media-library-workspace-${workspaceId}-files`
    ),
}))

vi.mock('@lixpi/debug-tools', () => ({ info: vi.fn(), err: vi.fn(), warn: vi.fn() }))
vi.mock('@lixpi/nats-service', () => ({
    default: {
        getInstance: vi.fn(() => mocks.natsService),
    },
}))
vi.mock('../../models/workspace.ts', () => ({ default: mocks.workspace }))
vi.mock('../../models/document.ts', () => ({ default: {} }))
vi.mock('../../models/feature.ts', () => ({ default: mocks.feature }))
vi.mock('../../models/media-library-item.ts', () => ({ default: mocks.mediaLibraryItem }))
vi.mock('../../models/ai-chat-thread.ts', () => ({ default: mocks.aiChatThread }))
vi.mock('../../models/extraction-run.ts', () => ({ default: mocks.extractionRun }))
vi.mock('../../services/media-library-storage.ts', () => ({
    deleteLibraryImageObject: vi.fn(),
    deleteLibraryVideoObject: vi.fn(),
    deleteMediaLibraryWorkspaceBucket: vi.fn(),
    getMediaLibraryWorkspaceBucketName: mocks.getMediaLibraryWorkspaceBucketName,
}))
vi.mock('../../services/feature-sample-storage.ts', () => ({
    ensureFeatureSamplesForScope: vi.fn(),
}))

import { workspaceSubjects } from './workspace-subjects.ts'

const getHandler = (subject: string) =>
    workspaceSubjects.find((subscription) => subscription.subject === subject)!.handler

// =============================================================================
// WORKSPACE STORAGE PROVISIONING
// =============================================================================

describe('Workspace creation storage provisioning', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.workspace.createWorkspace.mockResolvedValue({
            workspaceId: 'ws-1',
            name: 'New Workspace',
        })
        mocks.workspace.delete.mockResolvedValue({ status: 'deleted', workspaceId: 'ws-1' })
        mocks.natsService.createObjectStore.mockResolvedValue({})
        mocks.natsService.deleteObjectStore.mockResolvedValue(true)
    })

    it('creates both the workspace file bucket and the workspace media-library bucket', async () => {
        const result = await getHandler(NATS_SUBJECTS.WORKSPACE_SUBJECTS.CREATE_WORKSPACE)({
            user: { userId: 'user-1' },
            name: 'New Workspace',
        })

        expect(mocks.workspace.getBucketName).toHaveBeenCalledWith('ws-1')
        expect(mocks.getMediaLibraryWorkspaceBucketName).toHaveBeenCalledWith('ws-1')
        expect(mocks.natsService.createObjectStore).toHaveBeenNthCalledWith(1, 'workspace-ws-1-files', {
            description: 'Files for workspace ws-1',
        })
        expect(mocks.natsService.createObjectStore).toHaveBeenNthCalledWith(2, 'media-library-workspace-ws-1-files', {
            description: 'Media Library files for workspace ws-1',
        })
        expect(mocks.workspace.delete).not.toHaveBeenCalled()
        expect(result).toEqual(expect.objectContaining({ workspaceId: 'ws-1' }))
    })

    it('rolls back the database record and both bucket names when media-library bucket creation fails', async () => {
        mocks.natsService.createObjectStore
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(new Error('stream create failed'))

        const result = await getHandler(NATS_SUBJECTS.WORKSPACE_SUBJECTS.CREATE_WORKSPACE)({
            user: { userId: 'user-1' },
            name: 'New Workspace',
        })

        expect(result).toEqual({ error: 'FAILED_TO_CREATE_BUCKET' })
        expect(mocks.natsService.deleteObjectStore).toHaveBeenNthCalledWith(1, 'workspace-ws-1-files')
        expect(mocks.natsService.deleteObjectStore).toHaveBeenNthCalledWith(2, 'media-library-workspace-ws-1-files')
        expect(mocks.workspace.delete).toHaveBeenCalledWith({
            userId: 'user-1',
            workspaceId: 'ws-1',
        })
    })
})
