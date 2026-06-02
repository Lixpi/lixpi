'use strict'

import type { Merge, Except } from 'type-fest'

export const PROVIDER_NAMES = ['OpenAI', 'Anthropic', 'Google', 'Stability'] as const
export type ProviderName = typeof PROVIDER_NAMES[number]

// Shared image upload/import validation limits (API routes, remote URL import, web-ui uploader).
export const MAX_IMAGE_FILE_SIZE = 1024 * 1024 * 1024

export const ALLOWED_IMAGE_MIME_TYPES: readonly string[] = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/avif',
]

// NOTE: User type restored exactly as originally defined per instruction (commas retained intentionally)
export type User = {
    userId: string,
    stripeCustomerId?: string,
    email: string,
    name: string,
    givenName: string,
    familyName: string,
    avatar: string,
    hasActiveSubscription: boolean,
    balance: string,
    currency: string,
    recentTags: string[],
    organizations: string[],
    createdAt: number,
    updatedAt: number,
}

export const ACCESS_LEVEL = {
    OWNER: 'owner',
    EDITOR: 'editor',
    VIEWER: 'viewer',
} as const
export type AccessLevel = typeof ACCESS_LEVEL[keyof typeof ACCESS_LEVEL]

export type Organization = {
    organizationId: string
    name: string
    tags: Record<string, {
        name: string
        color: string
    }>
    accessList: Record<string, AccessLevel> // userId -> accessLevel
    createdAt: number
    updatedAt: number
}

export type OrganizationAccessList = {
    userId: string
    organizationId: string
    accessLevel: AccessLevel
    createdAt: number
    updatedAt: number
}

export type DocumentFile = {
    id: string
    name: string
    mimeType: string
    size: number
    uploadedAt: number
}

export type CanvasNodeType = 'document' | 'image' | 'aiChatThread' | 'video'

type CanvasNodePosition = {
    x: number
    y: number
}

type CanvasNodeDimensions = {
    width: number
    height: number
}

// xyflow-native parent-child fields. When `parentId` is set, `position` is
// relative to the parent's top-left corner (xyflow's contract). `expandParent`
// causes the parent to auto-grow when this child moves or is resized past the
// parent's current bounds. `extent: 'parent'` clamps the child inside the
// parent rect (intentionally not used during region adoption — see plan D11).
export type CanvasNodeParentingFields = {
    parentId?: string
    extent?: 'parent' | [[number, number], [number, number]]
    expandParent?: boolean
}

export type DocumentCanvasNode = CanvasNodeParentingFields & {
    nodeId: string
    type: 'document'
    referenceId: string
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
    // Text summary of the document's content for the workspace relevance engine.
    descriptor?: ContentDescriptor
}

export type ImageGenerationSize = '1024x1024' | '1536x1024' | '1024x1536' | 'auto'

export type ImageSizeOption = {
    value: string
    label: string
}

export type ImageGenerationOperationKind = 'new_image' | 'edit_existing' | 'style_transfer' | 'compare_branches' | 'fresh_branch'

export type ImageBranchSelectionMode = 'context-only' | 'edit-active-branch' | 'all-branches' | 'fresh-branch' | 'ambiguous'

export type ImageBranchCandidateRoleHint =
    | 'base-context'
    | 'generated-variant'
    | 'branch-leaf'
    | 'branch-ancestor'
    | 'embedded-thread-image'
    | 'active-target'

export type ImageBranchCandidateImage = {
    nodeId: string
    fileId?: string
    workspaceId?: string
    imageUrl: string
    // Whether `imageUrl` points at a still image or at a video's representative
    // frame. Videos are grounded by a single extracted frame — never the MP4 —
    // so the resolver pays the same per-candidate cost regardless of media type.
    // Defaults to 'image' when absent so existing image candidates are unchanged.
    mediaKind?: 'image' | 'video'
    roleHints: ImageBranchCandidateRoleHint[]
    branchId?: string
    parentImageNodeId?: string
    ancestorNodeIds: string[]
    sourceContextNodeIds: string[]
    sourceMessageId?: string
    promptText?: string
    visualEntitySummary?: string
    visualStyleSummary?: string
    entityTags?: string[]
    styleTags?: string[]
    createdAt?: number
}

export type ImageBranchCandidateSnapshot = {
    resolverVersion: string
    threadId: string
    regionNodeId: string
    activeTargetNodeId?: string
    promptText: string
    promptFingerprint: string
    candidates: ImageBranchCandidateImage[]
    transcriptContext: string
}

