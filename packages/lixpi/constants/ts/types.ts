'use strict'

import type { Merge, Except } from 'type-fest'

export const PROVIDER_NAMES = ['OpenAI', 'Anthropic', 'Google', 'Stability', 'BytePlus'] as const
export type ProviderName = typeof PROVIDER_NAMES[number]

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

// Detected media kind. Drives canvas node type, serving headers, and which
// transcoder runs. A fifth value is intentionally NOT added — a new kind means
// a new transcoder + renderer, by design (unified-upload Principle 4).
export type MediaKind = 'image' | 'video' | 'audio' | 'document'

// The stored-file record. `kind`/`modelSafe` are recorded on every uploaded or
// generated file; `canonical*` is present iff the original was not model-safe
// and a transcoded derivative was produced.
// One row of the ingest policy. Absence from MEDIA_POLICY == not allowed.
export type MediaPolicyEntry = {
    kind: MediaKind
    modelSafe: boolean          // true => no transcode needed
    canonicalMime: string       // target mime when modelSafe is false
}

// Allow-list: sniffed-mime -> policy. The single source of truth for what may
// be uploaded and what it transcodes to. The map keys are the exact sniffed
// MIME strings (authoritative); `canonicalMime` records the transcode target so
// the decision lives in data, not branching code.
export const MEDIA_POLICY: Readonly<Record<string, MediaPolicyEntry>> = {
    'image/png':       { kind: 'image', modelSafe: true,  canonicalMime: 'image/png' },
    'image/jpeg':      { kind: 'image', modelSafe: true,  canonicalMime: 'image/jpeg' },
    'image/webp':      { kind: 'image', modelSafe: true,  canonicalMime: 'image/webp' },
    'image/gif':       { kind: 'image', modelSafe: true,  canonicalMime: 'image/gif' },
    'image/svg+xml':   { kind: 'image', modelSafe: false, canonicalMime: 'image/png' },
    'image/avif':      { kind: 'image', modelSafe: false, canonicalMime: 'image/png' },
    'image/heic':      { kind: 'image', modelSafe: false, canonicalMime: 'image/jpeg' },
    'image/heif':      { kind: 'image', modelSafe: false, canonicalMime: 'image/jpeg' },
    'image/tiff':      { kind: 'image', modelSafe: false, canonicalMime: 'image/png' },
    'video/mp4':       { kind: 'video', modelSafe: true,  canonicalMime: 'video/mp4' },
    'video/quicktime': { kind: 'video', modelSafe: false, canonicalMime: 'video/mp4' },
    'video/webm':      { kind: 'video', modelSafe: false, canonicalMime: 'video/mp4' },
    'video/x-matroska':{ kind: 'video', modelSafe: false, canonicalMime: 'video/mp4' },
    'audio/mpeg':      { kind: 'audio', modelSafe: true,  canonicalMime: 'audio/mpeg' },
    'audio/wav':       { kind: 'audio', modelSafe: true,  canonicalMime: 'audio/wav' },
    'audio/mp4':       { kind: 'audio', modelSafe: false, canonicalMime: 'audio/mpeg' },
    'audio/x-m4a':     { kind: 'audio', modelSafe: false, canonicalMime: 'audio/mpeg' },
    'audio/aac':       { kind: 'audio', modelSafe: false, canonicalMime: 'audio/mpeg' },
    'audio/ogg':       { kind: 'audio', modelSafe: false, canonicalMime: 'audio/mpeg' },
    'audio/flac':      { kind: 'audio', modelSafe: false, canonicalMime: 'audio/mpeg' },
    'application/pdf': { kind: 'document', modelSafe: true,  canonicalMime: 'application/pdf' },
    'text/plain':      { kind: 'document', modelSafe: true,  canonicalMime: 'text/plain' },
    'text/markdown':   { kind: 'document', modelSafe: true,  canonicalMime: 'text/markdown' },
    'application/msword': { kind: 'document', modelSafe: false, canonicalMime: 'application/pdf' },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { kind: 'document', modelSafe: false, canonicalMime: 'application/pdf' },
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': { kind: 'document', modelSafe: false, canonicalMime: 'application/pdf' },
    'application/vnd.oasis.opendocument.text': { kind: 'document', modelSafe: false, canonicalMime: 'application/pdf' },
    'application/rtf': { kind: 'document', modelSafe: false, canonicalMime: 'application/pdf' },
}

