import {
    type AiModel,
    type AiModelInferenceProvider,
} from '@lixpi/constants'

// Identity and measured dimensions associated with one provider call.
export type UsageEventMeta = {
    userId?: string
    organizationId?: string
    workspaceId?: string
    documentId?: string
    aiChatThreadId?: string
    [key: string]: unknown
}

// What one text call consumed. Cached tokens are a subset of prompt tokens and
// reasoning tokens a subset of completion tokens, for normalized provider usage.
export type TokenUsageCounts = {
    promptTokens: number
    promptAudioTokens: number
    promptCachedTokens: number
    completionTokens: number
    completionAudioTokens: number
    completionReasoningTokens: number
    totalTokens: number
}

export type ImageUsageCounts = {
    generatedCount: number
    size: string
    quality: string
}

export type VideoUsageCounts = {
    durationSeconds: number
    resolution: string
    aspectRatio: string
    // Vendor token usage for token-metered video providers (Seedance via ModelArk).
    // Absent for per-second providers like VEO, which the rate's `measuringUnit`
    // distinguishes.
    completionTokens?: number
    totalTokens?: number
}

// What a model costs at one endpoint. Rates are strings because a float loses money.
export type AiModelPricing = {
    currency: string
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
    // Per second of generated video (VEO) or per vendor video token (Seedance).
    // `price` is the flat rate. `tiers` carries per-resolution rates for vendors
    // that also price on whether the input contained video, keyed by the same
    // values as videoResolutions; a matching tier wins, `price` is the fallback.
    video?: {
        measuringUnit: string
        pricePer: string
        price: string
        tiers?: Record<string, {
            withoutVideoInput: string
            withVideoInput: string
        }>
    }
}

// The catalog's view of an endpoint plus what the model costs there. `@lixpi/constants`
// describes the model as the browser sees it, with no rates at all; adding them is
// this package's job. See ../documentation/PRICING-PER-ENDPOINT.md.
export type PricedInferenceProvider = AiModelInferenceProvider & {
    pricing?: AiModelPricing
}

export type PricedAiModel = Omit<AiModel, 'inferenceProviders'> & {
    inferenceProviders?: Record<string, PricedInferenceProvider>
}

// Enough of a catalog record to price a call, so a caller can pass what it already
// holds instead of casting to the full model.
export type PricedModelFields = {
    inferenceProviderCalledByThePlatform?: string
    inferenceProviders?: Record<string, {
        isCalledByThePlatform?: boolean
        pricing?: AiModelPricing
    }>
}

// The model a report or an estimate is about. Metering reads identity and rates; the
// rest of the record travels untouched.
export type MeteredAiModel = PricedModelFields & {
    provider: string
    model: string
    modelVersion?: string
    contextWindow?: number
    maxCompletionSize?: number
    [key: string]: unknown
}