// One compact, descriptors-only entry per context-bearing canvas node. The
// browser builds these for the whole workspace each chat turn so the API
// relevance stage can rank on text alone (no pixels) — `imageUrl`/`fileId` are
// nats-obj references the API resolves only for the narrowed, selected set.
export type WorkspaceContextNode = {
    nodeId: string
    type: CanvasNodeType
    referenceId?: string
    title?: string
    descriptorSummary?: string
    entityTags?: string[]
    styleTags?: string[]
    fileId?: string
    imageUrl?: string
    branchId?: string
    isExplicitChip: boolean
    isEdgeForced: boolean
}

export type WorkspaceContextSnapshot = {
    resolverVersion: string
    workspaceId: string
    threadId: string
    promptText: string
    nodes: WorkspaceContextNode[]
}

export type WorkspaceContextSelectionRole = 'forced-chip' | 'forced-edge' | 'auto'

export type WorkspaceContextSelection = {
    nodeId: string
    role: WorkspaceContextSelectionRole
    rationale?: string
}

export type WorkspaceContextResolution = {
    resolverVersion: string
    selections: WorkspaceContextSelection[]
    improvedDescriptors?: Record<string, ContentDescriptor>
    narrowedMediaNodeIds: string[]
}

export type ImageBranchReferenceRole =
    | 'target'
    | 'base-context'
    | 'style-reference'
    | 'comparison-target'
    | 'excluded'

export type ImageBranchVlmReferenceDecision = {
    nodeId: string
    role: ImageBranchReferenceRole
    reason: string
}

export type ImageBranchVlmResolution = {
    resolverKind: 'structured-vlm'
    resolverVersion: string
    resolverModelProvider: string
    resolverModelId: string
    mode: ImageBranchSelectionMode
    operationKind: ImageGenerationOperationKind
    targetImageNodeId: string | null
    parentImageNodeId?: string
    branchId: string | null
    includeGeneratedNodeIds: string[]
    referenceImageNodeIds: string[]
    sourceContextNodeIds: string[]
    styleReferenceNodeIds: string[]
    excludedNodeIds: string[]
    visualEntitySummary?: string
    visualStyleSummary?: string
    entityTags: string[]
    styleTags: string[]
    confidence: number
    rationale: string
    decisions: ImageBranchVlmReferenceDecision[]
}

export type ImageBranchResolvedStreamPayload = {
    status: 'IMAGE_BRANCH_RESOLVED'
    aiProvider: string
    resolution: ImageBranchVlmResolution
}

export type ImageBranchResolutionErrorStreamPayload = {
    status: 'IMAGE_BRANCH_RESOLUTION_ERROR'
    aiProvider: string
    error: string
}

export type ContextRelevanceResolvedStreamPayload = {
    status: 'CONTEXT_RELEVANCE_RESOLVED'
    aiProvider: string
    workspaceContextResolution: WorkspaceContextResolution
}

export type ContextRelevanceErrorStreamPayload = {
    status: 'CONTEXT_RELEVANCE_ERROR'
    aiProvider: string
    error: string
}

export type ImageGenerationTraceReferenceRole = ImageBranchReferenceRole | 'feature-reference' | 'message-reference'

export type ImageGenerationTraceReference = {
    id: string
    imageUrl: string
    source: 'branch-candidate' | 'feature-reference' | 'message-reference'
    label: string
    role: ImageGenerationTraceReferenceRole
    nodeId?: string
    fileId?: string
    workspaceId?: string
    branchId?: string
    reason?: string
}

export type ImageGenerationTraceExcludedReference = {
    nodeId: string
    label: string
    role: 'excluded'
    reason: string
    fileId?: string
    workspaceId?: string
    branchId?: string
}

export type ImageGenerationTrace = {
    traceVersion: 'image-generation-trace-v1'
    chatModelProvider: string
    chatModelId: string
    imageModelProvider: string
    imageModelId: string
    imageSize: string
    toolPrompt: string
    finalPrompt: string
    promptWasChanged: boolean
    referenceImages: ImageGenerationTraceReference[]
    excludedReferences: ImageGenerationTraceExcludedReference[]
    resolver?: {
        resolverKind: 'structured-vlm'
        resolverVersion: string
        resolverModelProvider: string
        resolverModelId: string
        mode: ImageBranchSelectionMode
        operationKind: ImageGenerationOperationKind
        confidence: number
        rationale: string
        targetImageNodeId: string | null
        parentImageNodeId?: string
        branchId: string | null
    }
}