// Deny-list: matched BEFORE the allow-list so these produce a specific
// "executables/scripts/archives are not permitted" error rather than a generic
// "unsupported type". Belt-and-suspenders on top of deny-by-default.
export const UPLOAD_DENYLIST_MIME: readonly string[] = [
    'application/x-msdownload', 'application/x-executable', 'application/x-mach-binary',
    'application/x-elf', 'application/vnd.microsoft.portable-executable',
    'application/x-sh', 'application/x-shellscript', 'text/x-shellscript',
    'application/zip', 'application/x-tar', 'application/gzip', 'application/x-rar-compressed', 'application/x-7z-compressed',
    'application/x-msi', 'application/x-apple-diskimage', 'application/java-archive',
    'application/vnd.ms-word.document.macroEnabled.12',
    'application/vnd.ms-excel.sheet.macroEnabled.12',
    'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
]

// 1 GiB ceiling for any uploaded file. The single upload size limit across the
// API route, remote-URL import, and the web-ui uploader.
export const MAX_UPLOAD_FILE_SIZE = 1024 * 1024 * 1024

// NOTE: 'document' is an editable content-Asset node (server-authoritative ProseMirror).
// Uploaded documents use the distinct 'mediaDocument' type to avoid colliding
// with it. 'audio' is the uploaded-audio node.
export type CanvasNodeType = 'document' | 'mediaDocument' | 'image' | 'video' | 'audio' | 'uploadPlaceholder' | 'branchOrigin' | 'branchFork' | 'branchLine'

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
    assetId: string
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
}

export type ImageGenerationSize =
    | '1024x1024'
    | '1536x1024'
    | '1024x1536'
    | '1:1'
    | '3:2'
    | '2:3'
    | '16:9'
    | '9:16'
    | '4:3'
    | '3:4'
    | '4:5'
    | '5:4'
    | '21:9'
    | '9:21'
    | 'auto'

export type ImageSizeOption = {
    value: string
    label: string
}

export type ImageSizeMode = 'resolution' | 'aspectRatio'

export type MediaGenerationConfigControlKey =
    | 'imageSize'
    | 'aspectRatio'
    | 'resolution'
    | 'duration'

export type MediaGenerationConfigControl = {
    key: MediaGenerationConfigControlKey
    label: string
    options: ImageSizeOption[]
    defaultValue?: string
}

export type MediaGenerationConfigGroup = {
    groupId: string
    mediaType: 'image' | 'video'
    provider: string
    providerTitle?: string
    title: string
    modelIds: AiModelId[]
    controls: MediaGenerationConfigControl[]
}

export type MediaGenerationConfigMatrix = {
    version: 'media-generation-config-matrix-v1'
    groups: MediaGenerationConfigGroup[]
}

export type MediaGenerationConfigSelectionGroup = {
    groupId: string
    modelIds: AiModelId[]
    values: Partial<Record<MediaGenerationConfigControlKey, string>>
}

// Capabilities a model can be marked as the catalog default for.
export type DefaultAiModelCapability = 'reasoning' | 'image' | 'video'

// Default model selection per capability. Configured in
// ai-models-synchronization (which flags the matching catalog records), derived
// by the API, and projected to the UI so dropdowns pre-select a sensible model
// instead of falling back to whatever happens to sort first.
export type DefaultAiModelSelection = Record<DefaultAiModelCapability, AiModelId>

export type AiModelsCatalogResponse = {
    models: Omit<AiModel, 'pricing'>[]
    mediaGenerationConfigMatrix: MediaGenerationConfigMatrix
    defaultModels: DefaultAiModelSelection
}

