'use strict'

import type {
    MediaBranchCandidateSnapshot,
    MediaBranchVlmResolution,
    MediaBranchLineagePlan,
    MediaGenerationConfigSelectionGroup,
    MediaGenerationRunMeta,
    ProviderName,
    WorkspaceContextResolution,
    WorkspaceContextSnapshot,
} from '@lixpi/constants'

export type Usage = {
    promptTokens: number
    promptAudioTokens: number
    promptCachedTokens: number
    completionTokens: number
    completionAudioTokens: number
    completionReasoningTokens: number
    totalTokens: number
}

export type ImageUsage = {
    generatedCount: number
    size: string
    quality: string
}

export type VideoUsage = {
    durationSeconds: number
    resolution: string
    aspectRatio: string
    // Vendor token usage for token-metered video providers (e.g. Seedance via
    // ModelArk). Absent for per-second providers like VEO. Billing branches on
    // pricing.video.measuringUnit (see usage-reporter.reportVideoUsage).
    completionTokens?: number
    totalTokens?: number
}

export type EventMeta = {
    userId?: string
    stripeCustomerId?: string
    organizationId?: string
    workspaceId?: string
    aiChatThreadId?: string
    [key: string]: unknown
}

export type AiModelMetaInfo = {
    provider: string
    model: string
    modelVersion: string
    maxCompletionSize?: number
    defaultTemperature?: number
    supportsSystemPrompt?: boolean
    imagePromptMaxChars?: number
    videoMaxReferenceImages?: number
    pricing?: Record<string, any>
    [key: string]: unknown
}

export type MediaFanoutPlan = {
    generationRequestId: string
    imageModels: AiModelMetaInfo[]
    videoModels: AiModelMetaInfo[]
    imageSize?: string
    imageModelOptions?: Record<string, { imageSize?: string }>
    videoAspectRatio?: string
    videoResolution?: string
    videoDuration?: string | number
    videoDurationSeconds?: number
    videoModelOptions?: Record<string, { aspectRatio?: string; resolution?: string; duration?: string | number }>
    videoSourceForExtension?: string
    imageConfigGroups?: MediaGenerationConfigSelectionGroup[]
    videoConfigGroups?: MediaGenerationConfigSelectionGroup[]
    replayPrompts?: ReplayMediaPrompt[]
}

export type ReplayMediaPrompt = {
    reasoningModelId: string
    mediaModelId: string
    mediaType: 'image' | 'video'
    finalPrompt: string
}

// Reference-image cap for the selected video model. VEO accepts 3, Seedance 9.
// Reads from the video model's metadata and falls back to the VEO baseline when
// the field is absent, so existing video models stay capped at 3. Single source
// of truth shared by the VideoRouter and the media-branch resolver (the two
// places the cap is applied) so the value is never duplicated.
export const DEFAULT_VIDEO_MAX_REFERENCE_IMAGES = 3

export const getVideoMaxReferenceImages = (meta: AiModelMetaInfo | undefined): number => {
    const raw = meta?.videoMaxReferenceImages
    return typeof raw === 'number' && raw > 0 ? raw : DEFAULT_VIDEO_MAX_REFERENCE_IMAGES
}

export type ChatMessage = {
    role: 'user' | 'assistant' | 'system' | string
    content: string | Array<Record<string, any>>
}

