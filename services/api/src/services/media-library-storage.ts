'use strict'

import sharp from 'sharp'
import { v4 as uuid } from 'uuid'

import NATS_Service from '@lixpi/nats-service'
import {
    type DocumentFile,
    type MediaLibraryAssetRef,
    type MediaLibraryImageData,
    type MediaLibraryImageItem,
    type MediaLibraryScope,
    type MediaLibraryVideoData,
    type MediaLibraryVideoItem,
    type MediaLibraryAudioItem,
    type MediaLibraryDocumentItem,
} from '@lixpi/constants'

import Workspace from '../models/workspace.ts'
import { storeWorkspaceImage, storeWorkspaceVideo } from './store-media-adapters.ts'
import { storeWorkspaceFile, type StoreFileResult } from './file-storage.ts'

const getMediaLibraryBucketName = (scope: MediaLibraryScope, scopeOwnerId: string): string =>
    `media-library-${scope}-${scopeOwnerId}-files`

const getStorageService = (): NATS_Service => {
    const natsService = NATS_Service.getInstance()
    if (!natsService) {
        throw new Error('NATS service unavailable')
    }
    return natsService
}

// Org-scoped media buckets are created on demand (the first time anything is saved
// into an organization) rather than up front, since orgs are not tied to a single
// workspace lifecycle. open() rejects when the bucket is missing, so we create it then.
const ensureMediaLibraryBucket = async (natsService: NATS_Service, bucketName: string): Promise<void> => {
    try {
        await natsService.getObjectStore(bucketName)
    } catch {
        await natsService.createObjectStore(bucketName, {
            description: `Media Library files for ${bucketName}`,
        }).catch(() => {})
    }
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
    await ensureMediaLibraryBucket(natsService, destinationBucket)
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
}): Promise<StoreFileResult> => {
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

export const deleteLibraryImageObject = async (item: MediaLibraryImageItem): Promise<void> => {
    await getStorageService().deleteObject(item.asset.bucketName, item.asset.objectKey)
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
    await ensureMediaLibraryBucket(natsService, destinationBucket)
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
}): Promise<{ video: StoreFileResult; poster?: StoreFileResult }> => {
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
    let poster: StoreFileResult | undefined
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

export const deleteLibraryVideoObject = async (item: MediaLibraryVideoItem): Promise<void> => {
    await getStorageService().deleteObject(item.asset.bucketName, item.asset.objectKey)
    if (item.poster) {
        await getStorageService().deleteObject(item.poster.bucketName, item.poster.objectKey).catch(() => {})
    }
}

// =============================================================================
// AUDIO HELPERS
// =============================================================================

export type CopiedLibraryAudio = {
    itemId: string
    asset: MediaLibraryAssetRef
    audio: { durationSeconds: number; hasAudio: true }
    displayName: string
}

export const copyWorkspaceAudioToLibrary = async ({
    workspaceId,
    fileId,
    durationSeconds,
    scope,
    scopeOwnerId,
}: {
    workspaceId: string
    fileId: string
    durationSeconds: number
    scope: MediaLibraryScope
    scopeOwnerId: string
}): Promise<CopiedLibraryAudio> => {
    const workspace = await Workspace.getWorkspaceInternal({ workspaceId })
    const sourceFile = workspace?.files?.find((file: DocumentFile) => file.id === fileId)
    if (!sourceFile) {
        throw new Error('Canvas audio is not backed by a stored workspace object')
    }

    const natsService = getStorageService()
    const sourceBucket = Workspace.getBucketName(workspaceId)
    const sourceData = await natsService.getObject(sourceBucket, fileId)
    if (!sourceData) {
        throw new Error('Canvas audio object not found')
    }

    const itemId = uuid()
    const destinationBucket = getMediaLibraryBucketName(scope, scopeOwnerId)
    await ensureMediaLibraryBucket(natsService, destinationBucket)
    const sourceStream = await natsService.getObjectStream(sourceBucket, fileId)
    if (!sourceStream) {
        throw new Error('Canvas audio object stream not found')
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
        audio: { durationSeconds, hasAudio: true },
    }
}

export const materializeLibraryAudioToWorkspace = async ({
    item,
    workspaceId,
}: {
    item: MediaLibraryAudioItem
    workspaceId: string
}): Promise<StoreFileResult> => {
    const natsService = getStorageService()
    const data = await natsService.getObject(item.asset.bucketName, item.asset.objectKey)
    if (!data) {
        throw new Error('Media Library audio object not found')
    }
    return storeWorkspaceFile({
        workspaceId,
        buffer: Buffer.from(data),
        originalName: item.asset.originalName,
        mimeType: item.asset.mimeType,
        kind: 'audio',
        modelSafe: true,
    })
}

export const deleteLibraryAudioObject = async (item: MediaLibraryAudioItem): Promise<void> => {
    await getStorageService().deleteObject(item.asset.bucketName, item.asset.objectKey)
}

// =============================================================================
// DOCUMENT HELPERS
// =============================================================================

export type CopiedLibraryDocument = {
    itemId: string
    asset: MediaLibraryAssetRef
    poster?: MediaLibraryAssetRef
    document: { pageCount?: number; aspectRatio: number }
    displayName: string
    sourcePosterFileId?: string
}

export const copyWorkspaceDocumentToLibrary = async ({
    workspaceId,
    fileId,
    posterFileId,
    pageCount,
    aspectRatio,
    scope,
    scopeOwnerId,
}: {
    workspaceId: string
    fileId: string
    posterFileId?: string
    pageCount?: number
    aspectRatio: number
    scope: MediaLibraryScope
    scopeOwnerId: string
}): Promise<CopiedLibraryDocument> => {
    const workspace = await Workspace.getWorkspaceInternal({ workspaceId })
    const sourceFile = workspace?.files?.find((file: DocumentFile) => file.id === fileId)
    if (!sourceFile) {
        throw new Error('Canvas document is not backed by a stored workspace object')
    }

    const natsService = getStorageService()
    const sourceBucket = Workspace.getBucketName(workspaceId)
    const sourceData = await natsService.getObject(sourceBucket, fileId)
    if (!sourceData) {
        throw new Error('Canvas document object not found')
    }

    const itemId = uuid()
    const destinationBucket = getMediaLibraryBucketName(scope, scopeOwnerId)
    await ensureMediaLibraryBucket(natsService, destinationBucket)
    const documentStream = await natsService.getObjectStream(sourceBucket, fileId)
    if (!documentStream) {
        throw new Error('Canvas document object stream not found')
    }
    await natsService.putObjectFromReadable(destinationBucket, itemId, documentStream, {
        name: itemId,
        description: sourceFile.name,
    })

    // Poster is optional — if no first-page render exists we still save the doc.
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
        document: {
            aspectRatio,
            ...(typeof pageCount === 'number' ? { pageCount } : {}),
        },
        sourcePosterFileId: posterFileId,
    }
}

export const materializeLibraryDocumentToWorkspace = async ({
    item,
    workspaceId,
}: {
    item: MediaLibraryDocumentItem
    workspaceId: string
}): Promise<{ document: StoreFileResult; poster?: StoreFileResult }> => {
    const natsService = getStorageService()
    const data = await natsService.getObject(item.asset.bucketName, item.asset.objectKey)
    if (!data) {
        throw new Error('Media Library document object not found')
    }
    const document = await storeWorkspaceFile({
        workspaceId,
        buffer: Buffer.from(data),
        originalName: item.asset.originalName,
        mimeType: item.asset.mimeType,
        kind: 'document',
        modelSafe: true,
    })
    let poster: StoreFileResult | undefined
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
    return { document, poster }
}

export const deleteLibraryDocumentObject = async (item: MediaLibraryDocumentItem): Promise<void> => {
    await getStorageService().deleteObject(item.asset.bucketName, item.asset.objectKey)
    if (item.poster) {
        await getStorageService().deleteObject(item.poster.bucketName, item.poster.objectKey).catch(() => {})
    }
}