export type ImageGenerationTraceStreamPayload = {
    status: 'IMAGE_GENERATION_TRACE'
    aiProvider: string
    imageGenerationTrace: ImageGenerationTrace
}

// Mirrors ImageGenerationTrace but for VEO video generation. Reuses the same
// reference-trace shape so the frontend can render selected/excluded media
// candidates the same way it does for images.
export type VideoGenerationTrace = {
    traceVersion: 'video-generation-trace-v1'
    chatModelProvider: string
    chatModelId: string
    videoModelProvider: string
    videoModelId: string
    aspectRatio: string
    resolution: string
    durationSeconds: number
    toolPrompt: string
    finalPrompt: string
    promptWasChanged: boolean
    referenceImages: ImageGenerationTraceReference[]
    excludedReferences: ImageGenerationTraceExcludedReference[]
    resolver?: {
        resolverKind: 'structured-vlm'
        resolverVersion: string
        resolverModelProvider: string
        resolverModelId: string
        mode: ImageBranchSelectionMode
        operationKind: ImageGenerationOperationKind
        confidence: number
        rationale: string
        targetImageNodeId: string | null
        parentImageNodeId?: string
        branchId: string | null
    }
}

export type VideoGenerationTraceStreamPayload = {
    status: 'VIDEO_GENERATION_TRACE'
    aiProvider: string
    videoGenerationTrace: VideoGenerationTrace
}

export type ImageGeneratedByMetadata = {
    aiChatThreadId: string
    responseId: string
    aiModel: AiModelId
    imageModelProvider?: string
    revisedPrompt: string
    responseMessageId?: string
    branchId?: string
    parentImageNodeId?: string
    sourceContextNodeIds?: string[]
    referenceImageNodeIds?: string[]
    operationKind?: ImageGenerationOperationKind
    promptText?: string
    promptFingerprint?: string
    entitySummary?: string
    visualEntitySummary?: string
    visualStyleSummary?: string
    entityTags?: string[]
    styleTags?: string[]
    targetImageNodeId?: string
    styleReferenceNodeIds?: string[]
    excludedNodeIds?: string[]
    resolverKind?: 'structured-vlm'
    resolverModelProvider?: string
    resolverModelId?: string
    resolverRationale?: string
    resolverConfidence?: number
    resolverVersion?: string
    createdAt?: number
}

// A compact, model-friendly description of a single context-bearing canvas node
// (image, video, document, or aiChatThread) stored on the node so any feature can
// read it without re-deriving it. Media descriptors are composed for free from the
// branch resolver's summaries (generated media) or a single VLM pass (uploads);
// document/thread descriptors are a text summary of the node's content (no pixels).
// Deliberately short so it can be fed into model context (e.g. the branch-resolver
// transcript, the workspace relevance snapshot) without bloat.
export type ContentDescriptorStatus = 'analyzing' | 'ready' | 'failed'

export type ContentDescriptor = {
    status: ContentDescriptorStatus
    summary: string
    entityTags: string[]
    styleTags: string[]
    // 'generation' = composed from generated-media metadata; 'analysis' = a VLM
    // caption (media) or a text summary (document/thread).
    source: 'generation' | 'analysis'
    version: string
    updatedAt: number
}

// Back-compat aliases: media kept the MediaDescriptor name before descriptors were
// generalized to all node types. Identical shape — the media path is unchanged.
export type MediaDescriptorStatus = ContentDescriptorStatus
export type MediaDescriptor = ContentDescriptor

export type ImageCanvasNode = CanvasNodeParentingFields & {
    nodeId: string
    type: 'image'
    fileId: string
    workspaceId: string
    src: string
    aspectRatio: number
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
    generatedBy?: ImageGeneratedByMetadata
    descriptor?: MediaDescriptor
}

