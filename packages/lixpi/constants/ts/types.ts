'use strict'

import type { Merge, Except } from 'type-fest'

export const PROVIDER_NAMES = ['OpenAI', 'Anthropic', 'Google', 'Stability'] as const
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

export type AccessLevel = 'owner' | 'editor' | 'viewer'

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

export type CanvasNodeType = 'document' | 'image' | 'aiChatThread' | 'contextRegion'

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

export type ImageBranchCandidateImage = {
    nodeId: string
    fileId?: string
    workspaceId?: string
    imageUrl: string
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
    promptText: string
    promptFingerprint: string
    candidates: ImageBranchCandidateImage[]
    transcriptContext: string
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
}

export type AiChatThreadCanvasNode = CanvasNodeParentingFields & {
    nodeId: string
    type: 'aiChatThread'
    referenceId: string
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
}

export type ContextRegionCanvasNode = CanvasNodeParentingFields & {
    nodeId: string
    type: 'contextRegion'
    referenceId: string
    position: CanvasNodePosition
    dimensions: CanvasNodeDimensions
}

export type CanvasNode = DocumentCanvasNode | ImageCanvasNode | AiChatThreadCanvasNode | ContextRegionCanvasNode

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
    status: 'ok' | 'error' | 'skipped'
    errorMessage?: string
    inputSummary?: string
    outputSummary?: string
    outputBytes?: number
    metricTags?: Record<string, string | number>
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

export type CanvasFeatureExtractionState = {
    extractionRunId: string
    status: ExtractionRunStatus
    userText?: string
    aiProvider?: string
    stepDetails?: Record<string, string>
    reasoningText?: string
    featureCard?: Record<string, any>
    traceEvents?: StageTraceEvent[]
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

export type AiChatThread = {
    workspaceId: string
    threadId: string
    content: object
    aiModel: string
    status: AiChatThreadStatus
    createdAt: number
    updatedAt: number
}
