'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NATS_SUBJECTS } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    natsService: {
        deleteObject: vi.fn(),
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
        getInstance: vi.fn(() => mocks.natsService),
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
        mocks.workspace.getWorkspace.mockResolvedValue({ workspaceId: 'workspace-1' })
        mocks.workspace.isFileReferencedByCanvasState.mockResolvedValue(false)
        mocks.workspace.removeFile.mockResolvedValue(undefined)
        mocks.natsService.deleteObject.mockResolvedValue(undefined)
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
