'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MediaLibraryImageItem, MediaLibraryVideoItem } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    getWorkspaceInternal: vi.fn(),
    getObject: vi.fn(),
    getObjectStream: vi.fn(),
    putObjectFromReadable: vi.fn(),
    deleteObject: vi.fn(),
    deleteObjectStore: vi.fn(),
    getObjectStore: vi.fn(),
    createObjectStore: vi.fn(),
    storeWorkspaceImage: vi.fn(),
    storeWorkspaceVideo: vi.fn(),
}))

vi.mock('@lixpi/nats-service', () => ({
    default: {
        getInstance: () => ({
            getObject: mocks.getObject,
            getObjectStream: mocks.getObjectStream,
            putObjectFromReadable: mocks.putObjectFromReadable,
            deleteObject: mocks.deleteObject,
            deleteObjectStore: mocks.deleteObjectStore,
            getObjectStore: mocks.getObjectStore,
            createObjectStore: mocks.createObjectStore,
        }),
    },
}))

vi.mock('../models/workspace.ts', () => ({
    default: {
        getWorkspaceInternal: mocks.getWorkspaceInternal,
        getBucketName: (workspaceId: string) => `workspace-${workspaceId}-files`,
    },
}))

vi.mock('./image-storage.ts', () => ({
    storeWorkspaceImage: mocks.storeWorkspaceImage,
}))

vi.mock('./video-storage.ts', () => ({
    storeWorkspaceVideo: mocks.storeWorkspaceVideo,
}))

import {
    copyWorkspaceVideoToLibrary,
    copyWorkspaceImageToLibrary,
    materializeLibraryImageToWorkspace,
    materializeLibraryVideoToWorkspace,
} from './media-library-storage.ts'

const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
)

const makeItem = (): MediaLibraryImageItem => ({
    itemId: 'library-item-1',
    version: 1,
    kind: 'image',
    displayName: 'saved.png',
    ownerUserId: 'user-1',
    originWorkspaceId: 'workspace-1',
    sourceFileId: 'source-file-1',
    scope: 'organization',
    scopeOwnerId: 'organization-1',
    scopeAndOwner: 'organization#organization-1',
    status: 'active',
    asset: {
        bucketName: 'media-library-workspace-workspace-1-files',
        objectKey: 'library-item-1',
        mimeType: 'image/png',
        byteSize: pngBytes.length,
        originalName: 'saved.png',
    },
    image: { width: 1, height: 1, aspectRatio: 1 },
    createdAt: 1,
    updatedAt: 1,
})

const makeVideoItem = (): MediaLibraryVideoItem => ({
    itemId: 'library-video-1',
    version: 1,
    kind: 'video',
    displayName: 'saved.mp4',
    ownerUserId: 'user-1',
    originWorkspaceId: 'workspace-1',
    sourceFileId: 'source-video-1',
    sourcePosterFileId: 'source-poster-1',
    scope: 'organization',
    scopeOwnerId: 'organization-1',
    scopeAndOwner: 'organization#organization-1',
    status: 'active',
    asset: {
        bucketName: 'media-library-workspace-workspace-1-files',
        objectKey: 'library-video-1',
        mimeType: 'video/mp4',
        byteSize: pngBytes.length,
        originalName: 'saved.mp4',
    },
    poster: {
        bucketName: 'media-library-workspace-workspace-1-files',
        objectKey: 'library-video-1-poster',
        mimeType: 'image/png',
        byteSize: pngBytes.length,
        originalName: 'saved-poster.png',
    },
    video: { durationSeconds: 4, aspectRatio: 1, hasAudio: false },
    createdAt: 1,
    updatedAt: 1,
})

