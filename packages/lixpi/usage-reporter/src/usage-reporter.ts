import { pricingForCalledInferenceProvider } from './model-pricing.ts'
import {
    type MeteredAiModel,
    type TokenUsageCounts,
    type UsageEventMeta,
} from './types.ts'

type ProviderUsageIdentity = {
    eventMeta: UsageEventMeta
    aiModel: string
    modelVersion: string
    aiVendorRequestId: string
    aiRequestReceivedAt: number
    aiRequestFinishedAt: number
}

type ProviderUsageInput = {
    eventMeta: UsageEventMeta
    aiModelMetaInfo: MeteredAiModel
    aiVendorRequestId: string
    aiRequestReceivedAt: number
    aiRequestFinishedAt: number
}

export type TextProviderUsage = ProviderUsageIdentity & {
    prompt: {
        usageTokens: number
        cachedTokens: number
        audioTokens: number
    }
    completion: {
        usageTokens: number
        reasoningTokens: number
        audioTokens: number
    }
    total: {
        usageTokens: number
    }
}

export type ImageProviderUsage = ProviderUsageIdentity & {
    image: {
        size: string
        quality: string
        count: number
    }
}

export type VideoProviderUsage = ProviderUsageIdentity & {
    video: {
        measuringUnit: string
        durationSeconds: number
        resolution: string
        aspectRatio: string
        totalTokens?: number
        completionTokens?: number
        inputVideoSeconds?: number
    }
}

const usageIdentity = (input: ProviderUsageInput): ProviderUsageIdentity => ({
    eventMeta: input.eventMeta,
    aiModel: `${input.aiModelMetaInfo.provider}:${input.aiModelMetaInfo.model}`,
    modelVersion: input.aiModelMetaInfo.modelVersion ?? '',
    aiVendorRequestId: input.aiVendorRequestId,
    aiRequestReceivedAt: input.aiRequestReceivedAt,
    aiRequestFinishedAt: input.aiRequestFinishedAt,
})

export class UsageReporter {
    measureTextUsage(args: ProviderUsageInput & {
        aiVendorModelName: string
        usage: Partial<TokenUsageCounts>
    }): TextProviderUsage {
        const { usage } = args

        return {
            ...usageIdentity(args),
            prompt: {
                usageTokens: usage.promptTokens ?? 0,
                cachedTokens: usage.promptCachedTokens ?? 0,
                audioTokens: usage.promptAudioTokens ?? 0,
            },
            completion: {
                usageTokens: usage.completionTokens ?? 0,
                reasoningTokens: usage.completionReasoningTokens ?? 0,
                audioTokens: usage.completionAudioTokens ?? 0,
            },
            total: {
                usageTokens: usage.totalTokens ?? 0,
            },
        }
    }

    measureImageUsage(args: ProviderUsageInput & {
        imageSize: string
        imageQuality: string
        generatedCount: number
    }): ImageProviderUsage {
        return {
            ...usageIdentity(args),
            image: {
                size: args.imageSize,
                quality: args.imageQuality,
                count: args.generatedCount,
            },
        }
    }

    measureVideoUsage(args: ProviderUsageInput & {
        durationSeconds: number
        resolution: string
        aspectRatio: string
        totalTokens?: number
        completionTokens?: number
        inputVideoSeconds?: number
    }): VideoProviderUsage {
        // The catalog supplies the provider's usage unit; no tariff arithmetic runs here.
        const measuringUnit = pricingForCalledInferenceProvider(args.aiModelMetaInfo)?.video?.measuringUnit ?? 'seconds'

        return {
            ...usageIdentity(args),
            video: {
                measuringUnit,
                durationSeconds: Number(args.durationSeconds) || 0,
                resolution: args.resolution,
                aspectRatio: args.aspectRatio,
                ...(measuringUnit === 'tokens' ? {
                    totalTokens: args.totalTokens ?? args.completionTokens ?? 0,
                    completionTokens: args.completionTokens ?? 0,
                } : {}),
                ...(typeof args.inputVideoSeconds === 'number'
                    && args.inputVideoSeconds > 0
                    ? { inputVideoSeconds: Math.ceil(args.inputVideoSeconds) }
                    : {}),
            },
        }
    }
}
