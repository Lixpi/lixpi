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
export type DocumentFile = {
    id: string
    name: string
    mimeType: string            // SNIFFED mime of the stored original
    size: number
    uploadedAt: number
    kind: MediaKind             // detected media kind
    modelSafe: boolean          // is `mimeType` directly model-consumable?
    canonicalFileId?: string    // object key of the model-safe derivative
    canonicalMimeType?: string  // mime of that derivative
}

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

// Async file-conversion contract. The API stores the uploaded original, then
// hands the heavy transcode off to the NEX file-conversion workload over NATS
// request/reply (WORKSPACE_SUBJECTS.FILE_SUBJECTS.CONVERT). The workload reads
// the original from the workspace Object Store bucket, transcodes it, writes the
// canonical (+ poster) back, and replies with these hints — never carrying the
// bytes themselves over NATS. No heavy processing ever runs on the API.
export type ConvertFileRequest = {
    workspaceId: string
    fileId: string              // Object Store key of the stored original
    originalName: string
    mimeType: string            // sniffed mime of the original
    kind: MediaKind
    modelSafe: boolean          // when true the workload SKIPS transcode and only
                                // probes the original for hints (poster/duration/
                                // pageCount) — e.g. a model-safe mp4 still needs a
                                // poster frame, but no re-encode.
    canonicalMime: string       // transcode target from MEDIA_POLICY
}

export type ConvertFileResult =
    | {
          success: true
          // Present only when a transcode produced a derivative (non-model-safe
          // input). Absent when the original is already model-safe.
          canonicalFileId?: string
          canonicalMimeType?: string
          aspectRatio?: number
          durationSeconds?: number
          hasAudio?: boolean
          posterFileId?: string
          pageCount?: number
      }
    | {
          success: false
          error: string          // user-facing failure reason for the placeholder
      }

// Frame-extraction contract. The AI video-generation providers (VEO / Seedance)
// must not run ffmpeg on the API either — they stage the freshly generated video
// to a temp Object Store key in the workspace bucket and ask the file-conversion
// workload (WORKSPACE_SUBJECTS.FILE_SUBJECTS.EXTRACT_FRAMES) to extract the poster
// and the representative (image-to-video anchor) frame. The workload writes those
// frames back to temp keys and returns them; the provider reads them, then
// deletes all three temp objects.
export type ExtractFramesRequest = {
    workspaceId: string
    videoFileId: string         // temp Object Store key of the staged video
    atSeconds?: number          // representative-frame seek target (clip midpoint)
}

export type ExtractFramesResult =
    | {
          success: true
          posterFileId?: string   // temp Object Store key of the poster PNG
          frameFileId?: string    // temp Object Store key of the representative PNG
      }
    | {
          success: false
          error: string
      }

// Pushed to the browser on WORKSPACE_SUBJECTS.FILE_SUBJECTS.CONVERT_RESPONSE
// .<workspaceId>.<conversionId> once conversion settles, so the canvas can
// replace or fail the upload placeholder. `conversionId` correlates with the
// value the upload route returned.
export type ConvertFileNotification = {
    conversionId: string
    workspaceId: string
    fileId: string
} & ConvertFileResult

// NOTE: 'document' is the thread/text node (server-authoritative ProseMirror).
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
    referenceId: string
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
    // Text summary of the document's content for the workspace relevance engine.
    descriptor?: ContentDescriptor
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
    descriptorStatus?: ContentDescriptorStatus
    title?: string
    descriptorSummary?: string
    entityTags?: string[]
    styleTags?: string[]
    fileId?: string
    imageUrl?: string
    branchId?: string
    sourceThreadId?: string
    isCurrentThreadGenerated?: boolean
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

