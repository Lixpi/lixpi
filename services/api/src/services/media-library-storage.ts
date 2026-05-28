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
    type MediaLibraryVideoData,
    type MediaLibraryVideoItem,
} from '@lixpi/constants'

import Workspace from '../models/workspace.ts'
import { storeWorkspaceImage, type StoreImageResult } from './image-storage.ts'
import { storeWorkspaceVideo, type StoreVideoResult } from './video-storage.ts'

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

// =============================================================================
// VIDEO HELPERS
// =============================================================================

export type CopiedLibraryVideo = {
    itemId: string
    asset: MediaLibraryAssetRef
    poster?: MediaLibraryAssetRef
    video: MediaLibraryVideoData
    displayName: string
    sourcePosterFileId?: string
}

const probeImageDimensionsBestEffort = async (data: Uint8Array): Promise<{ width: number; height: number } | undefined> => {
    try {
        const metadata = await sharp(Buffer.from(data)).metadata()
        if (metadata.width && metadata.height) {
            return { width: metadata.width, height: metadata.height }
        }
    } catch { /* best-effort */ }
    return undefined
}

export const copyWorkspaceVideoToLibrary = async ({
    workspaceId,
    fileId,
    posterFileId,
    durationSeconds,
    aspectRatio,
    hasAudio,
    scope,
    scopeOwnerId,
}: {
    workspaceId: string
    fileId: string
    posterFileId?: string
    durationSeconds: number
    aspectRatio: number
    hasAudio: boolean
    scope: MediaLibraryScope
    scopeOwnerId: string
}): Promise<CopiedLibraryVideo> => {
    const workspace = await Workspace.getWorkspaceInternal({ workspaceId })
    const sourceFile = workspace?.files?.find((file: DocumentFile) => file.id === fileId)
    if (!sourceFile) {
        throw new Error('Canvas video is not backed by a stored workspace object')
    }

    const natsService = getStorageService()
    const sourceBucket = Workspace.getBucketName(workspaceId)
    // MP4 may be large — use a metadata-only check first so we don't pull the
    // whole buffer into memory just to validate existence.
    const sourceData = await natsService.getObject(sourceBucket, fileId)
    if (!sourceData) {
        throw new Error('Canvas video object not found')
    }

    const itemId = uuid()
    const destinationBucket = getMediaLibraryBucketName(scope, scopeOwnerId)
    const videoStream = await natsService.getObjectStream(sourceBucket, fileId)
    if (!videoStream) {
        throw new Error('Canvas video object stream not found')
    }
    await natsService.putObjectFromReadable(destinationBucket, itemId, videoStream, {
        name: itemId,
        description: sourceFile.name,
    })

    // Poster is optional — if ffmpeg never extracted one we still want the
    // MP4 saved. If it exists, copy it under a separate "{itemId}-poster" key.
    let poster: MediaLibraryAssetRef | undefined
    if (posterFileId) {
        const posterFile = workspace?.files?.find((file: DocumentFile) => file.id === posterFileId)
        const posterData = await natsService.getObject(sourceBucket, posterFileId)
        if (posterFile && posterData) {
            const posterStream = await natsService.getObjectStream(sourceBucket, posterFileId)
            if (posterStream) {
                const posterKey = `${itemId}-poster`
                await natsService.putObjectFromReadable(destinationBucket, posterKey, posterStream, {
                    name: posterKey,
                    description: posterFile.name,
                })
                poster = {
                    bucketName: destinationBucket,
                    objectKey: posterKey,
                    mimeType: posterFile.mimeType,
                    byteSize: posterData.length,
                    originalName: posterFile.name,
                }
            }
        }
    }

    // Best-effort intrinsic dimensions from the poster (we never decoded MP4
    // for w/h before — VEO returned aspect but not absolute pixel counts).
    let width: number | undefined
    let height: number | undefined
    if (poster) {
        const posterData = await natsService.getObject(poster.bucketName, poster.objectKey)
        if (posterData) {
            const probed = await probeImageDimensionsBestEffort(posterData)
            if (probed) {
                width = probed.width
                height = probed.height
            }
        }
    }

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
        poster,
        video: {
            durationSeconds,
            aspectRatio,
            hasAudio,
            ...(typeof width === 'number' ? { width } : {}),
            ...(typeof height === 'number' ? { height } : {}),
        },
        sourcePosterFileId: posterFileId,
    }
}

export const materializeLibraryVideoToWorkspace = async ({
    item,
    workspaceId,
}: {
    item: MediaLibraryVideoItem
    workspaceId: string
}): Promise<{ video: StoreVideoResult; poster?: StoreImageResult }> => {
    const natsService = getStorageService()
    const videoData = await natsService.getObject(item.asset.bucketName, item.asset.objectKey)
    if (!videoData) {
        throw new Error('Media Library video object not found')
    }
    const video = await storeWorkspaceVideo({
        workspaceId,
        buffer: Buffer.from(videoData),
        originalName: item.asset.originalName,
        mimeType: item.asset.mimeType,
    })
    let poster: StoreImageResult | undefined
    if (item.poster) {
        const posterData = await natsService.getObject(item.poster.bucketName, item.poster.objectKey)
        if (posterData) {
            poster = await storeWorkspaceImage({
                workspaceId,
                buffer: Buffer.from(posterData),
                originalName: item.poster.originalName,
                mimeType: item.poster.mimeType,
            })
        }
    }
    return { video, poster }
}

export const copyLibraryVideoToScope = async ({
    item,
    newScope,
    newScopeOwnerId,
}: {
    item: MediaLibraryVideoItem
    newScope: MediaLibraryScope
    newScopeOwnerId: string
}): Promise<{ asset: MediaLibraryAssetRef; poster?: MediaLibraryAssetRef }> => {
    const natsService = getStorageService()
    const destinationBucket = getMediaLibraryBucketName(newScope, newScopeOwnerId)
    const videoStream = await natsService.getObjectStream(item.asset.bucketName, item.asset.objectKey)
    if (!videoStream) {
        throw new Error('Media Library video object not found')
    }
    await natsService.putObjectFromReadable(destinationBucket, item.itemId, videoStream, {
        name: item.itemId,
        description: item.asset.originalName,
    })

    let poster: MediaLibraryAssetRef | undefined
    if (item.poster) {
        const posterStream = await natsService.getObjectStream(item.poster.bucketName, item.poster.objectKey)
        if (posterStream) {
            const posterKey = `${item.itemId}-poster`
            await natsService.putObjectFromReadable(destinationBucket, posterKey, posterStream, {
                name: posterKey,
                description: item.poster.originalName,
            })
            poster = {
                ...item.poster,
                bucketName: destinationBucket,
                objectKey: posterKey,
            }
        }
    }

    return {
        asset: {
            ...item.asset,
            bucketName: destinationBucket,
            objectKey: item.itemId,
        },
        poster,
    }
}

export const deleteLibraryVideoObject = async (item: MediaLibraryVideoItem): Promise<void> => {
    await getStorageService().deleteObject(item.asset.bucketName, item.asset.objectKey)
    if (item.poster) {
        await getStorageService().deleteObject(item.poster.bucketName, item.poster.objectKey).catch(() => {})
    }
}
