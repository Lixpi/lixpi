'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NATS_SUBJECTS, type MediaLibraryImageItem } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    publish: vi.fn(),
    warn: vi.fn(),
    workspace: {
        getWorkspace: vi.fn(),
    },
    organization: {
        getUserOrganizations: vi.fn(),
    },
    mediaLibraryItem: {
        createImageItem: vi.fn(),
        getImageItem: vi.fn(),
        getAnyItem: vi.fn(),
        listAvailable: vi.fn(),
        deleteImageItem: vi.fn(),
        findActiveOrgImageBySource: vi.fn(),
        createVideoItem: vi.fn(),
        getVideoItem: vi.fn(),
        deleteVideoItem: vi.fn(),
        findActiveOrgVideoBySource: vi.fn(),
    },
    copyWorkspaceImageToLibrary: vi.fn(),
    materializeLibraryImageToWorkspace: vi.fn(),
    deleteLibraryImageObject: vi.fn(),
    copyWorkspaceVideoToLibrary: vi.fn(),
    materializeLibraryVideoToWorkspace: vi.fn(),
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
    deleteLibraryImageObject: mocks.deleteLibraryImageObject,
    copyWorkspaceVideoToLibrary: mocks.copyWorkspaceVideoToLibrary,
    materializeLibraryVideoToWorkspace: mocks.materializeLibraryVideoToWorkspace,
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
    scope: 'organization',
    scopeOwnerId: 'organization-1',
    scopeAndOwner: 'organization#organization-1',
    status: 'active',
    asset: {
        bucketName: 'media-library-organization-organization-1-files',
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
        // Org is resolved server-side from the user, never taken from the client.
        mocks.organization.getUserOrganizations.mockResolvedValue([{ organizationId: 'organization-1' }])
        mocks.copyWorkspaceImageToLibrary.mockResolvedValue({
            itemId: item.itemId,
            displayName: item.displayName,
            asset: item.asset,
            image: item.image,
        })
        mocks.mediaLibraryItem.createImageItem.mockResolvedValue(item)
        mocks.mediaLibraryItem.findActiveOrgImageBySource.mockResolvedValue(undefined)
        mocks.mediaLibraryItem.getImageItem.mockResolvedValue(item)
        mocks.mediaLibraryItem.getAnyItem.mockResolvedValue(item)
        mocks.mediaLibraryItem.deleteImageItem.mockResolvedValue(undefined)
        mocks.deleteLibraryImageObject.mockResolvedValue(undefined)
        mocks.deleteLibraryVideoObject.mockResolvedValue(undefined)
        mocks.materializeLibraryImageToWorkspace.mockResolvedValue({
            fileId: 'fresh-file-1',
            url: '/api/images/workspace-1/fresh-file-1',
            isDuplicate: false,
            size: 10,
            mimeType: 'image/png',
        })
    })

    it('creates an org-scoped saved item from an independently copied canvas image', async () => {
        const result = await getHandler(SUBJECTS.CREATE_FROM_IMAGE)({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            fileId: 'file-1',
        })

        expect(mocks.copyWorkspaceImageToLibrary).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            fileId: 'file-1',
            scope: 'organization',
            scopeOwnerId: 'organization-1',
        })
        expect(mocks.mediaLibraryItem.createImageItem).toHaveBeenCalledWith(expect.objectContaining({
            itemId: item.itemId,
            scope: 'organization',
            scopeOwnerId: 'organization-1',
            originWorkspaceId: 'workspace-1',
            sourceFileId: 'file-1',
        }))
        expect(result).toEqual(expect.objectContaining({ success: true, itemId: item.itemId }))
    })

    it('reuses an existing org item instead of copying the same source image again', async () => {
        mocks.mediaLibraryItem.findActiveOrgImageBySource.mockResolvedValueOnce(item)

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

    it('fails to save when the user has no associated organization', async () => {
        mocks.organization.getUserOrganizations.mockResolvedValueOnce([])

        const result = await getHandler(SUBJECTS.CREATE_FROM_IMAGE)({
            user: { userId: 'user-1' },
            workspaceId: 'workspace-1',
            fileId: 'file-1',
        })

        expect(result).toEqual({ error: 'ORGANIZATION_ACCESS_DENIED' })
        expect(mocks.copyWorkspaceImageToLibrary).not.toHaveBeenCalled()
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

    it('lets any member of the owning organization delete an item', async () => {
        // A different user (user-2) in the same org can delete — getAnyItem gates on org membership.
        const result = await getHandler(SUBJECTS.DELETE)({
            user: { userId: 'user-2' },
            itemId: item.itemId,
        })

        expect(mocks.mediaLibraryItem.deleteImageItem).toHaveBeenCalledWith({ item })
        expect(mocks.publish).toHaveBeenCalledWith(SUBJECTS.EVENTS.DELETED, { type: 'deleted', itemId: item.itemId })
        expect(result).toEqual({ success: true, itemId: item.itemId })
    })

    it('does not delete an item the requester cannot read (other org)', async () => {
        mocks.mediaLibraryItem.getAnyItem.mockResolvedValueOnce({ error: 'PERMISSION_DENIED' })

        const result = await getHandler(SUBJECTS.DELETE)({
            user: { userId: 'user-2' },
            itemId: item.itemId,
        })

        expect(result).toEqual({ error: 'PERMISSION_DENIED' })
        expect(mocks.mediaLibraryItem.deleteImageItem).not.toHaveBeenCalled()
    })
})
