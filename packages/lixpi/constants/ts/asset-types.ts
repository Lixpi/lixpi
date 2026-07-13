'use strict'

import type { AccessLevel, ContentDescriptor } from './types.ts'

export type AssetScope = 'workspace' | 'user' | 'organization'
export type AssetPrimaryCategory = 'image' | 'video' | 'audio' | 'document' | 'conversation'
export type AssetDocumentRole = 'content' | 'conversation' | 'provenance'
export type AssetMediaKind = 'image' | 'video' | 'audio' | 'document'

export type AssetLifecycleStatus = 'creating' | 'active' | 'deleting' | 'failed'
export type AssetMediaStatus = 'none' | 'processing' | 'ready' | 'degraded' | 'failed' | 'cancelled'
export type AssetConversationStatus = 'none' | 'idle' | 'receiving' | 'paused' | 'completed' | 'failed'
export type AssetProvenanceStatus = 'none' | 'building' | 'sealed' | 'failed' | 'cancelled'
export type AssetRenditionStatus = 'pending' | 'ready' | 'failed'

export type AssetDocumentPointer = {
    role: AssetDocumentRole
    blobHash: string
    version: number
    schemaVersion: string
    byteSize: number
    updatedAt: number
    sealedAt?: number
}

export type AssetRenditionName =
    | 'original'
    | 'canonical'
    | 'preview'
    | 'thumbnail'
    | 'poster'
    | 'representativeFrame'

export type AssetRendition = {
    name: AssetRenditionName
    status: AssetRenditionStatus
    blobHash?: string
    mimeType?: string
    byteSize?: number
    width?: number
    height?: number
    durationSeconds?: number
    errorCode?: string
    jobKey?: string
    updatedAt: number
}

export type AssetMedia = {
    kind: AssetMediaKind
    originalName: string
    sourceMimeType: string
    modelSafe: boolean
    renditions: Partial<Record<AssetRenditionName, AssetRendition>>
    width?: number
    height?: number
    aspectRatio?: number
    durationSeconds?: number
    hasAudio?: boolean
    pageCount?: number
}

export type AssetLineage = {
    sourceConversationAssetId?: string
    parentAssetId?: string
    sourceAssetIds: string[]
    generationRequestId?: string
    reasoningRunId?: string
    mediaRunId?: string
    reasoningModelId?: string
    mediaModelId?: string
    promptFingerprint?: string
}

export type AssetEditLease = {
    workspaceId: string
    leaseId: string
    holders: Array<{
        holderId: string
        expiresAt: number
    }>
    acquiredAt: number
    renewedAt: number
    expiresAt: number
}

export type AssetStates = {
    lifecycle: AssetLifecycleStatus
    media: AssetMediaStatus
    conversation: AssetConversationStatus
    provenance: AssetProvenanceStatus
}

export type Asset = {
    assetId: string
    organizationId: string
    title: string
    scope: AssetScope
    scopeOwnerId: string
    originWorkspaceId: string
    ownerUserId: string
    documents: Partial<Record<AssetDocumentRole, AssetDocumentPointer>>
    media?: AssetMedia
    lineage?: AssetLineage
    descriptor?: ContentDescriptor
    states: AssetStates
    referenceCount: number
    editLease?: AssetEditLease
    revision: number
    importedFromAssetId?: string
    createdAt: number
    updatedAt: number
}

export type AssetMeta = {
    scopeAndOwner: string
    assetId: string
    organizationId: string
    title: string
    primaryCategory: AssetPrimaryCategory
    ownerUserId: string
    originWorkspaceId: string
    lifecycleStatus: AssetLifecycleStatus
    mediaStatus: AssetMediaStatus
    thumbnailBlobHash?: string
    previewBlobHash?: string
    mimeType?: string
    byteSize?: number
    width?: number
    height?: number
    durationSeconds?: number
    aspectRatio?: number
    descriptorSummary?: string
    entityTags?: string[]
    styleTags?: string[]
    createdAt: number
    updatedAt: number
}

export type AssetAccessList = {
    assetId: string
    principalId: string
    accessLevel: AccessLevel
    createdAt: number
    updatedAt: number
}

export type AssetReferenceType = 'workspace' | 'catalog'

export type AssetReference = {
    assetId: string
    referenceKey: string
    type: AssetReferenceType
    workspaceId?: string
    nodeIds?: string[]
    surfaceIds?: string[]
    scope?: AssetScope
    scopeOwnerId?: string
    createdAt: number
    updatedAt: number
}

export type BlobStatus = 'staging' | 'active' | 'deleting' | 'failed'

export type BlobRecord = {
    blobKey: string
    blobHash: string
    organizationId: string
    bucketName: string
    objectKey: string
    mimeType: string
    byteSize: number
    status: BlobStatus
    referenceCount: number
    sourceBlobHash?: string
    derivationKind?: AssetRenditionName
    derivationVersion?: string
    createdAt: number
    updatedAt: number
}

export type BlobOwnerType = 'asset' | 'feature'

export type BlobReference = {
    blobKey: string
    blobHash: string
    organizationId: string
    referenceKey: string
    ownerType: BlobOwnerType
    ownerId: string
    createdAt: number
}

export type AssetRequesterContext = {
    userId: string
    workspaceIds: string[]
    editableWorkspaceIds: string[]
    organizationIds: string[]
}

export const ASSET_EDIT_LEASE_DURATION_MS = 30_000
export const ASSET_EDIT_LEASE_RENEWAL_MS = 10_000

export const ASSET_REQUIRED_RENDITIONS: Readonly<Record<AssetMediaKind, readonly AssetRenditionName[]>> = {
    image: ['original', 'preview', 'thumbnail'],
    video: ['original', 'preview', 'poster', 'thumbnail', 'representativeFrame'],
    audio: ['original'],
    document: ['original', 'poster', 'thumbnail'],
}

export type GenerateRenditionsRequest = {
    jobId: string
    jobKey: string
    organizationId: string
    assetId: string
    bucketName: string
    sourceBlobHash: string
    sourceObjectKey: string
    originalName: string
    sourceMimeType: string
    mediaKind: AssetMediaKind
    modelSafe: boolean
    canonicalMimeType: string
    derivationVersion: string
    requestedRenditions: AssetRenditionName[]
}

export type GeneratedRenditionResult = {
    name: AssetRenditionName
    status: 'ready'
    blobHash: string
    objectKey: string
    mimeType: string
    byteSize: number
    width?: number
    height?: number
    durationSeconds?: number
    pageCount?: number
}

export type FailedRenditionResult = {
    name: AssetRenditionName
    status: 'failed'
    errorCode: string
}

export type GenerateRenditionsResponse = {
    jobId: string
    jobKey: string
    organizationId: string
    assetId: string
    sourceBlobHash: string
    renditions: Array<GeneratedRenditionResult | FailedRenditionResult>
    width?: number
    height?: number
    aspectRatio?: number
    durationSeconds?: number
    hasAudio?: boolean
    pageCount?: number
}