// Provenance + lineage for an AI-generated video node. Mirrors
// ImageGeneratedByMetadata and reuses the same branch-lineage audit field
// names so the structured VLM resolver output maps over without translation.
export type VideoGeneratedByMetadata = {
    aiChatThreadId: string
    responseId: string
    videoModel: AiModelId
    videoModelProvider?: string
    revisedPrompt: string
    responseMessageId?: string
    // video-specific generation parameters
    aspectRatio?: string
    resolution?: string
    durationSeconds?: number
    hasAudio?: boolean
    veoOperationName?: string
    sourceVideoNodeId?: string    // set for extend/edit continuations (Phase 6)
    // reused branch-lineage audit fields (identical names to images)
    branchId?: string
    parentImageNodeId?: string
    sourceContextNodeIds?: string[]
    referenceImageNodeIds?: string[]
    operationKind?: ImageGenerationOperationKind
    promptText?: string
    promptFingerprint?: string
    entitySummary?: string
    visualEntitySummary?: string
    visualStyleSummary?: string
    entityTags?: string[]
    styleTags?: string[]
    targetImageNodeId?: string
    styleReferenceNodeIds?: string[]
    excludedNodeIds?: string[]
    resolverKind?: 'structured-vlm'
    resolverModelProvider?: string
    resolverModelId?: string
    resolverRationale?: string
    resolverConfidence?: number
    resolverVersion?: string
    createdAt?: number
}

// AI-generated (or otherwise stored) video node. The MP4 lives in the workspace
// Object Store under `fileId`; `posterFileId` is an ffmpeg frame-0 image used by
// the PIXI media layer for the poster/placeholder behind the DOM video surface.
export type VideoCanvasNode = CanvasNodeParentingFields & {
    nodeId: string
    type: 'video'
    fileId: string                // MP4 object key in workspace-{workspaceId}-files
    posterFileId: string          // ffmpeg frame-0 poster (an image object)
    frameFileId?: string          // ffmpeg representative mid-frame used to ground the video to the VLM and as VEO's image-to-video anchor
    workspaceId: string
    src: string                   // tokenized MP4 URL (Range-capable video route)
    posterSrc: string             // tokenized poster image URL (PIXI low-LoD)
    aspectRatio: number           // width / height
    durationSeconds: number       // 4 | 6 | 8
    hasAudio: boolean
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
    generatedBy?: VideoGeneratedByMetadata
    descriptor?: MediaDescriptor
}

export type AiChatThreadCanvasNode = CanvasNodeParentingFields & {
    nodeId: string
    type: 'aiChatThread'
    referenceId: string
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
    // Text summary of the thread transcript for the workspace relevance engine.
    descriptor?: ContentDescriptor
}

export type CanvasNode = DocumentCanvasNode | ImageCanvasNode | AiChatThreadCanvasNode | VideoCanvasNode

export type CanvasViewport = {
    x: number
    y: number
    zoom: number
}

export type WorkspaceEdgePathType = 'bezier' | 'straight' | 'smoothstep' | 'horizontal-bezier' | 'orthogonal'

export type WorkspaceEdge = {
    edgeId: string
    sourceNodeId: string
    targetNodeId: string
    sourceHandle?: string
    targetHandle?: string
    sourceT?: number  // Position along source side (0=start, 1=end, 0.5=center). Default: 0.5
    targetT?: number  // Position along target side (0=start, 1=end, 0.5=center). Default: 0.5
    sourceMessageId?: string  // Links edge to a specific aiResponseMessage (by its id attr) within the source AI chat thread
    pathType?: WorkspaceEdgePathType
}

export type FeatureScope = 'workspace' | 'user' | 'organization' | 'public'
export type FeatureStatus = 'active' | 'reported' | 'removed'

export type FeatureSampleKind = 'source-crop' | 'texture-specimen' | 'applied-medium-probe' | 'palette-board'

export type FeatureSampleCropRegion = {
    imageRef: string
    x: number
    y: number
    width: number
    height: number
    label: string
    purpose: 'texture-evidence' | 'applied-medium-evidence' | 'subject-detail-evidence' | 'composition-evidence'
}

export type FeatureSampleRef = {
    idx: number
    subject: string
    rationale?: string
    aspectRatio?: string
    ext: string
    fileId?: string
    imageUrl?: string
    kind?: FeatureSampleKind
    cropRegion?: FeatureSampleCropRegion
}

export type FeatureSourceImageCrop = {
    imageRef: string
    x: number
    y: number
    width: number
    height: number
    label: string
    purpose: 'texture-evidence' | 'applied-medium-evidence' | 'subject-detail-evidence' | 'composition-evidence'
    rationale: string
}

export type SceneSubject = {
    label: string
    bbox: [number, number, number, number]
    salience: number
    description: string
}

export type SceneRegion = {
    label: string
    bbox: [number, number, number, number]
    description: string
}

