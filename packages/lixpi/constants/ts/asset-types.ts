import {
    type AccessLevel,
    type ContentDescriptor,
    type ProviderName,
} from './types.ts'

export type AssetScope = 'workspace' | 'user' | 'organization'
export type AssetPrimaryCategory = 'image' | 'video' | 'audio' | 'document' | 'conversation' | 'capabilityArtifact'
export const ASSET_DOCUMENT_ROLES = ['content', 'conversation', 'provenance', 'capabilityArtifact'] as const
export type AssetDocumentRole = typeof ASSET_DOCUMENT_ROLES[number]
export const isAssetDocumentRole = (value: unknown): value is AssetDocumentRole => typeof value === 'string' && ASSET_DOCUMENT_ROLES.some(role => role === value)
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

export type AssetMediaCompositionComponent = {
    componentId: string
    role: string
    title: string
    blobHash: string
    mimeType: 'image/png'
    byteSize: number
    width?: number
    height?: number
}

export type AssetMediaComposition = {
    schemaVersion: 'asset-media-composition-v1'
    kind: string
    capabilityId: string
    sourceAssetIds: string[]
    components: AssetMediaCompositionComponent[]
}

export type AssetCapabilityArtifact = {
    artifactTypeId: string
    schemaVersion: string
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
    // Seed the media model generated this output with, recorded whenever the
    // model accepts one. Reusing it steers a later generation toward the same
    // result; no provider guarantees an identical output.
    generationSeed?: number
}

// Shown beside the seed in every Asset details surface.
export const ASSET_GENERATION_SEED_HELP_TEXT = 'The random starting point the model generated this media from. '
    + 'Reusing the same seed with the same prompt and settings steers a new generation toward this result, '
    + 'though no provider guarantees an identical output.'

export const DEPICTION_MEDIA = [
    'photograph',
    'live-action-video',
    'illustration',
    'painting',
    'animation',
    '3d-render',
    'mixed',
    'unknown',
] as const
export type DepictionMedium = typeof DEPICTION_MEDIA[number]

export const SUBJECT_IDENTITY_CLASSIFICATIONS = [
    'unknown',
    'no-person',
    'fictional',
    'self',
    'authorized-real-person',
] as const
export type SubjectIdentityClassification = typeof SUBJECT_IDENTITY_CLASSIFICATIONS[number]

export type SubjectIdentitySource = 'user-attestation' | 'automatic-lineage' | 'inherited-lineage'

export type ProviderIdentityVerification = {
    provider: ProviderName
    providerAccountScope: string
    strategy: 'provider-hosted-session' | 'provider-direct-upload'
    subjectHandle: string
    status: 'valid' | 'expired' | 'revoked'
    verifiedAt: number
    expiresAt?: number
    derivativeReuse: 'not-allowed' | 'same-provider-account' | 'documented-lineage'
    policyProfileVersion: string
}

export type AssetSubjectIdentity = {
    classification: SubjectIdentityClassification
    source: SubjectIdentitySource
    identityGroupId?: string
    currentAttestationId?: string
    inheritedFromAssetIds?: string[]
    derivationVersion?: string
    providerVerifications: ProviderIdentityVerification[]
}

export type AssetSubjectIdentityAttestation = {
    attestationId: string
    assetId: string
    assetRevision: number
    organizationId: string
    attestedByUserId: string
    classification: SubjectIdentityClassification
    statementVersion: string
    status: 'active' | 'superseded' | 'revoked'
    supersedesAttestationId?: string
    createdAt: number
}

export const DEFAULT_ASSET_SUBJECT_IDENTITY: AssetSubjectIdentity = {
    classification: 'unknown',
    source: 'automatic-lineage',
    providerVerifications: [],
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

export type GeneratedOutputReviewStatus = 'candidate' | 'accepted' | 'superseded'

export type GeneratedOutputRegenerationMode = 'existing-prompt' | 'regenerate-prompt'

export type GeneratedOutputReview = {
    status: GeneratedOutputReviewStatus
    acceptedAt?: number
    acceptedBy?: string
    supersededAt?: number
    supersededByAssetId?: string
    regeneratedFromAssetId?: string
    regenerationMode?: GeneratedOutputRegenerationMode
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
    composition?: AssetMediaComposition
    artifact?: AssetCapabilityArtifact
    lineage?: AssetLineage
    generatedOutputReview?: GeneratedOutputReview
    descriptor?: ContentDescriptor
    depictionMedium: DepictionMedium
    subjectIdentity: AssetSubjectIdentity
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
    scope: AssetScope
    scopeOwnerId: string
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
    depictionMedium: DepictionMedium
    subjectIdentityClassification: SubjectIdentityClassification
    artifactTypeId?: string
    artifactSchemaVersion?: string
    entityTags?: string[]
    styleTags?: string[]
    createdAt: number
    updatedAt: number
}

export type AssetSearchRecord = Omit<AssetMeta, 'assetId' | 'primaryCategory'> & {
    assetId: string
    primaryCategory: Exclude<AssetPrimaryCategory, 'conversation'>
    searchKey: string
    normalizedTitle: string
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

export type BlobOwnerType = 'asset' | 'capability' | 'mediaGenerationRequest'

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

export const ASSET_EDIT_LEASE_DURATION_MS = 30000
export const ASSET_EDIT_LEASE_RENEWAL_MS = 10000

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