export type ProviderState = {
    // Required inputs
    messages: ChatMessage[]
    aiModelMetaInfo: AiModelMetaInfo
    eventMeta: EventMeta
    workspaceId: string
    aiChatThreadId: string
    instanceKey: string

    // Provider config
    provider: ProviderName
    modelVersion: string
    maxCompletionSize?: number | undefined
    temperature: number

    // Stream state
    streamActive: boolean
    error?: string | undefined
    errorCode?: string | undefined
    errorType?: string | undefined

    // Usage / response IDs
    usage?: Partial<Usage> | undefined
    responseId?: string | undefined
    aiVendorRequestId?: string | undefined
    aiRequestReceivedAt: number
    aiRequestFinishedAt?: number | undefined

    // Image generation
    enableImageGeneration?: boolean | undefined
    imageSize?: string | undefined
    imageUsage?: ImageUsage | undefined
    imageModelMetaInfo?: AiModelMetaInfo | undefined
    imageModelVersion?: string | undefined
    imageProviderName?: ProviderName | undefined

    // Tool-calling: dual-model image routing
    generatedImagePrompt?: string | undefined
    referenceImages?: string[] | undefined
    featureReferenceImages?: string[] | undefined
    featureReferenceImageTraceUrls?: string[] | undefined
    imagePromptRetryCount?: number | undefined
    generatedImages?: string[] | undefined
    workspaceContextSnapshot?: WorkspaceContextSnapshot | undefined
    workspaceContextResolution?: WorkspaceContextResolution | undefined
    mediaBranchCandidateSnapshot?: MediaBranchCandidateSnapshot | undefined
    mediaBranchResolution?: MediaBranchVlmResolution | undefined
    mediaBranchLineagePlan?: MediaBranchLineagePlan | undefined
    canvasVisibleArea?: { width: number; height: number } | undefined

    // Video generation (VEO) — async submit/poll routing. Mirrors the image
    // fields above; the VLM branch resolution is shared (reused for first-frame
    // + reference selection), so no separate video resolution field is needed.
    enableVideoGeneration?: boolean | undefined
    videoModelMetaInfo?: AiModelMetaInfo | undefined
    videoModelVersion?: string | undefined
    videoProviderName?: ProviderName | undefined
    videoAspectRatio?: string | undefined
    videoResolution?: string | undefined
    videoDurationSeconds?: number | undefined
    generatedVideoPrompt?: string | undefined
    videoFirstFrameImage?: string | undefined
    videoReferenceImages?: string[] | undefined
    videoSourceForExtension?: string | undefined
    generatedVideos?: string[] | undefined
    videoUsage?: VideoUsage | undefined

    // Multi-turn editing (OpenAI Responses API)
    previousResponseId?: string | undefined

    // Feature reference resolution (/use chips on chat messages)
    referencedFeatureIds?: string[] | undefined
    featureUsagePrompt?: string | undefined

    // Multi-model media generation request-group metadata.
    generationRun?: MediaGenerationRunMeta | undefined
    mediaFanoutPlan?: MediaFanoutPlan | undefined
    replayMediaPrompts?: ReplayMediaPrompt[] | undefined
    preflightResolved?: boolean | undefined
}

// replace if defined, else keep — mirrors Python TypedDict(total=False) partial-overlay semantics
const keep = <T>(curr: T | undefined, next: T | undefined): T | undefined =>
    next !== undefined ? next : curr

export const channels: Record<keyof ProviderState, { reducer: typeof keep; default?: () => any }> = {
    messages: { reducer: keep, default: () => [] },
    aiModelMetaInfo: { reducer: keep },
    eventMeta: { reducer: keep, default: () => ({}) },
    workspaceId: { reducer: keep },
    aiChatThreadId: { reducer: keep },
    instanceKey: { reducer: keep },
    provider: { reducer: keep },
    modelVersion: { reducer: keep },
    maxCompletionSize: { reducer: keep },
    temperature: { reducer: keep, default: () => 0.7 },
    streamActive: { reducer: keep, default: () => false },
    error: { reducer: keep },
    errorCode: { reducer: keep },
    errorType: { reducer: keep },
    usage: { reducer: keep },
    responseId: { reducer: keep },
    aiVendorRequestId: { reducer: keep },
    aiRequestReceivedAt: { reducer: keep },
    aiRequestFinishedAt: { reducer: keep },
    enableImageGeneration: { reducer: keep, default: () => false },
    imageSize: { reducer: keep, default: () => 'auto' },
    imageUsage: { reducer: keep },
    imageModelMetaInfo: { reducer: keep },
    imageModelVersion: { reducer: keep },
    imageProviderName: { reducer: keep },
    generatedImagePrompt: { reducer: keep },
    referenceImages: { reducer: keep },
    featureReferenceImages: { reducer: keep },
    featureReferenceImageTraceUrls: { reducer: keep },
    imagePromptRetryCount: { reducer: keep, default: () => 0 },
    generatedImages: { reducer: keep },
    workspaceContextSnapshot: { reducer: keep },
    workspaceContextResolution: { reducer: keep },
    mediaBranchCandidateSnapshot: { reducer: keep },
    mediaBranchResolution: { reducer: keep },
    mediaBranchLineagePlan: { reducer: keep },
    canvasVisibleArea: { reducer: keep },
    enableVideoGeneration: { reducer: keep, default: () => false },
    videoModelMetaInfo: { reducer: keep },
    videoModelVersion: { reducer: keep },
    videoProviderName: { reducer: keep },
    videoAspectRatio: { reducer: keep },
    videoResolution: { reducer: keep },
    videoDurationSeconds: { reducer: keep },
    generatedVideoPrompt: { reducer: keep },
    videoFirstFrameImage: { reducer: keep },
    videoReferenceImages: { reducer: keep },
    videoSourceForExtension: { reducer: keep },
    generatedVideos: { reducer: keep },
    videoUsage: { reducer: keep },
    previousResponseId: { reducer: keep },
    referencedFeatureIds: { reducer: keep },
    featureUsagePrompt: { reducer: keep },
    generationRun: { reducer: keep },
    mediaFanoutPlan: { reducer: keep },
    replayMediaPrompts: { reducer: keep },
    preflightResolved: { reducer: keep, default: () => false },
}
