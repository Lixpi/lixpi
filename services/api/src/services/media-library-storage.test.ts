'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MediaLibraryImageItem } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    getWorkspaceInternal: vi.fn(),
    getObject: vi.fn(),
    getObjectStream: vi.fn(),
    putObjectFromReadable: vi.fn(),
    deleteObject: vi.fn(),
    deleteObjectStore: vi.fn(),
    storeWorkspaceImage: vi.fn(),
}))

vi.mock('@lixpi/nats-service', () => ({
    default: {
        getInstance: () => ({
            getObject: mocks.getObject,
            getObjectStream: mocks.getObjectStream,
            putObjectFromReadable: mocks.putObjectFromReadable,
            deleteObject: mocks.deleteObject,
            deleteObjectStore: mocks.deleteObjectStore,
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

import {
    copyLibraryImageToScope,
    copyWorkspaceImageToLibrary,
    deleteMediaLibraryWorkspaceBucket,
    materializeLibraryImageToWorkspace,
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
    scope: 'workspace',
    scopeOwnerId: 'workspace-1',
    scopeAndOwner: 'workspace#workspace-1',
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

describe('Media Library storage ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.getWorkspaceInternal.mockResolvedValue({
            files: [{
                id: 'source-file-1',
                name: 'saved.png',
                mimeType: 'image/png',
                size: pngBytes.length,
            }],
        })
        mocks.getObject.mockResolvedValue(pngBytes)
        mocks.getObjectStream.mockResolvedValue({ readable: true })
        mocks.putObjectFromReadable.mockResolvedValue(undefined)
        mocks.storeWorkspaceImage.mockResolvedValue({
            fileId: 'restored-file-1',
            url: '/api/images/workspace-2/restored-file-1',
            isDuplicate: false,
            size: pngBytes.length,
            mimeType: 'image/png',
        })
    })

    it('saves a canvas image into an independent workspace-scoped library object', async () => {
        const copied = await copyWorkspaceImageToLibrary({
            workspaceId: 'workspace-1',
            fileId: 'source-file-1',
            scope: 'workspace',
            scopeOwnerId: 'workspace-1',
        })

        expect(copied.itemId).not.toBe('source-file-1')
        expect(copied.image).toEqual({ width: 1, height: 1, aspectRatio: 1 })
        expect(copied.asset.bucketName).toBe('media-library-workspace-workspace-1-files')
        expect(copied.asset.objectKey).toBe(copied.itemId)
        expect(mocks.putObjectFromReadable).toHaveBeenCalledWith(
            'media-library-workspace-workspace-1-files',
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

    it('copies an item to its new scope bucket and deletes workspace scope buckets explicitly', async () => {
        const item = makeItem()
        const asset = await copyLibraryImageToScope({
            item,
            newScope: 'user',
            newScopeOwnerId: 'user-1',
        })

        expect(asset.bucketName).toBe('media-library-user-user-1-files')
        expect(mocks.putObjectFromReadable).toHaveBeenCalledWith(
            'media-library-user-user-1-files',
            item.itemId,
            { readable: true },
            { name: item.itemId, description: 'saved.png' }
        )

        await deleteMediaLibraryWorkspaceBucket('workspace-1')
        expect(mocks.deleteObjectStore).toHaveBeenCalledWith('media-library-workspace-workspace-1-files')
    })
})
