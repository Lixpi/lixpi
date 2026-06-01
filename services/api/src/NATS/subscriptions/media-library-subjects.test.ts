'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NATS_SUBJECTS, type MediaLibraryImageItem } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    publish: vi.fn(),
    warn: vi.fn(),
    workspace: {
        getWorkspace: vi.fn(),
        getUserWorkspaces: vi.fn(),
    },
    organization: {
        getOrganization: vi.fn(),
        getUserOrganizations: vi.fn(),
    },
    mediaLibraryItem: {
        createImageItem: vi.fn(),
        getImageItem: vi.fn(),
        getOwnedImageItem: vi.fn(),
        getAnyItem: vi.fn(),
        getOwnedAnyItem: vi.fn(),
        listAvailable: vi.fn(),
        changeScope: vi.fn(),
        deleteImageItem: vi.fn(),
        findActiveWorkspaceImageBySource: vi.fn(),
        // Video methods added in Phase 8 — included so the mock fully satisfies
        // the model's surface for either-kind code paths.
        createVideoItem: vi.fn(),
        getVideoItem: vi.fn(),
        getOwnedVideoItem: vi.fn(),
        changeScopeVideo: vi.fn(),
        deleteVideoItem: vi.fn(),
        findActiveWorkspaceVideoBySource: vi.fn(),
    },
    copyWorkspaceImageToLibrary: vi.fn(),
    materializeLibraryImageToWorkspace: vi.fn(),
    copyLibraryImageToScope: vi.fn(),
    deleteLibraryImageObject: vi.fn(),
    copyWorkspaceVideoToLibrary: vi.fn(),
    materializeLibraryVideoToWorkspace: vi.fn(),
    copyLibraryVideoToScope: vi.fn(),
    deleteLibraryVideoObject: vi.fn(),
}))

vi.mock('@lixpi/debug-tools', () => ({
    info: vi.fn(),
    warn: mocks.warn,
}))

vi.mock('@lixpi/nats-service', () => ({
    default: {
        getInstance: () => ({ publish: mocks.publish }),
    },
}))

vi.mock('../../models/workspace.ts', () => ({ default: mocks.workspace }))
vi.mock('../../models/organization.ts', () => ({ default: mocks.organization }))
vi.mock('../../models/media-library-item.ts', () => ({
    default: mocks.mediaLibraryItem,
    buildMediaLibraryScopeAndOwnerKey: (scope: string, scopeOwnerId: string) => `${scope}#${scopeOwnerId}`,
}))
vi.mock('../../services/media-library-storage.ts', () => ({
    copyWorkspaceImageToLibrary: mocks.copyWorkspaceImageToLibrary,
    materializeLibraryImageToWorkspace: mocks.materializeLibraryImageToWorkspace,
    copyLibraryImageToScope: mocks.copyLibraryImageToScope,
    deleteLibraryImageObject: mocks.deleteLibraryImageObject,
    copyWorkspaceVideoToLibrary: mocks.copyWorkspaceVideoToLibrary,
    materializeLibraryVideoToWorkspace: mocks.materializeLibraryVideoToWorkspace,
    copyLibraryVideoToScope: mocks.copyLibraryVideoToScope,
    deleteLibraryVideoObject: mocks.deleteLibraryVideoObject,
}))

import { mediaLibrarySubjects } from './media-library-subjects.ts'

const SUBJECTS = NATS_SUBJECTS.WORKSPACE_SUBJECTS.MEDIA_LIBRARY_SUBJECTS

const getHandler = (subject: string) =>
    mediaLibrarySubjects.find((subscription) => subscription.subject === subject)!.handler

const item: MediaLibraryImageItem = {
    itemId: 'library-item-1',
    version: 1,
    kind: 'image',
    displayName: 'saved.png',
    ownerUserId: 'user-1',
    originWorkspaceId: 'workspace-1',
    sourceFileId: 'file-1',
    scope: 'workspace',
    scopeOwnerId: 'workspace-1',
    scopeAndOwner: 'workspace#workspace-1',
    status: 'active',
    asset: {
        bucketName: 'media-library-workspace-workspace-1-files',
        objectKey: 'library-item-1',
        mimeType: 'image/png',
        byteSize: 10,
        originalName: 'saved.png',
    },
    image: { width: 100, height: 80, aspectRatio: 1.25 },
    createdAt: 1,
    updatedAt: 1,
}

