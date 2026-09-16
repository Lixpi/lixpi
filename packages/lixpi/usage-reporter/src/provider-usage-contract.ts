// CROSS-REPO WIRE CONTRACT. Changes require explicit user allowance.
// The responder in another repository mirrors these JSON fields and the
// metrics.provider.* subjects. Update and release both repositories together.
// See ../documentation/METERING-PORT.md.

export const PROVIDER_USAGE_CONTRACT_VERSION = 1

export type MeteredModality = 'tokens' | 'image' | 'video'
export type UsageUnit = 'tokens' | 'images' | 'seconds'

export type ProviderRequestAuthorizationRequest = {
    orgId: string
    userId: string
    workspaceId?: string
    workflowId: string
    model: string
    modality: MeteredModality
    estimatedUnits: number
}

export type ProviderRequestAuthorizationReason =
    | 'request_denied'
    | 'invalid_request'
    | 'authorization_unavailable'

export type ProviderRequestAuthorizationResult = {
    authorized: boolean
    authorizationId?: string
    reason?: ProviderRequestAuthorizationReason
}

// Cached tokens are a subset of promptTokens. Reasoning tokens are a subset of
// completionTokens. Normalize provider usage before sending these dimensions.
export type MeasuredUsage = {
    promptTokens?: number
    completionTokens?: number
    cachedTokens?: number
    reasoningTokens?: number
    imageCount?: number
    imageSize?: string
    imageQuality?: string
    durationSeconds?: number
    resolution?: string
    videoTokens?: number
    // Whole seconds of source video, rounded up; absent or zero means no video input.
    inputVideoSeconds?: number
}

// The receiver deduplicates records by providerRequestId.
export type ProviderUsageRecordRequest = {
    providerRequestId: string
    authorizationId?: string
    orgId: string
    userId: string
    workspaceId?: string
    workflowId: string
    workflowSeq: number
    model: string
    modality: MeteredModality
    measuringUnit: UsageUnit
    usage: MeasuredUsage
    occurredAt: string
}

export type ProviderUsageRecordResult = {
    recorded: boolean
}