export type ImageBranchResolvedStreamPayload = {
    status: 'IMAGE_BRANCH_RESOLVED'
    aiProvider: string
    generationRun?: MediaGenerationRunMeta
    resolution: ImageBranchVlmResolution
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

export type ImageBranchResolutionErrorStreamPayload = {
    status: 'IMAGE_BRANCH_RESOLUTION_ERROR'
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
}

export type ImageGeneratedByMetadata = GeneratedMediaVariantMetadata & {
    aiChatThreadId: string
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
// (image, video, document, or aiChatThread) stored on the node so any feature can
// read it without re-deriving it. Media descriptors come from a VLM pass over the
// actual still/final frame; document/thread descriptors are a text summary of the
// node's content (no pixels).
// Deliberately short so it can be fed into model context (e.g. the branch-resolver
// transcript, the workspace relevance snapshot) without bloat.
export type ContentDescriptorStatus = 'analyzing' | 'ready' | 'failed'

export type ContentDescriptor = {
    status: ContentDescriptorStatus
    summary: string
    entityTags: string[]
    styleTags: string[]
    // 'analysis' = a VLM caption (media) or a text summary (document/thread).
    // 'generation' is a legacy persisted value and must not be written by new code.
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
export type VideoGeneratedByMetadata = GeneratedMediaVariantMetadata & {
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

// Uploaded-audio node. Mirrors VideoCanvasNode minus poster geometry — the
// canonical audio (MP3/WAV) lives in the workspace Object Store under `fileId`
// and is played through a DOM <audio> surface, the audio analogue of the DOM
// <video> surface used by VideoCanvasNode.
export type AudioCanvasNode = CanvasNodeParentingFields & {
    nodeId: string
    type: 'audio'
    fileId: string                // audio object key in workspace-{workspaceId}-files
    workspaceId: string
    src: string                   // tokenized audio URL (Range-capable file route)
    durationSeconds: number
    hasAudio: true
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
    descriptor?: MediaDescriptor
}

// Uploaded-document node (PDF or office doc converted to PDF, or plain
// text/Markdown). `posterFileId` is a first-page PNG render used by the PIXI
// media layer; `pageCount` drives the page badge. Distinct from the
// thread/text 'document' node (see CanvasNodeType note).
export type DocumentMediaCanvasNode = CanvasNodeParentingFields & {
    nodeId: string
    type: 'mediaDocument'
    fileId: string                // document object key in workspace-{workspaceId}-files
    workspaceId: string
    src: string                   // tokenized document URL (file route)
    posterFileId?: string         // first-page poster (an image object), if rendered
    posterSrc?: string            // tokenized poster image URL (PIXI low-LoD)
    pageCount?: number
    aspectRatio: number           // poster width / height (default to page ratio)
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
    descriptor?: ContentDescriptor
}

export type UploadPlaceholderCanvasNode = CanvasNodeParentingFields & {
    nodeId: string
    type: 'uploadPlaceholder'
    fileName: string
    status: 'converting' | 'failed'
    message?: string
    // Set while status === 'converting' so the canvas can re-attach to the async
    // file-conversion completion subject (CONVERT_RESPONSE.<workspaceId>.<conversionId>)
    // after a reload. `fileId`/`kind` let the re-attach build the real node.
    conversionId?: string
    fileId?: string
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
    aiChatThreadId?: string
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
    aiChatThreadId?: string
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
    aiChatThreadId?: string
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
    sourceMessageId?: string  // Links edge to a specific aiResponseMessage (by its id attr) within the source AI chat thread
    pathType?: WorkspaceEdgePathType
}

// Feature library access scopes. Intentionally distinct from MEDIA_LIBRARY_SCOPE:
// features are org-wide (accessible across every workspace in the organization).
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

// Media library access scopes mirror the feature library: items are org-wide
// (accessible across every workspace in the organization). 'shared' (sharing with
// external/global users) is reserved for a future release and has no UI or code path yet.
export const MEDIA_LIBRARY_SCOPE = {
    ORGANIZATION: 'organization',
    SHARED: 'shared',
} as const
export type MediaLibraryScope = typeof MEDIA_LIBRARY_SCOPE[keyof typeof MEDIA_LIBRARY_SCOPE]

// Features retain their existing persistence path and are adapted into the library UI.
export const MEDIA_LIBRARY_ITEM_KIND = {
    IMAGE: 'image',
    VIDEO: 'video',
    AUDIO: 'audio',
    DOCUMENT: 'document',
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
    AUDIO: 'audio',
    DOCUMENTS: 'documents',
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
    // Copied from the source canvas node so the saved item is self-contained: the
    // description/tags travel with the media and are restored when it is re-added,
    // instead of being re-analyzed from scratch in the destination workspace.
    descriptor?: MediaDescriptor
    createdAt: number
    updatedAt: number
}

export type MediaLibraryImageMeta = {
    itemId: string
    kind: 'image'
    displayName: string
    ownerUserId: string
    originWorkspaceId: string
    sourceFileId?: string         // source object key — lets save-time dedup query the meta partition
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
    // Self-contained description/tags copied from the source canvas node (see image item).
    descriptor?: MediaDescriptor
    createdAt: number
    updatedAt: number
}

export type MediaLibraryVideoMeta = {
    itemId: string
    kind: 'video'
    displayName: string
    ownerUserId: string
    originWorkspaceId: string
    sourceFileId?: string         // source object key — lets save-time dedup query the meta partition
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

// Audio items reuse the same scope/access model. The canonical audio (MP3/WAV)
// lives in the library asset bucket; there is no poster (audio has no still
// frame). Duration drives the panel's playback chip.
export type MediaLibraryAudioData = {
    durationSeconds: number
    hasAudio: true
}

export type MediaLibraryAudioItem = {
    itemId: string
    version: 1
    kind: 'audio'
    displayName: string
    ownerUserId: string
    originWorkspaceId: string
    sourceFileId: string          // workspace-{ws}-files audio object key the item was saved from
    scope: MediaLibraryScope
    scopeOwnerId: string
    scopeAndOwner: string
    status: MediaLibraryItemStatus
    asset: MediaLibraryAssetRef         // audio in library bucket
    audio: MediaLibraryAudioData
    descriptor?: MediaDescriptor
    createdAt: number
    updatedAt: number
}

export type MediaLibraryAudioMeta = {
    itemId: string
    kind: 'audio'
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
    previewUrl: string          // audio content route (Range-capable)
    createdAt: number
    updatedAt: number
}

// Document items reuse the same scope/access model. The canonical document (PDF
// or model-safe text) lives in the library asset bucket; `poster` is a separate
// first-page PNG so the panel can render a thumbnail without rendering the PDF.
export type MediaLibraryDocumentData = {
    pageCount?: number
    aspectRatio: number  // poster width / height
}

export type MediaLibraryDocumentItem = {
    itemId: string
    version: 1
    kind: 'document'
    displayName: string
    ownerUserId: string
    originWorkspaceId: string
    sourceFileId: string          // workspace-{ws}-files document object key the item was saved from
    sourcePosterFileId?: string   // workspace-{ws}-files poster object key (may be missing)
    scope: MediaLibraryScope
    scopeOwnerId: string
    scopeAndOwner: string
    status: MediaLibraryItemStatus
    asset: MediaLibraryAssetRef         // document in library bucket
    poster?: MediaLibraryAssetRef       // first-page PNG poster in library bucket
    document: MediaLibraryDocumentData
    descriptor?: ContentDescriptor
    createdAt: number
    updatedAt: number
}

export type MediaLibraryDocumentMeta = {
    itemId: string
    kind: 'document'
    displayName: string
    ownerUserId: string
    originWorkspaceId: string
    scope: MediaLibraryScope
    scopeOwnerId: string
    scopeAndOwner: string
    status: MediaLibraryItemStatus
    mimeType: string
    byteSize: number
    pageCount?: number
    aspectRatio: number
    previewUrl: string          // document content route
    posterPreviewUrl?: string   // poster image route (PNG/JPEG)
    createdAt: number
    updatedAt: number
}

// Unions for call-sites that switch on `kind`.
export type MediaLibraryItem = MediaLibraryImageItem | MediaLibraryVideoItem | MediaLibraryAudioItem | MediaLibraryDocumentItem
export type MediaLibraryMeta = MediaLibraryImageMeta | MediaLibraryVideoMeta | MediaLibraryAudioMeta | MediaLibraryDocumentMeta

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

// Right side panel top-level surface: the feature-extraction library, saved
// media (images + videos colocated), or the AI chat threads.
export type CanvasRightSidePanelMode = 'features' | 'media' | 'aiThreads'

export type CanvasAiChatPanelState = {
    isOpen: boolean
    isSessionHistoryOpen: boolean
    // Which top-level surface the right side panel shows. Defaults to 'aiThreads'.
    topLevelMode: CanvasRightSidePanelMode
    tabs: CanvasAiChatSidebarTab[]
    activeTabId?: string
    // Explicit force-included canvas node ids, fed to the bottom-center composer
    // as context chips. The workspace relevance engine (later phases) unions
    // these with its automatic picks — it may add, never drop them.
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
    sourceContext: FeatureSourceContext
    nodes: CanvasNode[]
    edges: WorkspaceEdge[]
    lastActiveAiChatThreadId?: string
    aiChatSidebarTabs?: CanvasAiChatSidebarTab[]
    activeAiChatSidebarTabId?: string
    aiChatPanel?: CanvasAiChatPanelState
    // Legacy workspace-state field. Current feature extraction state is owned by
    // API ExtractionRun records; clients may read this only to prune old pending
    // placeholders from saved workspaces.
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
    canvasStateUpdatedAt?: number
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
    documentId: string        // SK — immutable id within the workspace partition
    workspaceId: string       // PK — the scope the document is listed by
    title: string
    content: string
    proseMirrorVersion?: number
    createdAt: number
    updatedAt: number
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
    // Ordered reasoning-model selection (length 1 = singular). The legacy
    // single-model API path reads index 0; the matrix path reads the full list
    // via `mediaGenerationRequest.reasoningModelIds`.
    aiReasoningModels: AiModelId[]
    threadId: string
    referencedFeatureIds?: string[]
    imageBranchCandidateSnapshot?: ImageBranchCandidateSnapshot
    mediaGenerationRequest?: AiInteractionMediaGenerationRequest
    // Whole-workspace, descriptors-only index sent each turn; consumed by the
    // API `resolveWorkspaceContext` relevance stage (later phase).
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
    threadId: string
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
