'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NATS_SUBJECTS } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    natsService: {
        deleteObject: vi.fn(),
    },
    natsServiceFactory: {
        getInstance: vi.fn(),
    },
    workspace: {
        getWorkspace: vi.fn(),
        isFileReferencedByCanvasState: vi.fn(),
        removeFile: vi.fn(),
    },
}))

vi.mock('@lixpi/debug-tools', () => ({ info: vi.fn(), err: vi.fn() }))
vi.mock('@lixpi/nats-service', () => ({
    default: {
        getInstance: mocks.natsServiceFactory.getInstance,
    },
}))
vi.mock('../../models/workspace.ts', () => ({ default: mocks.workspace }))

import { imageSubjects } from './image-subjects.ts'
import { videoSubjects } from './video-subjects.ts'

const { IMAGE_SUBJECTS, VIDEO_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

const getImageHandler = () =>
    imageSubjects.find((subscription) => subscription.subject === IMAGE_SUBJECTS.DELETE_IMAGE)!.handler

const getVideoHandler = () =>
    videoSubjects.find((subscription) => subscription.subject === VIDEO_SUBJECTS.DELETE_VIDEO)!.handler

// =============================================================================
// WORKSPACE MEDIA DELETE SAFETY
// =============================================================================

describe('Workspace media delete subjects', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.natsServiceFactory.getInstance.mockReturnValue(mocks.natsService)
        mocks.workspace.getWorkspace.mockResolvedValue({ workspaceId: 'workspace-1' })
        mocks.workspace.isFileReferencedByCanvasState.mockResolvedValue(false)
        mocks.workspace.removeFile.mockResolvedValue(undefined)
        mocks.natsService.deleteObject.mockResolvedValue(undefined)
    })

    it('refuses image delete requests that miss workspaceId or fileId', async () => {
        const resultMissingWorkspaceId = await getImageHandler()({
            user: { userId: 'user-1' },
            fileId: 'image-file',
        } as any, {})

        const resultMissingFileId = await getImageHandler()({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
        } as any, {})

        expect(resultMissingWorkspaceId).toEqual({ error: 'Missing workspaceId or fileId' })
        expect(resultMissingFileId).toEqual({ error: 'Missing workspaceId or fileId' })
        expect(mocks.workspace.getWorkspace).not.toHaveBeenCalled()
        expect(mocks.workspace.removeFile).not.toHaveBeenCalled()
        expect(mocks.natsService.deleteObject).not.toHaveBeenCalled()
    })

    it('refuses video delete requests that miss workspaceId or fileId', async () => {
        const resultMissingWorkspaceId = await getVideoHandler()({
            user: { userId: 'user-1' },
            fileId: 'video-file',
        } as any, {})

        const resultMissingFileId = await getVideoHandler()({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
        } as any, {})

        expect(resultMissingWorkspaceId).toEqual({ error: 'Missing workspaceId or fileId' })
        expect(resultMissingFileId).toEqual({ error: 'Missing workspaceId or fileId' })
        expect(mocks.workspace.getWorkspace).not.toHaveBeenCalled()
        expect(mocks.workspace.removeFile).not.toHaveBeenCalled()
        expect(mocks.natsService.deleteObject).not.toHaveBeenCalled()
    })

    it('refuses to delete image bytes while canonical canvas state still references the file', async () => {
        mocks.workspace.isFileReferencedByCanvasState.mockResolvedValueOnce(true)

        const result = await getImageHandler()({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            fileId: 'image-file',
        }, {})

        expect(result).toEqual({ error: 'FILE_STILL_REFERENCED_BY_CANVAS', fileId: 'image-file' })
        expect(mocks.workspace.removeFile).not.toHaveBeenCalled()
        expect(mocks.natsService.deleteObject).not.toHaveBeenCalled()
    })

    it('refuses delete of image files when workspace access is denied', async () => {
        mocks.workspace.getWorkspace.mockResolvedValueOnce({ error: 'WORKSPACE_NOT_FOUND' })

        const result = await getImageHandler()({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            fileId: 'image-file',
        }, {})

        expect(result).toEqual({ error: 'Workspace not found or access denied' })
        expect(mocks.workspace.removeFile).not.toHaveBeenCalled()
        expect(mocks.natsService.deleteObject).not.toHaveBeenCalled()
    })

    it('returns SERVICE_UNAVAILABLE for image deletes when NATS is unavailable', async () => {
        mocks.natsServiceFactory.getInstance.mockReturnValueOnce(undefined as any)

        const result = await getImageHandler()({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            fileId: 'image-file',
        }, {})

        expect(result).toEqual({ error: 'Service unavailable' })
        expect(mocks.workspace.removeFile).not.toHaveBeenCalled()
        expect(mocks.natsService.deleteObject).not.toHaveBeenCalled()
    })

    it('returns SERVICE_UNAVAILABLE for video deletes when NATS is unavailable', async () => {
        mocks.natsServiceFactory.getInstance.mockReturnValueOnce(undefined as any)

        const result = await getVideoHandler()({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            fileId: 'video-file',
        }, {})

        expect(result).toEqual({ error: 'Service unavailable' })
        expect(mocks.workspace.removeFile).not.toHaveBeenCalled()
        expect(mocks.natsService.deleteObject).not.toHaveBeenCalled()
    })

    it('bubbles storage delete failures after metadata cleanup for image files', async () => {
        mocks.natsService.deleteObject.mockRejectedValueOnce(new Error('storage unavailable'))

        const result = await getImageHandler()({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            fileId: 'image-file',
        }, {})

        expect(result).toEqual({ error: 'storage unavailable' })
        expect(mocks.workspace.removeFile).toHaveBeenCalledTimes(1)
        expect(mocks.natsService.deleteObject).toHaveBeenCalledTimes(1)
    })

    it('bubbles storage delete failures after metadata cleanup for video files', async () => {
        mocks.natsService.deleteObject.mockRejectedValueOnce(new Error('storage unavailable'))

        const result = await getVideoHandler()({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            fileId: 'video-file',
        }, {})

        expect(result).toEqual({ error: 'storage unavailable' })
        expect(mocks.workspace.removeFile).toHaveBeenCalledTimes(1)
        expect(mocks.natsService.deleteObject).toHaveBeenCalledTimes(1)
    })

    it('deletes only the requested image object when the workspace file map has no matching file', async () => {
        mocks.workspace.getWorkspace.mockResolvedValueOnce({
            workspaceId: 'workspace-1',
            files: [{ id: 'other-file', canonicalFileId: 'other-canonical' }],
        })

        const result = await getImageHandler()({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            fileId: 'orphan-image-file',
        }, {})

        expect(result).toEqual({ success: true, fileId: 'orphan-image-file' })
        expect(mocks.natsService.deleteObject).toHaveBeenCalledTimes(1)
        expect(mocks.natsService.deleteObject).toHaveBeenCalledWith(
            'workspace-workspace-1-files',
            'orphan-image-file',
        )
    })

    it('deletes only the requested video object when the workspace file map has no matching file', async () => {
        mocks.workspace.getWorkspace.mockResolvedValueOnce({
            workspaceId: 'workspace-1',
            files: [{ id: 'other-file', canonicalFileId: 'other-canonical' }],
        })

        const result = await getVideoHandler()({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            fileId: 'orphan-video-file',
        }, {})

        expect(result).toEqual({ success: true, fileId: 'orphan-video-file' })
        expect(mocks.natsService.deleteObject).toHaveBeenCalledTimes(1)
        expect(mocks.natsService.deleteObject).toHaveBeenCalledWith(
            'workspace-workspace-1-files',
            'orphan-video-file',
        )
    })

    it('removes image metadata before deleting unreferenced bytes', async () => {
        const result = await getImageHandler()({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            fileId: 'image-file',
        }, {})

        expect(result).toEqual({ success: true, fileId: 'image-file' })
        expect(mocks.workspace.isFileReferencedByCanvasState).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            fileId: 'image-file',
        })
        expect(mocks.workspace.removeFile).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            fileId: 'image-file',
        })
        expect(mocks.natsService.deleteObject).toHaveBeenCalledWith('workspace-workspace-1-files', 'image-file')
        expect(mocks.workspace.removeFile.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.natsService.deleteObject.mock.invocationCallOrder[0]!
        )
    })

    it('deletes original and canonical image objects when the canvas used the canonical id', async () => {
        mocks.workspace.getWorkspace.mockResolvedValueOnce({
            workspaceId: 'workspace-1',
            files: [
                { id: 'original-image', canonicalFileId: 'original-image-canonical' },
            ],
        })

        const result = await getImageHandler()({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            fileId: 'original-image-canonical',
        }, {})

        expect(result).toEqual({ success: true, fileId: 'original-image-canonical' })
        expect(mocks.workspace.removeFile).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            fileId: 'original-image-canonical',
        })
        expect(mocks.natsService.deleteObject).toHaveBeenCalledWith('workspace-workspace-1-files', 'original-image')
        expect(mocks.natsService.deleteObject).toHaveBeenCalledWith('workspace-workspace-1-files', 'original-image-canonical')
    })

    it('refuses to delete video bytes while canonical canvas state still references the file', async () => {
        mocks.workspace.isFileReferencedByCanvasState.mockResolvedValueOnce(true)

        const result = await getVideoHandler()({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            fileId: 'video-file',
        }, {})

        expect(result).toEqual({ error: 'FILE_STILL_REFERENCED_BY_CANVAS', fileId: 'video-file' })
        expect(mocks.workspace.removeFile).not.toHaveBeenCalled()
        expect(mocks.natsService.deleteObject).not.toHaveBeenCalled()
    })

    it('removes video metadata before deleting unreferenced bytes', async () => {
        const result = await getVideoHandler()({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            fileId: 'video-file',
        }, {})

        expect(result).toEqual({ success: true, fileId: 'video-file' })
        expect(mocks.workspace.isFileReferencedByCanvasState).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            fileId: 'video-file',
        })
        expect(mocks.workspace.removeFile).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            fileId: 'video-file',
        })
        expect(mocks.natsService.deleteObject).toHaveBeenCalledWith('workspace-workspace-1-files', 'video-file')
        expect(mocks.workspace.removeFile.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.natsService.deleteObject.mock.invocationCallOrder[0]!
        )
    })

    it('deletes original and canonical video objects when the canvas used the canonical id', async () => {
        mocks.workspace.getWorkspace.mockResolvedValueOnce({
            workspaceId: 'workspace-1',
            files: [
                { id: 'original-video', canonicalFileId: 'original-video-canonical' },
            ],
        })

        const result = await getVideoHandler()({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            fileId: 'original-video-canonical',
        }, {})

        expect(result).toEqual({ success: true, fileId: 'original-video-canonical' })
        expect(mocks.workspace.removeFile).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            fileId: 'original-video-canonical',
        })
        expect(mocks.natsService.deleteObject).toHaveBeenCalledWith('workspace-workspace-1-files', 'original-video')
        expect(mocks.natsService.deleteObject).toHaveBeenCalledWith('workspace-workspace-1-files', 'original-video-canonical')
    })
})