export type SceneReference = {
    imageRef: string
    subjects: SceneSubject[]
    regions: SceneRegion[]
}

export type SceneAssessment = {
    references: SceneReference[]
    medium: string
    axisDominance: Record<string, number>
    intentResolution: {
        forcedCategory?: string | null
        forcedAxes?: string[] | null
        proposedCategory: string
    }
    notes: string
}

export type AxisExtraction = {
    axis: string
    dominance: number
    fields: Record<string, any>
    rationale: string
}

export type FeatureRecommendedSampleSubject = {
    kind: FeatureSampleKind
    prompt: string
    aspectRatio: string
    rationale: string
}

export type FeatureDraft = {
    category: string
    name: string
    summary: string
    tags: string[]
    instructions: string
    parameters: Record<string, any>
    recommendedSampleSubjects: FeatureRecommendedSampleSubject[]
}

export type StageTraceEvent = {
    extractionRunId: string
    stage: string
    modelName?: string
    promptHash?: string
    promptPreview?: string
    startedAt: number
    finishedAt: number
    durationMs: number
    // 'running' is a publish-only, in-flight marker streamed when a stage starts so
    // the UI can show a live spinner. Only the terminal event ('ok' | 'error' | 'skipped')
    // is persisted to ExtractionRun.trace.
    status: 'running' | 'ok' | 'error' | 'skipped'
    errorMessage?: string
    inputSummary?: string
    outputSummary?: string
    outputBytes?: number
    metricTags?: Record<string, string | number>
}

// Markdown stream parser segment shapes. These mirror what @lixpi/markdown-stream-parser
// emits from subscribeToTokenParse — the package defines the segment internally but does
// not export it (the callback is typed `any`), so the shape is centralized here and shared
// by every consumer (the ProseMirror aiChatThreadPlugin and the unified MarkdownStreamRenderer).
//
// TODO: a newer version of @lixpi/markdown-stream-parser is in development that EXPORTS proper
// segment types. Once that version is released, delete these definitions and import the types
// directly from @lixpi/markdown-stream-parser instead.
//
// See documentation/features/MARKDOWN-RENDERING.md.
export type MarkdownParsedSegment = {
    segment: string
    styles: string[]
    type: string
    level?: number
    isBlockDefining: boolean
    isProcessingNewLine?: boolean
    content?: string
    language?: string
    origin?: string
}

export type MarkdownStreamToken = {
    status: 'STREAMING' | 'END_STREAM'
    segment?: MarkdownParsedSegment
}

export type FeatureSourceContext = {
    extractionRunId: string
    sourceWorkspaceId: string
    sourceImages?: Array<{
        idx: number
        imageUrl: string
        role: 'source-reference'
    }>
}

export type Feature = {
    featureId: string
    version: number
    category: string
    name: string
    summary: string
    tags: string[]
    instructions: string
    parameters: Record<string, any>
    sampleImages: FeatureSampleRef[]
    scope: FeatureScope
    scopeOwnerId: string
    status: FeatureStatus
    ownerUserId: string
    workspaceId: string
    sourceContext: FeatureSourceContext
    reportCount: number
    createdAt: number
    updatedAt: number
}

export type FeatureMeta = {
    featureId: string
    category: string
    name: string
    summary: string
    tags: string[]
    scope: FeatureScope
    scopeOwnerId: string
    status: FeatureStatus
    ownerUserId: string
    sampleZeroKey?: string
    sampleZeroUrl?: string
    updatedAt: number
}

export type FeatureAccessList = {
    userId: string
    featureId: string
    createdAt: number
}

export type FeatureReferenceMessageBlock = {
    featureId: string
    name: string
    category: string
    scope: FeatureScope
    summary: string
    instructions: string
    parameters: Record<string, any>
    sampleImages: Array<{ idx: number; subject: string; base64: string }>
}

export const MEDIA_LIBRARY_SCOPE = {
    WORKSPACE: 'workspace',
    USER: 'user',
    ORGANIZATION: 'organization',
    PUBLIC: 'public',
} as const
export type MediaLibraryScope = typeof MEDIA_LIBRARY_SCOPE[keyof typeof MEDIA_LIBRARY_SCOPE]

// Sentinel scopeOwnerId for public-scoped items (no workspace/user/org owner).
export const MEDIA_LIBRARY_PUBLIC_OWNER_ID = 'public'

