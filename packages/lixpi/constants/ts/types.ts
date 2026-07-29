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
export type CanvasNodeType = 'document' | 'mediaDocument' | 'image' | 'video' | 'audio' | 'uploadPlaceholder' | 'branchOrigin' | 'branchFork' | 'branchLine' | 'capabilityArtifact'

export type CanvasNodePosition = {
    x: number
    y: number
}

export type CanvasNodeDimensions = {
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
    candidateId: string
    nodeId?: string
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
    activeTargetCandidateId?: string
    // Candidate identities the user explicitly attached in the message or
    // composer context. Asset-only references have no canvas node, so resolver
    // routing must never key on nodeId. The API filters against this allowlist
    // before authorizing or resolving candidate media.
    explicitReferenceCandidateIds?: string[]
    promptText: string
    promptFingerprint: string
    candidates: MediaBranchCandidateImage[]
    transcriptContext: string
}

// One compact entry per canvas node explicitly attached to the submitted turn.
// Unselected workspace nodes are omitted from the request.
export type WorkspaceContextNode = {
    nodeId: string
    type: CanvasNodeType
    assetId?: string
    artifactTypeId?: string
    descriptorStatus?: ContentDescriptorStatus
    title?: string
    descriptorSummary?: string
    entityTags?: string[]
    styleTags?: string[]
    branchId?: string
    sourceConversationAssetId?: string
    isCurrentConversationGenerated?: boolean
    isExplicitChip: boolean
    // Transport compatibility only. Context resolution ignores canvas edges.
    isEdgeForced: boolean
}

export type WorkspaceContextSnapshot = {
    resolverVersion: string
    workspaceId: string
    conversationAssetId: string
    promptText: string
    nodes: WorkspaceContextNode[]
}

export type WorkspaceContextSelectionRole = 'forced-chip'

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
    candidateId: string
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
    targetCandidateId: string | null
    parentCandidateId?: string
    branchId: string | null
    includeGeneratedCandidateIds: string[]
    referenceCandidateIds: string[]
    sourceContextNodeIds: string[]
    styleReferenceCandidateIds: string[]
    excludedCandidateIds: string[]
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
    reasoningResponseText?: string
    providedReferenceNodeIds?: string[]
    referenceNodeIds: string[]
    sourceContextNodeIds: string[]
    forked: boolean
    forkCount: number
}

export type BranchForkProvenance = {
    kind: 'reasoning-run'
    promptText: string
    reasoningResponseText?: string
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
    reasoningResponseText?: string
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
    referenceAssetIds: string[]
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
    referenceAssetIds: string[]
    referenceNodeIds: string[]
    sourceContextNodeIds: string[]
    regenerationTarget?: {
        branchId: string
        lineageParentNodeId: string
        lineageParentType: 'branchOrigin' | 'branchFork' | 'branchLine'
    }
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

export type ImageGenerationTraceReferenceRole = MediaBranchReferenceRole | 'capability-reference' | 'message-reference'

export type ImageGenerationTraceReference = {
    id: string
    imageUrl: string
    source: 'branch-candidate' | 'capability-reference' | 'message-reference'
    label: string
    role: ImageGenerationTraceReferenceRole
    candidateId?: string
    nodeId?: string
    assetId?: string
    branchId?: string
    reason?: string
}

export type ImageGenerationTraceExcludedReference = {
    candidateId: string
    nodeId?: string
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
        targetCandidateId: string | null
        parentCandidateId?: string
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
        targetCandidateId: string | null
        parentCandidateId?: string
        branchId: string | null
    }
}

export type VideoGenerationTraceStreamPayload = {
    status: 'VIDEO_GENERATION_TRACE'
    aiProvider: string
    generationRun?: MediaGenerationRunMeta
    videoGenerationTrace: VideoGenerationTrace
}

export type CapabilityGenerationTraceStep = {
    stepId: string
    title: string
    status: 'completed' | 'skipped' | 'failed' | 'cancelled'
    inputSummary?: string
    outputSummary?: string
    errorMessage?: string
}