describe('Media Library storage ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.getWorkspaceInternal.mockResolvedValue({
            files: [{
                id: 'source-file-1',
                name: 'saved.png',
                mimeType: 'image/png',
                size: pngBytes.length,
            }, {
                id: 'source-video-1',
                name: 'saved.mp4',
                mimeType: 'video/mp4',
                size: pngBytes.length,
            }, {
                id: 'source-poster-1',
                name: 'saved-poster.png',
                mimeType: 'image/png',
                size: pngBytes.length,
            }],
        })
        mocks.getObject.mockResolvedValue(pngBytes)
        mocks.getObjectStream.mockResolvedValue({ readable: true })
        mocks.putObjectFromReadable.mockResolvedValue(undefined)
        // Destination org bucket already exists, so no on-demand creation is needed.
        mocks.getObjectStore.mockResolvedValue({})
        mocks.createObjectStore.mockResolvedValue({})
        mocks.storeWorkspaceImage.mockResolvedValue({
            fileId: 'restored-file-1',
            url: '/api/images/workspace-2/restored-file-1',
            isDuplicate: false,
            size: pngBytes.length,
            mimeType: 'image/png',
        })
        mocks.storeWorkspaceVideo.mockResolvedValue({
            fileId: 'restored-video-1',
            url: '/api/videos/workspace-2/restored-video-1',
            isDuplicate: false,
            size: pngBytes.length,
            mimeType: 'video/mp4',
        })
    })

    it('saves a canvas image into an independent org-scoped library object', async () => {
        const copied = await copyWorkspaceImageToLibrary({
            workspaceId: 'workspace-1',
            fileId: 'source-file-1',
            scope: 'organization',
            scopeOwnerId: 'organization-1',
        })

        expect(copied.itemId).not.toBe('source-file-1')
        expect(copied.image).toEqual({ width: 1, height: 1, aspectRatio: 1 })
        expect(copied.asset.bucketName).toBe('media-library-organization-organization-1-files')
        expect(copied.asset.objectKey).toBe(copied.itemId)
        expect(mocks.putObjectFromReadable).toHaveBeenCalledWith(
            'media-library-organization-organization-1-files',
            copied.itemId,
            { readable: true },
            { name: copied.itemId, description: 'saved.png' }
        )
    })

    it('restores a saved image through the existing workspace image storage path', async () => {
        const item = makeItem()
        await materializeLibraryImageToWorkspace({ item, workspaceId: 'workspace-2' })

        expect(mocks.storeWorkspaceImage).toHaveBeenCalledWith({
            workspaceId: 'workspace-2',
            buffer: pngBytes,
            originalName: 'saved.png',
            mimeType: 'image/png',
        })
    })

    it('creates the destination org bucket on demand before saving', async () => {
        mocks.getObjectStore.mockRejectedValueOnce(new Error('object store not found'))

        await copyWorkspaceImageToLibrary({
            workspaceId: 'workspace-1',
            fileId: 'source-file-1',
            scope: 'organization',
            scopeOwnerId: 'organization-1',
        })

        expect(mocks.createObjectStore).toHaveBeenCalledWith(
            'media-library-organization-organization-1-files',
            expect.objectContaining({ description: expect.any(String) }),
        )
    })

    it('saves a canvas video and its poster into independent org-scoped library objects', async () => {
        const copied = await copyWorkspaceVideoToLibrary({
            workspaceId: 'workspace-1',
            fileId: 'source-video-1',
            posterFileId: 'source-poster-1',
            durationSeconds: 4,
            aspectRatio: 1,
            hasAudio: false,
            scope: 'organization',
            scopeOwnerId: 'organization-1',
        })

        expect(copied.itemId).not.toBe('source-video-1')
        expect(copied.asset.bucketName).toBe('media-library-organization-organization-1-files')
        expect(copied.asset.objectKey).toBe(copied.itemId)
        expect(copied.poster).toEqual(expect.objectContaining({
            bucketName: 'media-library-organization-organization-1-files',
            objectKey: `${copied.itemId}-poster`,
            originalName: 'saved-poster.png',
        }))
        expect(mocks.putObjectFromReadable).toHaveBeenCalledWith(
            'media-library-organization-organization-1-files',
            copied.itemId,
            { readable: true },
            { name: copied.itemId, description: 'saved.mp4' }
        )
        expect(mocks.putObjectFromReadable).toHaveBeenCalledWith(
            'media-library-organization-organization-1-files',
            `${copied.itemId}-poster`,
            { readable: true },
            { name: `${copied.itemId}-poster`, description: 'saved-poster.png' }
        )
    })

    it('restores a saved video through the existing workspace video and poster storage paths', async () => {
        const item = makeVideoItem()
        await materializeLibraryVideoToWorkspace({ item, workspaceId: 'workspace-2' })

        expect(mocks.storeWorkspaceVideo).toHaveBeenCalledWith({
            workspaceId: 'workspace-2',
            buffer: pngBytes,
            originalName: 'saved.mp4',
            mimeType: 'video/mp4',
        })
        expect(mocks.storeWorkspaceImage).toHaveBeenCalledWith({
            workspaceId: 'workspace-2',
            buffer: pngBytes,
            originalName: 'saved-poster.png',
            mimeType: 'image/png',
        })
    })
})