// Features retain their existing persistence path and are adapted into the library UI.
export const MEDIA_LIBRARY_ITEM_KIND = {
    IMAGE: 'image',
    VIDEO: 'video',
} as const
export type MediaLibraryItemKind = typeof MEDIA_LIBRARY_ITEM_KIND[keyof typeof MEDIA_LIBRARY_ITEM_KIND]

export const MEDIA_LIBRARY_ITEM_STATUS = {
    ACTIVE: 'active',
    DELETED: 'deleted',
} as const
export type MediaLibraryItemStatus = typeof MEDIA_LIBRARY_ITEM_STATUS[keyof typeof MEDIA_LIBRARY_ITEM_STATUS]

// Top-level browsing categories in the Media Library panel.
export const MEDIA_LIBRARY_CATEGORY = {
    FEATURES: 'features',
    IMAGES: 'images',
    VIDEOS: 'videos',
} as const
export type MediaLibraryCategory = typeof MEDIA_LIBRARY_CATEGORY[keyof typeof MEDIA_LIBRARY_CATEGORY]

// Browse-filter sentinel meaning "all readable scopes" rather than a single scope.
export const MEDIA_LIBRARY_BROWSE_ALL = 'all'

export type MediaLibraryAssetRef = {
    bucketName: string
    objectKey: string
    mimeType: string
    byteSize: number
    originalName: string
}

export type MediaLibraryImageData = {
    width: number
    height: number
    aspectRatio: number
}

export type MediaLibraryImageItem = {
    itemId: string
    version: 1
    kind: 'image'
    displayName: string
    ownerUserId: string
    originWorkspaceId: string
    sourceFileId: string
    scope: MediaLibraryScope
    scopeOwnerId: string
    scopeAndOwner: string
    status: MediaLibraryItemStatus
    asset: MediaLibraryAssetRef
    image: MediaLibraryImageData
    createdAt: number
    updatedAt: number
}

export type MediaLibraryImageMeta = {
    itemId: string
    kind: 'image'
    displayName: string
    ownerUserId: string
    originWorkspaceId: string
    scope: MediaLibraryScope
    scopeOwnerId: string
    scopeAndOwner: string
    status: MediaLibraryItemStatus
    mimeType: string
    byteSize: number
    width: number
    height: number
    aspectRatio: number
    previewUrl: string
    createdAt: number
    updatedAt: number
}

// Video items reuse the same scope/access model as images. The MP4 lives in
// the library asset bucket with the same `MediaLibraryAssetRef` shape; the
// `poster` field is a fully separate asset reference to a frame-0 PNG (or
// JPEG) so the panel can render a still preview without decoding the MP4.
export type MediaLibraryVideoData = {
    durationSeconds: number
    aspectRatio: number  // width / height
    hasAudio: boolean
    width?: number
    height?: number
}

export type MediaLibraryVideoItem = {
    itemId: string
    version: 1
    kind: 'video'
    displayName: string
    ownerUserId: string
    originWorkspaceId: string
    sourceFileId: string          // workspace-{ws}-files MP4 object key the item was saved from
    sourcePosterFileId?: string   // workspace-{ws}-files poster object key (may be missing if ffmpeg failed)
    scope: MediaLibraryScope
    scopeOwnerId: string
    scopeAndOwner: string
    status: MediaLibraryItemStatus
    asset: MediaLibraryAssetRef         // MP4 in library bucket
    poster?: MediaLibraryAssetRef       // PNG/JPEG poster in library bucket
    video: MediaLibraryVideoData
    createdAt: number
    updatedAt: number
}

export type MediaLibraryVideoMeta = {
    itemId: string
    kind: 'video'
    displayName: string
    ownerUserId: string
    originWorkspaceId: string
    scope: MediaLibraryScope
    scopeOwnerId: string
    scopeAndOwner: string
    status: MediaLibraryItemStatus
    mimeType: string
    byteSize: number
    durationSeconds: number
    aspectRatio: number
    hasAudio: boolean
    width?: number
    height?: number
    previewUrl: string          // MP4 content route (Range-capable)
    posterPreviewUrl?: string   // poster image route (PNG/JPEG)
    createdAt: number
    updatedAt: number
}

// Unions for call-sites that switch on `kind`.
export type MediaLibraryItem = MediaLibraryImageItem | MediaLibraryVideoItem
export type MediaLibraryMeta = MediaLibraryImageMeta | MediaLibraryVideoMeta

