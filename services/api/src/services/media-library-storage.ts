'use strict'

import sharp from 'sharp'
import { v4 as uuid } from 'uuid'

import NATS_Service from '@lixpi/nats-service'
import {
    MEDIA_LIBRARY_SCOPE,
    type DocumentFile,
    type MediaLibraryAssetRef,
    type MediaLibraryImageData,
    type MediaLibraryImageItem,
    type MediaLibraryScope,
} from '@lixpi/constants'

import Workspace from '../models/workspace.ts'
import { storeWorkspaceImage, type StoreImageResult } from './image-storage.ts'

const getMediaLibraryBucketName = (scope: MediaLibraryScope, scopeOwnerId: string): string =>
    scope === MEDIA_LIBRARY_SCOPE.PUBLIC
        ? 'media-library-public-files'
        : `media-library-${scope}-${scopeOwnerId}-files`

const getStorageService = (): NATS_Service => {
    const natsService = NATS_Service.getInstance()
    if (!natsService) {
        throw new Error('NATS service unavailable')
    }
    return natsService
}

const getImageDimensions = async (data: Uint8Array): Promise<MediaLibraryImageData> => {
    const metadata = await sharp(Buffer.from(data)).metadata()
    if (!metadata.width || !metadata.height) {
        throw new Error('Stored image has no intrinsic dimensions')
    }
    return {
        width: metadata.width,
        height: metadata.height,
        aspectRatio: metadata.width / metadata.height,
    }
}

export type CopiedLibraryImage = {
    itemId: string
    asset: MediaLibraryAssetRef
    image: MediaLibraryImageData
    displayName: string
}

export const copyWorkspaceImageToLibrary = async ({
    workspaceId,
    fileId,
    scope,
    scopeOwnerId,
}: {
    workspaceId: string
    fileId: string
    scope: MediaLibraryScope
    scopeOwnerId: string
}): Promise<CopiedLibraryImage> => {
    const workspace = await Workspace.getWorkspaceInternal({ workspaceId })
    const sourceFile = workspace?.files?.find((file: DocumentFile) => file.id === fileId)
    if (!sourceFile) {
        throw new Error('Canvas image is not backed by a stored workspace object')
    }

    const natsService = getStorageService()
    const sourceBucket = Workspace.getBucketName(workspaceId)
    const sourceData = await natsService.getObject(sourceBucket, fileId)
    if (!sourceData) {
        throw new Error('Canvas image object not found')
    }
    const image = await getImageDimensions(sourceData)

    const itemId = uuid()
    const destinationBucket = getMediaLibraryBucketName(scope, scopeOwnerId)
    const sourceStream = await natsService.getObjectStream(sourceBucket, fileId)
    if (!sourceStream) {
        throw new Error('Canvas image object stream not found')
    }
    await natsService.putObjectFromReadable(destinationBucket, itemId, sourceStream, {
        name: itemId,
        description: sourceFile.name,
    })

    return {
        itemId,
        displayName: sourceFile.name,
        asset: {
            bucketName: destinationBucket,
            objectKey: itemId,
            mimeType: sourceFile.mimeType,
            byteSize: sourceData.length,
            originalName: sourceFile.name,
        },
        image,
    }
}

export const materializeLibraryImageToWorkspace = async ({
    item,
    workspaceId,
}: {
    item: MediaLibraryImageItem
    workspaceId: string
}): Promise<StoreImageResult> => {
    const natsService = getStorageService()
    const data = await natsService.getObject(item.asset.bucketName, item.asset.objectKey)
    if (!data) {
        throw new Error('Media Library image object not found')
    }
    return storeWorkspaceImage({
        workspaceId,
        buffer: Buffer.from(data),
        originalName: item.asset.originalName,
        mimeType: item.asset.mimeType,
    })
}

export const copyLibraryImageToScope = async ({
    item,
    newScope,
    newScopeOwnerId,
}: {
    item: MediaLibraryImageItem
    newScope: MediaLibraryScope
    newScopeOwnerId: string
}): Promise<MediaLibraryAssetRef> => {
    const natsService = getStorageService()
    const destinationBucket = getMediaLibraryBucketName(newScope, newScopeOwnerId)
    const sourceStream = await natsService.getObjectStream(item.asset.bucketName, item.asset.objectKey)
    if (!sourceStream) {
        throw new Error('Media Library image object not found')
    }
    await natsService.putObjectFromReadable(destinationBucket, item.itemId, sourceStream, {
        name: item.itemId,
        description: item.asset.originalName,
    })
    return {
        ...item.asset,
        bucketName: destinationBucket,
        objectKey: item.itemId,
    }
}

export const deleteLibraryImageObject = async (item: MediaLibraryImageItem): Promise<void> => {
    await getStorageService().deleteObject(item.asset.bucketName, item.asset.objectKey)
}

export const deleteMediaLibraryWorkspaceBucket = async (workspaceId: string): Promise<void> => {
    await getStorageService().deleteObjectStore(getMediaLibraryBucketName(MEDIA_LIBRARY_SCOPE.WORKSPACE, workspaceId))
}