export type CapabilityGenerationTrace = {
    traceVersion: 'capability-generation-trace-v1'
    generationRun?: MediaGenerationRunMeta
    capabilityId: string
    capabilityName: string
    capabilityRunId: string
    chatModelProvider: string
    chatModelId: string
    input: Record<string, CapabilityJsonValue>
    outputAssetIds: string[]
    steps: CapabilityGenerationTraceStep[]
}

export type CapabilityGenerationTraceStreamPayload = {
    status: 'CAPABILITY_GENERATION_TRACE'
    aiProvider: string
    generationRun?: MediaGenerationRunMeta
    capabilityGenerationTrace: CapabilityGenerationTrace
}

export type MediaGenerationRunMeta = {
    requestKind?: 'single-media' | 'media-generation-matrix' | 'capability-output'
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

export type GeneratedOutputVariantMetadata = {
    outputKind?: 'image' | 'video' | 'capabilityArtifact'
    // Branch lineage is assigned by the API for every generated output kind,
    // artifacts included, so it belongs to the shared variant metadata.
    branchId?: string
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
    referenceAssetIds?: string[]
    // Durable fallback for generated-output chrome when the conversation
    // document has not resumed yet or its lineage marker is unavailable.
    promptText?: string
}

export type GeneratedMediaVariantMetadata = GeneratedOutputVariantMetadata

export type MediaGenerationCanvasPhase = 'pending-before-first-frame' | 'ready'

export type GeneratedOutputReviewScope = 'output-node' | 'branch-lineage'

export type GeneratedOutputReviewAction = 'accept' | 'supersede'

export type GeneratedOutputReviewRequest = {
    workspaceId: string
    scope: GeneratedOutputReviewScope
    action: 'accept'
    nodeId: string
} | {
    workspaceId: string
    scope: 'output-node'
    action: 'supersede'
    nodeId: string
    preserveLineage: true
} | {
    workspaceId: string
    scope: 'branch-lineage'
    action: 'supersede'
    nodeId: string
    preserveLineage: boolean
}

export type GeneratedOutputReviewResponse = {
    success: true
    workspaceId: string
    affectedAssetIds: string[]
    acceptedAssetIds: string[]
    supersededAssetIds: string[]
    canvasGeometry: CanvasGeometryUpdate
}

export type ImageGeneratedByMetadata = GeneratedMediaVariantMetadata & {
    conversationAssetId: string
    responseId: string
    aiModel: AiModelId
    imageModelProvider?: string
    revisedPrompt: string
    responseMessageId?: string
    // Image-named schema alias for parentMediaNodeId.
    parentImageNodeId?: string
    sourceContextNodeIds?: string[]
    referenceImageNodeIds?: string[]
    operationKind?: ImageGenerationOperationKind
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
    // API-persisted layout footprint. Asset remains authoritative for media lifecycle and renditions.
    mediaGenerationPhase?: MediaGenerationCanvasPhase
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
    // Image-named schema alias for parentMediaNodeId.
    parentImageNodeId?: string
    sourceContextNodeIds?: string[]
    referenceImageNodeIds?: string[]
    operationKind?: ImageGenerationOperationKind
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
    // API-persisted layout footprint. Asset remains authoritative for media lifecycle and renditions.
    mediaGenerationPhase?: MediaGenerationCanvasPhase
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

export type CapabilityArtifactGeneratedByMetadata = GeneratedOutputVariantMetadata & {
    outputKind: 'capabilityArtifact'
    conversationAssetId: string
    responseMessageId?: string
    capabilityRunId: string
    capabilityId: string
    toolId: string
    input: Record<string, CapabilityJsonValue>
}

export type CapabilityArtifactCanvasNode = CanvasNodeParentingFields & {
    nodeId: string
    type: 'capabilityArtifact'
    artifactTypeId: string
    assetId: string
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
    generatedBy?: CapabilityArtifactGeneratedByMetadata
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

export type CanvasNode = DocumentCanvasNode | DocumentMediaCanvasNode | ImageCanvasNode | VideoCanvasNode | AudioCanvasNode | UploadPlaceholderCanvasNode | BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode | CapabilityArtifactCanvasNode

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

export type CapabilityKind = 'tool' | 'skill'
export type CapabilityScope = 'user' | 'organization' | 'global'
export type CapabilityStatus = 'active' | 'disabled' | 'removed'
export type CapabilityPackageExposure = 'standalone' | 'module-internal'

export type CapabilityJsonPrimitive = string | number | boolean | null
export type CapabilityJsonValue =
    | CapabilityJsonPrimitive
    | CapabilityJsonValue[]
    | { [key: string]: CapabilityJsonValue }

export type CapabilityReference = {
    capabilityId: string
    kind: CapabilityKind
    import?: string[]
}

export type CapabilityPromptReference = {
    capabilityId: string
    kind: CapabilityKind
}

export type PromptReferenceType = 'media' | 'capability-artifact' | 'capability-module' | 'tool' | 'skill'

export type MediaPromptReference = {
    referenceType: 'media'
    assetId: string
    nodeId?: string
    mediaKind: 'image' | 'video' | 'audio' | 'document'
}

export type CapabilityModulePromptReference = {
    referenceType: 'capability-module'
    moduleId: string
}

export type CapabilityArtifactPromptReference = {
    referenceType: 'capability-artifact'
    artifactTypeId: string
    assetId: string
    nodeId?: string
}

export type StandaloneCapabilityPromptReference = {
    referenceType: CapabilityKind
    capabilityId: string
}

export type PromptReference =
    | MediaPromptReference
    | CapabilityArtifactPromptReference
    | CapabilityModulePromptReference
    | StandaloneCapabilityPromptReference

export type PromptReferenceAtomAttrs = PromptReference & {
    displayName: string
}

export type PromptReferenceCategory = 'media' | 'artifacts' | 'capabilities' | 'tools' | 'skills'

export type MediaPromptReferenceCatalogItem = MediaPromptReference & {
    referenceId: string
    source: 'canvas' | 'library'
    title: string
    scope: 'workspace' | 'user' | 'organization'
    updatedAt: number
    thumbnailAvailable?: boolean
}

export type CapabilityModulePromptReferenceCatalogItem = CapabilityModuleMeta & {
    referenceType: 'capability-module'
    referenceId: string
}

export type CapabilityArtifactPromptReferenceCatalogItem = CapabilityArtifactPromptReference & {
    referenceId: string
    source: 'canvas' | 'library'
    title: string
    scope: 'workspace' | 'user' | 'organization'
    updatedAt: number
    displayMetadata: Record<string, CapabilityJsonValue>
    referenceThumbnailAssetIds: string[]
}

export type StandaloneCapabilityPromptReferenceCatalogItem = CapabilityMeta & {
    referenceType: CapabilityKind
    referenceId: string
}

export type PromptReferenceCatalogItem =
    | MediaPromptReferenceCatalogItem
    | CapabilityArtifactPromptReferenceCatalogItem
    | CapabilityModulePromptReferenceCatalogItem
    | StandaloneCapabilityPromptReferenceCatalogItem

export type PromptReferenceCatalogPage = {
    items: PromptReferenceCatalogItem[]
    cursor?: string
}

export type PromptReferenceRecent = {
    userId: string
    referenceKey: string
    referenceType: PromptReferenceType
    referenceId: string
    updatedAt: number
}

export type CapabilityModuleMeta = {
    moduleId: string
    name: string
    normalizedName: string
    summary: string
    tags: string[]
    status: Extract<CapabilityStatus, 'active' | 'disabled'>
}

export type CapabilityCatalogRecord = {
    capabilityId: string
    kind: CapabilityKind
    scope: CapabilityScope
    scopeOwnerId: string
    storageOwnerId: string
    manifestBlobHash: string
    parentModuleId?: string
    catalogExposure: CapabilityPackageExposure
    status: CapabilityStatus
    ownerUserId: string
    createdAt: number
    updatedAt: number
}

export type CapabilityMeta = {
    scopeAndOwner: string
    scope: CapabilityScope
    scopeOwnerId: string
    searchKey: string
    capabilityId: string
    kind: CapabilityKind
    name: string
    normalizedName: string
    summary: string
    tags: string[]
    manifestBlobHash: string
    parentModuleId?: string
    catalogExposure: CapabilityPackageExposure
    status: CapabilityStatus
    updatedAt: number
}

export type CapabilityResourceMediaType =
    | 'application/json'
    | 'application/schema+json'
    | 'text/markdown'
    | `image/${string}`

export type CapabilityResourceRole =
    | 'instructions'
    | 'reference'
    | 'schema'
    | 'example'
    | 'asset'

export type CapabilityResourceRef = {
    resourceId: string
    blobHash: string
    mediaType: CapabilityResourceMediaType
    role: CapabilityResourceRole
    name?: string
}

export type CapabilityInstructionExport = {
    resourceIds: string[]
}

export type CapabilityStepTemplateExport = {
    steps: CapabilityWorkflowStep[]
    outputs: Record<string, CapabilityValueBinding>
}

export type CapabilityExports = {
    instructions?: Record<string, CapabilityInstructionExport>
    stepTemplates?: Record<string, CapabilityStepTemplateExport>
}

export type CapabilityValueBinding =
    | { source: 'input'; path: string[] }
    | { source: 'step'; stepId: string; path: string[] }
    | { source: 'resource'; capabilityId?: string; resourceId: string }
    | { source: 'literal'; value: CapabilityJsonValue }

export type CapabilityComparisonOperator =
    | 'equals'
    | 'not-equals'
    | 'greater-than'
    | 'greater-than-or-equal'
    | 'less-than'
    | 'less-than-or-equal'
    | 'contains'

export type CapabilityCondition =
    | {
        type: 'compare'
        left: CapabilityValueBinding
        operator: CapabilityComparisonOperator
        right: CapabilityValueBinding
    }
    | { type: 'exists'; value: CapabilityValueBinding }
    | { type: 'all' | 'any'; conditions: CapabilityCondition[] }
    | { type: 'not'; condition: CapabilityCondition }

export type CapabilityWorkflowStep = {
    stepId: string
    title: string
    action: string
    dependsOn: string[]
    input: Record<string, CapabilityValueBinding>
    condition?: CapabilityCondition
    retry?: {
        maxAttempts: number
        backoffMs: number
    }
    progress: {
        group?: string
        exposeReasoning?: boolean
    }
}

export type CapabilityWorkflow = {
    steps: CapabilityWorkflowStep[]
    outputs: Record<string, CapabilityValueBinding>
}

export type CapabilityToolDefinition = {
    toolType: string
    inputSchema: CapabilityResourceRef
    outputSchema: CapabilityResourceRef
    executionPolicy: 'required' | 'model-required' | 'model-choice'
    executionMultiplicity: CapabilityExecutionMultiplicity
    modelAxisPolicy: CapabilityModelAxisPolicy
    workflow: CapabilityWorkflow
}

export type CapabilityExecutionMultiplicity = 'once' | 'per-reasoning-model'

export type CapabilityModelAxisPolicy = {
    reasoning: 'all-selected' | 'first-selected' | 'ignore'
    image: 'all-selected' | 'ignore'
    video: 'all-selected' | 'ignore'
    outputMode: 'capability-only' | 'continue-media-generation'
}

export type CapabilityReasoningModelVariant = {
    axis: 'reasoning-model'
    variantKey: string
    reasoningIndex: number
    reasoningModelId: AiModelId
    provider: ProviderName
    modelVersion: string
    contextWindow: number
    maxCompletionSize: number
}

export type CapabilityManifest = {
    schemaVersion: 1
    capabilityId: string
    kind: CapabilityKind
    name: string
    description: string
    references: CapabilityReference[]
    resources: CapabilityResourceRef[]
    exports?: CapabilityExports
    tool?: CapabilityToolDefinition
}

export type ResolvedCapability = {
    capabilityId: string
    kind: CapabilityKind
    manifestBlobHash: string
    manifest: CapabilityManifest
}

export type ResolvedCapabilityPlan = {
    rootCapabilityIds: string[]
    capabilities: ResolvedCapability[]
    resolvedManifests: Array<{
        capabilityId: string
        manifestBlobHash: string
    }>
}

export type CapabilityRunOrigin = 'prompt' | 'model' | 'panel'
export type CapabilityRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type CapabilityRunStepStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed' | 'cancelled'

export type CapabilityRun = {
    runId: string
    rootCapabilityId: string
    resolvedManifests: Array<{
        capabilityId: string
        manifestBlobHash: string
    }>
    workspaceId: string
    conversationAssetId?: string
    origin: CapabilityRunOrigin
    variant?: { axis: 'request'; variantKey: 'request' } | CapabilityReasoningModelVariant
    status: CapabilityRunStatus
    currentStepIds: string[]
    outputAssetIds: string[]
    eventStreamName: string
    createdAt: number
    updatedAt: number
}

export type CapabilityRunEventType =
    | 'RUN_STARTED'
    | 'STEP_STARTED'
    | 'STEP_COMPLETED'
    | 'STEP_SKIPPED'
    | 'STEP_FAILED'
    | 'STEP_CANCELLED'
    | 'RUN_COMPLETED'
    | 'RUN_FAILED'
    | 'RUN_CANCELLED'

export type CapabilityRunEvent = {
    runId: string
    sequence: number
    eventType: CapabilityRunEventType
    timestamp: number
    runStatus: CapabilityRunStatus
    stepId?: string
    stepTitle?: string
    stepStatus?: CapabilityRunStepStatus
    safeInputSummary?: string
    safeOutputSummary?: string
    outputAssetIds?: string[]
    canvasGeometry?: CanvasGeometryUpdate
    errorCode?: string
    errorMessage?: string
}

export type CapabilityRunEventStreamPayload = {
    status: 'CAPABILITY_RUN_EVENT'
    aiProvider: 'Capability'
    capabilityRunEvent: CapabilityRunEvent
    conversationAssetId: string
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

export type CanvasAiChatSidebarTab = {
    tabId: string
    type: 'thread'
    refId: string
    title: string
}

// Right side panel top-level surface: the Capability library, the unified Asset
// library, or conversation Assets.
export type CanvasRightSidePanelMode = 'capabilities' | 'artifacts' | 'media' | 'aiThreads'

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

export type CanvasState = {
    viewport: CanvasViewport
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
    // Ordered reasoning-model selection (length 1 = singular). The scalar
    // provider path reads index 0; the matrix path reads the full list
    // via `mediaGenerationRequest.reasoningModelIds`.
    aiReasoningModels: string[]
    conversationAssetId: string
    mediaBranchCandidateSnapshot?: MediaBranchCandidateSnapshot
    mediaGenerationRequest?: AiInteractionMediaGenerationRequest
    // Explicit composer context attached to this submitted turn.
    workspaceContextSnapshot?: WorkspaceContextSnapshot
    canvasVisibleArea?: {
        width: number
        height: number
    }
}

// Local editor submission contract. The browser uses these messages to update
// the persisted conversation document, but does not publish them to NATS; the
// API reconstructs the authoritative messages from that document instead.
export type AiInteractionChatSubmitPayload = AiInteractionChatSendMessagePayload & {
    messages: Array<{ role: string; content: MessageContent }>
}

export type AiInteractionMediaGenerationRequest = {
    requestVersion: 'media-generation-matrix-v1'
    generationRequestId: string
    outputMediaTypes?: Array<'image' | 'video'>
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
    regeneration?: {
        mode: 'existing-prompt'
        branchId: string
        lineageParentNodeId: string
        lineageParentType: 'branchOrigin' | 'branchFork' | 'branchLine'
        replayPrompts: Array<{
            sourceAssetId: string
            reasoningModelId: AiModelId
            mediaModelId: AiModelId
            mediaType: 'image' | 'video'
            finalPrompt: string
        }>
    } | {
        mode: 'regenerate-prompt'
        forceFreshLineage: true
    }
}

export type AiInteractionChatSendMessagePayloadV2 = AiInteractionChatSubmitPayload & {
    mediaGenerationRequest: AiInteractionMediaGenerationRequest
}

export type AiInteractionImageGenerationPayload = AiInteractionChatSubmitPayload & {
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