export type MediaLibraryAccessList = {
    itemId: string
    principalId: string
    accessLevel: AccessLevel
    createdAt: number
    updatedAt: number
}

export type ExtractionRunStatus =
    | 'pending'
    | 'analyzing'
    | 'routing'
    | 'extracting'
    | 'extracting_axes'
    | 'materializing_crops'
    | 'synthesizing'
    | 'generating_samples'
    | 'saving'
    | 'completed'
    | 'failed'

export type ExtractionRun = {
    extractionRunId: string
    workspaceId: string
    userId: string
    status: ExtractionRunStatus
    featureId?: string
    transcriptJson?: object
    sourceContextSnapshot?: object
    trace?: StageTraceEvent[]
    error?: string
    createdAt: number
    updatedAt: number
}

export type CanvasAiChatSidebarTab = {
    tabId: string
    type: 'thread' | 'extraction'
    refId: string
    title: string
}

export type CanvasAiChatPromptDraft = {
    content?: object
}

export type CanvasAiChatPanelState = {
    isOpen: boolean
    isSessionHistoryOpen: boolean
    tabs: CanvasAiChatSidebarTab[]
    activeTabId?: string
    // Explicit force-included canvas node ids, shown as removable chips in the
    // panel's context tray. The workspace relevance engine (later phases) unions
    // these with its automatic picks — it may add, never drop them.
    contextChips: string[]
    width?: number
    drafts?: Record<string, CanvasAiChatPromptDraft>
}

export type CanvasFeatureExtractionState = {
    extractionRunId: string
    status: ExtractionRunStatus
    userText?: string
    aiProvider?: string
    stepDetails?: Record<string, string>
    reasoningText?: string
    // Streamed model output (thinking/reasoning) keyed by the stage that produced it,
    // so the extraction tab can show live output under each in-progress substep.
    stageReasoning?: Record<string, string>
    featureCard?: Record<string, any>
    traceEvents?: StageTraceEvent[]
    sourceContextSnapshot?: object
    error?: string
    updatedAt: number
}

export type CanvasState = {
    sourceContext: FeatureSourceContext
    nodes: CanvasNode[]
    edges: WorkspaceEdge[]
    lastActiveAiChatThreadId?: string
    aiChatSidebarTabs?: CanvasAiChatSidebarTab[]
    activeAiChatSidebarTabId?: string
    aiChatPanel?: CanvasAiChatPanelState
    featureExtractionRuns?: Record<string, CanvasFeatureExtractionState>
}

export type Workspace = {
    workspaceId: string
    name: string
    accessType: 'private' | 'public'
    accessList: {
        userId: string
        accessLevel: AccessLevel
    }[]
    files?: DocumentFile[]
    canvasState: CanvasState
    createdAt: number
    updatedAt: number
}

export type WorkspaceMeta = {
    workspaceId: string
    name: string
    createdAt: number
    updatedAt: number
}

export type WorkspaceAccessList = {
    userId: string
    workspaceId: string
    accessLevel: AccessLevel
    createdAt: number
    updatedAt: number
}

export type Document = {
    documentId: string
    workspaceId: string
    revision: number
    title: string
    content: string
    prevRevision: number
    createdAt: number
    updatedAt: number
    revisionExpiresAt?: number
}

export type DocumentMeta = {
    documentId: string
    title: string
    tags: string[]
    createdAt: number
    updatedAt: number
}

export type DocumentAccessList = {
    userId: string
    documentId: string
    accessLevel: AccessLevel
    createdAt: number
    updatedAt: number
}

export type SubscriptionBalanceUpdateEvent = {
    userId: string
    stripeCustomerId: string
    organizationId: string
    amount: string
}

// AI Chat message types - multimodal support (OpenAI Responses API format)
export type TextContentBlock = { type: 'input_text'; text: string }
export type ImageContentBlock = { type: 'input_image'; image_url: string; detail?: 'auto' | 'low' | 'high' }
export type MessageContentBlock = TextContentBlock | ImageContentBlock
export type MessageContent = string | MessageContentBlock[]

export type AiInteractionChatSendMessagePayload = {
    messages: Array<{ role: string; content: MessageContent }>
    aiModel: AiModelId
    threadId: string
    referencedFeatureIds?: string[]
    imageBranchCandidateSnapshot?: ImageBranchCandidateSnapshot
    // Whole-workspace, descriptors-only index sent each turn; consumed by the
    // API `resolveWorkspaceContext` relevance stage (later phase).
    workspaceContextSnapshot?: WorkspaceContextSnapshot
}