export type ImageGenerationOperationKind = 'new_image' | 'edit_existing' | 'style_transfer' | 'compare_branches' | 'fresh_branch'

export type MediaBranchSelectionMode = 'context-only' | 'edit-active-branch' | 'all-branches' | 'fresh-branch' | 'ambiguous'

export type MediaBranchCandidateRoleHint =
    | 'base-context'
    | 'generated-variant'
    | 'branch-leaf'
    | 'branch-ancestor'
    | 'embedded-thread-image'
    | 'active-target'

export type MediaBranchCandidateImage = {
    nodeId: string
    assetId: string
    imageUrl: string
    // Whether `imageUrl` points at a still image or at a video's representative
    // frame. Videos are grounded by a single extracted frame — never the MP4 —
    // so the resolver pays the same per-candidate cost regardless of media type.
    // Defaults to 'image' when absent so existing image candidates are unchanged.
    mediaKind?: 'image' | 'video'
    roleHints: MediaBranchCandidateRoleHint[]
    branchId?: string
    parentMediaNodeId?: string
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

export type MediaBranchCandidateSnapshot = {
    resolverVersion: string
    conversationAssetId: string
    regionNodeId: string
    activeTargetNodeId?: string
    // Media node ids the user explicitly attached as context (chips / reference
    // selections). When present, the API resolvers must treat these as the
    // exclusive context — no other candidates may be evaluated or selected.
    // The candidate list itself stays unfiltered; the API is the source of truth.
    explicitReferenceNodeIds?: string[]
    promptText: string
    promptFingerprint: string
    candidates: MediaBranchCandidateImage[]
    transcriptContext: string
}

// One compact, descriptors-only entry per context-bearing canvas node. The
// browser builds these for the whole workspace each chat turn so the API
// relevance stage can rank on text alone. The API resolves Asset renditions
// only for the narrowed, selected set.
export type WorkspaceContextNode = {
    nodeId: string
    type: CanvasNodeType
    assetId?: string
    descriptorStatus?: ContentDescriptorStatus
    title?: string
    descriptorSummary?: string
    entityTags?: string[]
    styleTags?: string[]
    branchId?: string
    sourceConversationAssetId?: string
    isCurrentConversationGenerated?: boolean
    isExplicitChip: boolean
    isEdgeForced: boolean
}

export type WorkspaceContextSnapshot = {
    resolverVersion: string
    workspaceId: string
    conversationAssetId: string
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

export type MediaBranchReferenceRole =
    | 'target'
    | 'base-context'
    | 'style-reference'
    | 'comparison-target'
    | 'excluded'

export type MediaBranchVlmReferenceDecision = {
    nodeId: string
    role: MediaBranchReferenceRole
    reason: string
}

export type MediaBranchVlmResolution = {
    resolverKind: 'structured-vlm'
    resolverVersion: string
    resolverModelProvider: string
    resolverModelId: string
    mode: MediaBranchSelectionMode
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
    decisions: MediaBranchVlmReferenceDecision[]
}

export type BranchOriginProvenance = {
    kind: 'branch-root-fork-decision'
    promptText: string
    providedReferenceNodeIds?: string[]
    referenceNodeIds: string[]
    sourceContextNodeIds: string[]
    forked: boolean
    forkCount: number
}

export type BranchForkProvenance = {
    kind: 'reasoning-run'
    promptText: string
    providedReferenceNodeIds?: string[]
    referenceNodeIds: string[]
    sourceContextNodeIds: string[]
    reasoningRunId: string
    reasoningModelId: AiModelId
    reasoningIndex: number
}

// A branchLine marks a plain (non-split) branch continuation: exactly one media
// generation descends from its lineage source. Unlike branchFork it does not
// represent a split — it carries the prompt message that drove the continuation.
export type BranchLineProvenance = {
    kind: 'branch-continuation'
    promptText: string
    providedReferenceNodeIds?: string[]
    referenceNodeIds: string[]
    sourceContextNodeIds: string[]
    reasoningRunId: string
    reasoningModelId: AiModelId
    reasoningIndex: number
    mediaRunId?: string
    mediaModelId?: AiModelId
    mediaType?: 'image' | 'video'
}

export type BranchMarkerPendingState = {
    phase: 'preflight' | 'planned'
    promptText: string
    reasoningModelIds: AiModelId[]
    reasoningModelId?: AiModelId
    reasoningIndex?: number
    imageModelIds: AiModelId[]
    videoModelIds: AiModelId[]
}

export type BranchOriginLineagePlan = {
    nodeId: string
    generationRequestId: string
    branchId: string
    promptFingerprint?: string
    provenance: BranchOriginProvenance
}

export type BranchForkLineagePlan = {
    nodeId: string
    generationRequestId: string
    branchId: string
    parentBranchNodeId?: string
    reasoningRunId: string
    reasoningModelId: AiModelId
    reasoningIndex: number
    promptFingerprint?: string
    provenance: BranchForkProvenance
}

export type BranchLineLineagePlan = {
    nodeId: string
    generationRequestId: string
    branchId: string
    parentBranchNodeId: string
    reasoningRunId: string
    reasoningModelId: AiModelId
    reasoningIndex: number
    mediaRunId?: string
    mediaModelId?: AiModelId
    mediaType?: 'image' | 'video'
    promptFingerprint?: string
    provenance: BranchLineProvenance
}

export type MediaRunLineageAssignment = {
    assetId: string
    generationRequestId: string
    reasoningRunId?: string
    mediaRunId?: string
    reasoningModelId?: AiModelId
    reasoningIndex?: number
    mediaModelId?: AiModelId
    mediaType?: 'image' | 'video'
    mediaIndex?: number
    branchId: string
    parentMediaNodeId?: string
    // Image-named schema alias. Lineage code uses parentMediaNodeId so
    // image/video/future media share one contract.
    parentImageNodeId?: string
    branchOriginNodeId?: string
    branchForkNodeId?: string
    branchLineNodeId?: string
    lineageParentNodeId?: string
    referenceNodeIds: string[]
    sourceContextNodeIds: string[]
    operationKind?: ImageGenerationOperationKind
    promptText: string
    promptFingerprint?: string
    createdAt: number
}

export type MediaBranchLineagePlan = {
    planVersion: 'media-branch-lineage-v1'
    generationRequestId: string
    branchId: string
    promptText: string
    promptFingerprint?: string
    sourceNodeId?: string
    placementAnchorNodeId?: string
    referenceNodeIds: string[]
    sourceContextNodeIds: string[]
    branchOrigin?: BranchOriginLineagePlan
    branchForks: BranchForkLineagePlan[]
    branchLines: BranchLineLineagePlan[]
    runAssignments: MediaRunLineageAssignment[]
    createdAt: number
}

export type MediaBranchResolvedStreamPayload = {
    status: 'MEDIA_BRANCH_RESOLVED'
    aiProvider: string
    generationRun?: MediaGenerationRunMeta
    resolution: MediaBranchVlmResolution
}

export type MediaLineagePlannedStreamPayload = {
    status: 'MEDIA_LINEAGE_PLANNED'
    aiProvider: string
    generationRun?: MediaGenerationRunMeta
    lineagePlan: MediaBranchLineagePlan
}

// Published when a lineage plan was announced but the reasoning model finished
// without emitting a generate_image/generate_video tool call, so the planned
// media runs will never start. Lets the UI settle the pending markers instead
// of spinning forever.
export type MediaGenerationSkippedStreamPayload = {
    status: 'MEDIA_GENERATION_SKIPPED'
    aiProvider: string
    generationRun?: MediaGenerationRunMeta
    generationRequestId: string
}

export type MediaBranchResolutionErrorStreamPayload = {
    status: 'MEDIA_BRANCH_RESOLUTION_ERROR'
    aiProvider: string
    generationRun?: MediaGenerationRunMeta
    error: string
}

export type MediaGenerationRequestStartedPayload = {
    status: 'MEDIA_GENERATION_REQUEST_STARTED'
    aiProvider: string
    generationRequestId: string
    reasoningModelIds: AiModelId[]
    imageModelIds: AiModelId[]
    videoModelIds: AiModelId[]
    expectedReasoningRuns: number
    expectedMediaRunsUpperBound: number
}

export type MediaGenerationRequestCompletePayload = {
    status: 'MEDIA_GENERATION_REQUEST_COMPLETE'
    aiProvider: string
    generationRequestId: string
}

// One node's API-resolved canvas geometry. Positions are world-absolute for
// top-level nodes; parentNodeId is present for parent-relative positions.
export type CanvasNodeGeometry = {
    nodeId: string
    position: { x: number; y: number }
    dimensions: { width: number; height: number }
    parentNodeId?: string
}

// Authoritative canvas geometry resolved by the API after a lineage mutation
// (plan upsert, media upsert, settle). Carries every node the layout moved or
// resized — collision resolution can shift unrelated siblings — plus API-owned
// node/edge snapshots and removals for clients that have not locally seen
// projected pending nodes yet. layoutRevision is the persisted
// canvasStateUpdatedAt, so clients discard stale events that arrive out of
// order. Media projection updates include generationRequestId so a client that
// locally cancelled a request can ignore late upserts while still accepting the
// authoritative removal update.
export type CanvasGeometryUpdate = {
    generationRequestId?: string
    layoutRevision: number
    nodes: CanvasNodeGeometry[]
    nodeSnapshots?: CanvasNode[]
    removedNodeIds?: string[]
    edgeSnapshots?: WorkspaceEdge[]
    removedEdgeIds?: string[]
}

// Broadcast on the chat stream after an async canvas projection (lineage plan
// upsert / request settle) resolves, so every connected client applies the
// API-resolved geometry instead of computing its own layout.
export type CanvasGeometryResolvedStreamPayload = {
    status: 'CANVAS_GEOMETRY_RESOLVED'
    aiProvider: string
    generationRun?: MediaGenerationRunMeta
    canvasGeometry: CanvasGeometryUpdate
}

export type ContextRelevanceResolvedStreamPayload = {
    status: 'CONTEXT_RELEVANCE_RESOLVED'
    aiProvider: string
    generationRun?: MediaGenerationRunMeta
    workspaceContextResolution: WorkspaceContextResolution
}

export type ContextRelevanceErrorStreamPayload = {
    status: 'CONTEXT_RELEVANCE_ERROR'
    aiProvider: string
    generationRun?: MediaGenerationRunMeta
    error: string
}

export type ImageGenerationTraceReferenceRole = MediaBranchReferenceRole | 'feature-reference' | 'message-reference'

export type ImageGenerationTraceReference = {
    id: string
    imageUrl: string
    source: 'branch-candidate' | 'feature-reference' | 'message-reference'
    label: string
    role: ImageGenerationTraceReferenceRole
    nodeId?: string
    assetId?: string
    branchId?: string
    reason?: string
}

export type ImageGenerationTraceExcludedReference = {
    nodeId: string
    label: string
    role: 'excluded'
    reason: string
    assetId?: string
    branchId?: string
}

export type ImageGenerationTrace = {
    traceVersion: 'image-generation-trace-v1'
    generationRun?: MediaGenerationRunMeta
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
        mode: MediaBranchSelectionMode
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
    generationRun?: MediaGenerationRunMeta
    imageGenerationTrace: ImageGenerationTrace
}

export type ImageGenerationErrorStreamPayload = {
    status: 'IMAGE_ERROR'
    aiProvider: string
    generationRun?: MediaGenerationRunMeta
    error: string
}

// Mirrors ImageGenerationTrace but for VEO video generation. Reuses the same
// reference-trace shape so the frontend can render selected/excluded media
// candidates the same way it does for images.
export type VideoGenerationTrace = {
    traceVersion: 'video-generation-trace-v1'
    generationRun?: MediaGenerationRunMeta
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
        mode: MediaBranchSelectionMode
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
    generationRun?: MediaGenerationRunMeta
    videoGenerationTrace: VideoGenerationTrace
}

export type MediaGenerationRunMeta = {
    requestKind?: 'single-media' | 'media-generation-matrix'
    generationRequestId: string
    reasoningRunId: string
    mediaRunId?: string
    reasoningModelId: AiModelId
    mediaModelId?: AiModelId
    mediaType?: 'image' | 'video'
    reasoningIndex: number
    mediaIndex?: number
    variantIndex?: number
    lineageAssignment?: MediaRunLineageAssignment
}

export type GeneratedMediaVariantMetadata = {
    generationRequestId?: string
    reasoningRunId?: string
    mediaRunId?: string
    reasoningModelId?: AiModelId
    reasoningIndex?: number
    mediaModelId?: AiModelId
    mediaType?: 'image' | 'video'
    mediaIndex?: number
    variantIndex?: number
    // API-assigned lineage marker IDs. The browser applies these to canvas
    // state and may compute layout, but it must not derive branch topology.
    parentMediaNodeId?: string
    branchOriginNodeId?: string
    branchForkNodeId?: string
    branchLineNodeId?: string
    lineageParentNodeId?: string
}

export type ImageGeneratedByMetadata = GeneratedMediaVariantMetadata & {
    conversationAssetId: string
    responseId: string
    aiModel: AiModelId
    imageModelProvider?: string
    revisedPrompt: string
    responseMessageId?: string
    branchId?: string
    // Image-named schema alias for parentMediaNodeId.
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
// (image, video, or document) stored on the node so any feature can
// read it without re-deriving it. Media descriptors come from a VLM pass over the
// actual still/final frame; document descriptors are a text summary of the
// node's content (no pixels).
// Deliberately short so it can be fed into model context (e.g. the branch-resolver
// transcript, the workspace relevance snapshot) without bloat.
export type ContentDescriptorStatus = 'analyzing' | 'ready' | 'failed'

export type ContentDescriptor = {
    status: ContentDescriptorStatus
    summary: string
    entityTags: string[]
    styleTags: string[]
    // VLM caption (media) or text summary (document/conversation).
    source: 'analysis'
    version: string
    updatedAt: number
}

// Domain aliases keep media-focused call sites readable while sharing one shape.
export type MediaDescriptorStatus = ContentDescriptorStatus
export type MediaDescriptor = ContentDescriptor

export type ImageCanvasNode = CanvasNodeParentingFields & {
    nodeId: string
    type: 'image'
    assetId: string
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
    generatedBy?: ImageGeneratedByMetadata
}

// Provenance + lineage for an AI-generated video node. Mirrors
// ImageGeneratedByMetadata and reuses the same branch-lineage audit field
// names so the structured VLM resolver output maps over without translation.
export type VideoGeneratedByMetadata = GeneratedMediaVariantMetadata & {
    conversationAssetId: string
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
    // Image-named schema alias for parentMediaNodeId.
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

export type VideoCanvasNode = CanvasNodeParentingFields & {
    nodeId: string
    type: 'video'
    assetId: string
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
    generatedBy?: VideoGeneratedByMetadata
}

export type AudioCanvasNode = CanvasNodeParentingFields & {
    nodeId: string
    type: 'audio'
    assetId: string
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
}

export type DocumentMediaCanvasNode = CanvasNodeParentingFields & {
    nodeId: string
    type: 'mediaDocument'
    assetId: string
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
}

export type UploadPlaceholderCanvasNode = CanvasNodeParentingFields & {
    nodeId: string
    type: 'uploadPlaceholder'
    fileName: string
    status: 'converting' | 'failed'
    message?: string
    assetId?: string
    kind?: MediaKind
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
    createdAt: number
    updatedAt: number
}

export type BranchOriginCanvasNode = CanvasNodeParentingFields & {
    nodeId: string
    type: 'branchOrigin'
    branchId: string
    generationRequestId: string
    conversationAssetId?: string
    promptFingerprint?: string
    provenance?: BranchOriginProvenance
    pendingState?: BranchMarkerPendingState
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
    temporary: true
}

export type BranchForkCanvasNode = CanvasNodeParentingFields & {
    nodeId: string
    type: 'branchFork'
    branchId: string
    generationRequestId: string
    conversationAssetId?: string
    reasoningRunId?: string
    reasoningModelId?: AiModelId
    reasoningIndex?: number
    parentBranchNodeId?: string
    promptFingerprint?: string
    provenance?: BranchForkProvenance
    pendingState?: BranchMarkerPendingState
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
    temporary: true
}

export type BranchLineCanvasNode = CanvasNodeParentingFields & {
    nodeId: string
    type: 'branchLine'
    branchId: string
    generationRequestId: string
    conversationAssetId?: string
    reasoningRunId?: string
    reasoningModelId?: AiModelId
    reasoningIndex?: number
    mediaRunId?: string
    mediaModelId?: AiModelId
    mediaType?: 'image' | 'video'
    parentBranchNodeId?: string
    promptFingerprint?: string
    provenance?: BranchLineProvenance
    pendingState?: BranchMarkerPendingState
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
    temporary: true
}

export type CanvasNode = DocumentCanvasNode | DocumentMediaCanvasNode | ImageCanvasNode | VideoCanvasNode | AudioCanvasNode | UploadPlaceholderCanvasNode | BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode

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
    sourceMessageId?: string  // Links generated-media lineage to the originating aiResponseMessage in its conversation Asset
    pathType?: WorkspaceEdgePathType
}

// Feature access scopes are separate from Asset scopes: Features are org-wide
// and accessible across every workspace in the organization.
// 'shared' (external/cross-org sharing) is reserved for a future release and has
// no UI or code path yet.
export type FeatureScope = 'organization' | 'shared'
export type FeatureStatus = 'active' | 'reported' | 'removed'

export const FEATURE_SCOPE = {
    ORGANIZATION: 'organization',
    SHARED: 'shared',
} as const
export type FeatureScopeValue = typeof FEATURE_SCOPE[keyof typeof FEATURE_SCOPE]

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
    blobHash: string
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
// See documentation/conventions/MARKDOWN-RENDERING.md.
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
        assetId: string
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
    scopeAndOwner?: string    // PK of the Features-Meta table — `${scope}#${scopeOwnerId}`; present on persisted rows
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
    userText?: string
    modelConfig?: {
        analysisModelId?: string
        mediaModelId?: string
    }
    transcriptJson?: object
    sourceContextSnapshot?: object
    trace?: StageTraceEvent[]
    stageReasoning?: Record<string, string>
    featureCard?: Record<string, any>
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

// Right side panel top-level surface: the Feature library, the unified Asset
// library, or conversation Assets.
export type CanvasRightSidePanelMode = 'features' | 'media' | 'aiThreads'

export type CanvasAiChatPanelState = {
    isOpen: boolean
    isSessionHistoryOpen: boolean
    // Which top-level surface the right side panel shows. Defaults to 'aiThreads'.
    topLevelMode: CanvasRightSidePanelMode
    tabs: CanvasAiChatSidebarTab[]
    activeTabId?: string
    // Explicit canvas node ids fed to the bottom-center composer as context
    // chips. When any chip is present, the API uses exactly that chip set and
    // skips automatic relevance expansion.
    contextChips: string[]
    width?: number
}

export type CanvasFeatureExtractionState = {
    extractionRunId: string
    featureId?: string
    status: ExtractionRunStatus
    userText?: string
    aiProvider?: string
    modelConfig?: {
        analysisModelId?: string
        mediaModelId?: string
    }
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
    viewport: CanvasViewport
    sourceContext?: FeatureSourceContext
    nodes: CanvasNode[]
    edges: WorkspaceEdge[]
    lastActiveConversationAssetId?: string
    aiChatPanel?: CanvasAiChatPanelState
}

export type Workspace = {
    workspaceId: string
    organizationId: string
    name: string
    accessType: 'private' | 'public'
    accessList: {
        userId: string
        accessLevel: AccessLevel
    }[]
    canvasState: CanvasState
    createdAt: number
    canvasStateUpdatedAt?: number
    deletingAt?: number
    updatedAt: number
}

export type WorkspaceMeta = {
    workspaceId: string
    organizationId: string
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
    // Ordered reasoning-model selection (length 1 = singular). The scalar
    // provider path reads index 0; the matrix path reads the full list
    // via `mediaGenerationRequest.reasoningModelIds`.
    aiReasoningModels: AiModelId[]
    conversationAssetId: string
    referencedFeatureIds?: string[]
    mediaBranchCandidateSnapshot?: MediaBranchCandidateSnapshot
    mediaGenerationRequest?: AiInteractionMediaGenerationRequest
    // Whole-workspace, descriptors-only index sent each turn and consumed by
    // the API `resolveWorkspaceContext` relevance stage.
    workspaceContextSnapshot?: WorkspaceContextSnapshot
    canvasVisibleArea?: {
        width: number
        height: number
    }
}

export type AiInteractionMediaGenerationRequest = {
    requestVersion: 'media-generation-matrix-v1'
    generationRequestId: string
    useMultipleReasoningModels?: boolean
    useMultipleImageModels?: boolean
    useMultipleVideoModels?: boolean
    reasoningModelIds: AiModelId[]
    imageModelIds: AiModelId[]
    videoModelIds: AiModelId[]
    imageOptions?: {
        imageSize: ImageGenerationSize
        configGroups?: MediaGenerationConfigSelectionGroup[]
    }
    videoOptions?: {
        aspectRatio?: string
        resolution?: string
        duration?: string
        sourceVideoNodeId?: string
        sourceForExtension?: string
        configGroups?: MediaGenerationConfigSelectionGroup[]
    }
}

export type AiInteractionChatSendMessagePayloadV2 = AiInteractionChatSendMessagePayload & {
    mediaGenerationRequest: AiInteractionMediaGenerationRequest
}

export type AiInteractionImageGenerationPayload = AiInteractionChatSendMessagePayload & {
    aiImageModels: AiModelId[]
    imageSize?: ImageGenerationSize
    previousResponseId?: string
}

export type AiInteractionChatStopMessagePayload = {
    conversationAssetId: string
    generationRequestId?: string
}

export type AiModel = {
    provider: string
    model: string
    title: string
    shortTitle?: string
    // Human-facing provider brand name, e.g. "OpenAI" or "ByteDance" (the provider field
    // stays the internal key). Synced per model by ai-models-synchronization; consumers
    // concatenate it with title for a provider-attributed name ("ByteDance Seedance 2.0"),
    // or use it standalone where only the provider brand is needed.
    providerTitle?: string
    modelVersion: string
    imagePromptMaxChars?: number
    contextWindow: number
    maxCompletionSize: number
    defaultTemperature: number
    supportsSystemPrompt: boolean
    color: string
    iconName: string
    // Colored brand-icon variant key (e.g. geminiColorIcon). Synced per model by
    // ai-models-synchronization, which falls back to iconName when a provider has
    // no colored variant, so synced models always carry a usable value here.
    colorIconName?: string
    sortingPosition: number
    modalities: Array<{ modality: string; title: string; shortTitle: string }>
    // Describes what imageSizes values mean for this image-generation model.
    imageSizeMode?: ImageSizeMode
    imageSizes?: ImageSizeOption[]
    // Video generation option lists (VEO and future video providers). Reuse the
    // ImageSizeOption { value, label } shape the size dropdown already consumes.
    videoAspectRatios?: ImageSizeOption[]
    videoResolutions?: ImageSizeOption[]
    videoDurations?: ImageSizeOption[]
    // Max reference images this video model accepts (VEO 3, Seedance 9). Absent => 3.
    videoMaxReferenceImages?: number
    // Capabilities for which this model is the catalog default, set by
    // ai-models-synchronization. The API derives AiModelsCatalogResponse.defaultModels
    // from these flags so the UI can pre-select the configured defaults.
    isDefaultFor?: DefaultAiModelCapability[]
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