describe('Media Library NATS image lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.workspace.getWorkspace.mockResolvedValue({ workspaceId: 'workspace-1' })
        mocks.workspace.getUserWorkspaces.mockResolvedValue([{ workspaceId: 'workspace-1' }])
        mocks.organization.getUserOrganizations.mockResolvedValue([])
        mocks.copyWorkspaceImageToLibrary.mockResolvedValue({
            itemId: item.itemId,
            displayName: item.displayName,
            asset: item.asset,
            image: item.image,
        })
        mocks.mediaLibraryItem.createImageItem.mockResolvedValue(item)
        mocks.mediaLibraryItem.findActiveWorkspaceImageBySource.mockResolvedValue(undefined)
        mocks.mediaLibraryItem.getImageItem.mockResolvedValue(item)
        mocks.mediaLibraryItem.getOwnedImageItem.mockResolvedValue(item)
        // After Phase 8, image-kind subjects route through the kind-agnostic
        // getAnyItem / getOwnedAnyItem so they can serve videos too. Return the
        // same image fixture for both so the existing image lifecycle tests
        // still pass.
        mocks.mediaLibraryItem.getAnyItem.mockResolvedValue(item)
        mocks.mediaLibraryItem.getOwnedAnyItem.mockResolvedValue(item)
        mocks.materializeLibraryImageToWorkspace.mockResolvedValue({
            fileId: 'fresh-file-1',
            url: '/api/images/workspace-1/fresh-file-1',
            isDuplicate: false,
            size: 10,
            mimeType: 'image/png',
        })
        mocks.copyLibraryImageToScope.mockResolvedValue({
            ...item.asset,
            bucketName: 'media-library-user-user-1-files',
        })
    })

    it('creates a workspace-scoped saved item from an independently copied canvas image', async () => {
        const result = await getHandler(SUBJECTS.CREATE_FROM_IMAGE)({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            fileId: 'file-1',
        })

        expect(mocks.copyWorkspaceImageToLibrary).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            fileId: 'file-1',
            scope: 'workspace',
            scopeOwnerId: 'workspace-1',
        })
        expect(mocks.mediaLibraryItem.createImageItem).toHaveBeenCalledWith(expect.objectContaining({
            itemId: item.itemId,
            scope: 'workspace',
            scopeOwnerId: 'workspace-1',
            sourceFileId: 'file-1',
        }))
        expect(result).toEqual(expect.objectContaining({ success: true, itemId: item.itemId }))
    })

    it('reuses an existing saved item instead of copying the same source image again', async () => {
        mocks.mediaLibraryItem.findActiveWorkspaceImageBySource.mockResolvedValueOnce(item)

        const result = await getHandler(SUBJECTS.CREATE_FROM_IMAGE)({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            fileId: 'file-1',
        })

        expect(mocks.copyWorkspaceImageToLibrary).not.toHaveBeenCalled()
        expect(mocks.mediaLibraryItem.createImageItem).not.toHaveBeenCalled()
        expect(mocks.publish).not.toHaveBeenCalled()
        expect(result).toEqual(expect.objectContaining({
            success: true,
            deduplicated: true,
            itemId: item.itemId,
        }))
    })

    it('materializes a saved item as a fresh workspace object before canvas insertion', async () => {
        const result = await getHandler(SUBJECTS.MATERIALIZE_IMAGE_TO_WORKSPACE)({
            user: { userId: 'user-1' },
            itemId: item.itemId,
            workspaceId: 'workspace-1',
        })

        expect(mocks.materializeLibraryImageToWorkspace).toHaveBeenCalledWith({
            item,
            workspaceId: 'workspace-1',
        })
        expect(result).toEqual(expect.objectContaining({
            fileId: 'fresh-file-1',
            itemId: item.itemId,
        }))
    })

    it('retains a copied destination object when scope metadata update fails', async () => {
        mocks.mediaLibraryItem.changeScope.mockRejectedValueOnce(new Error('metadata write failed'))

        await expect(getHandler(SUBJECTS.CHANGE_SCOPE)({
            user: { userId: 'user-1' },
            itemId: item.itemId,
            workspaceId: 'workspace-1',
            newScope: 'user',
        })).rejects.toThrow('metadata write failed')

        expect(mocks.copyLibraryImageToScope).toHaveBeenCalled()
        expect(mocks.deleteLibraryImageObject).not.toHaveBeenCalled()
        expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('retaining copied object'))
    })
})