export type AiInteractionImageGenerationPayload = AiInteractionChatSendMessagePayload & {
    aiImageModel: AiModelId
    imageSize?: ImageGenerationSize
    previousResponseId?: string
}

export type AiInteractionChatStopMessagePayload = {
    threadId: string
}

export type AiModel = {
    provider: string
    model: string
    title: string
    shortTitle?: string
    modelVersion: string
    imagePromptMaxChars?: number
    contextWindow: number
    maxCompletionSize: number
    defaultTemperature: number
    supportsSystemPrompt: boolean
    color: string
    iconName: string
    sortingPosition: number
    modalities: Array<{ modality: string; title: string; shortTitle: string }>
    imageSizes?: ImageSizeOption[]
    // Video generation option lists (VEO and future video providers). Reuse the
    // ImageSizeOption { value, label } shape the size dropdown already consumes.
    videoAspectRatios?: ImageSizeOption[]
    videoResolutions?: ImageSizeOption[]
    videoDurations?: ImageSizeOption[]
    pricing: {
        currency: string
        resaleMargin: string
        text?: {
            measuringUnit: string
            pricePer: string
            tiers: {
                default: {
                    prompt: string
                    completion: string
                }
            }
        }
        audio?: {
            measuringUnit: string
            pricePer: string
            prompt: string
            completion: string
        }
        image?: {
            measuringUnit: string
            pricePer: string
            prompt: string
            completion: string
        }
        // Video models (VEO) are billed per second of generated video.
        video?: {
            measuringUnit: string
            pricePer: string
            price: string
        }
    }
    createdAt: number
    updatedAt: number
}

export type EventMeta = {
    userId: string
    stripeCustomerId: string
    organizationId: string
    documentId: string
}

export type AiModelId = `${string}:${string}`

export type TokensUsage = {
    eventMeta: EventMeta
    aiModelMetaInfo: AiModel
    aiVendorRequestId: string
    aiVendorModelName: string
    usage: {
        promptTokens: number
        promptAudioTokens: number
        promptCachedTokens: number

        completionTokens: number
        completionAudioTokens: number
        completionReasoningTokens: number

        totalTokens: number
    }
    aiRequestReceivedAt: number
    aiRequestFinishedAt: number
}

export type TokensUsageEvent = {
    eventMeta: EventMeta
    aiModel: AiModelId
    aiVendorRequestId: string
    aiRequestReceivedAt: number
    aiRequestFinishedAt: number
    textPricePer: string
    textPromptPrice: string
    textCompletionPrice: string
    textPromptPriceResale: string
    textCompletionPriceResale: string
    prompt: {
        usageTokens: number
        cachedTokens: number
        audioTokens: number
        purchasedFor: string
        soldToClientFor: string
    }
    completion: {
        usageTokens: number
        reasoningTokens: number
        audioTokens: number
        purchasedFor: string
        soldToClientFor: string
    }
    total: {
        usageTokens: number
        purchasedFor: string
        soldToClientFor: string
    }
    image?: {
        generatedCount: number
        size: string
        purchasedFor: string
        soldToClientFor: string
    }
}

export type SNS_OutputMessage = {
    TopicArn: string
    Message: any
    MessageAttributes?: {
        [key: string]: {
            DataType: 'String' | 'String.Array' | 'Number' | 'Binary'
            Value?: string | Uint8Array
        }
    }
}

export type SQS_OutputMessage = {
    TopicArn: string
    Message: any
    messageAttributes?: {
        [key: string]: {
            dataType: 'String' | `String.${string}` | 'Number' | `Number.${string}` | 'Binary' | `Binary.${string}`;
            stringValue?: string;
            binaryValue?: Uint8Array;
        }
    }
}

export type FinancialTransaction = {
    userId: string
    provider: 'Stripe'
    transactionId: string
    amount_decimal: string
    currency: string
    description: string
    status: string
    rawEvent: Record<string, any>
    createdAt: number
}

export type AiChatThreadStatus = 'active' | 'paused' | 'completed'

export type AiChatThreadOwner = { type: 'standalone' }

export type AiChatThread = {
    workspaceId: string
    threadId: string
    content: object
    aiModel: string
    title?: string
    owner?: AiChatThreadOwner
    status: AiChatThreadStatus
    createdAt: number
    updatedAt: number
}
