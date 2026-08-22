'use strict'

import type { PricingLookup } from '@lixpi/constants'

import type { AiModelMetaInfo, EventMeta, Usage } from '../graph/state.ts'

export type UsageReport = {
    eventMeta: EventMeta
    pricingLookup: PricingLookup
    aiVendorRequestId: string
    aiRequestReceivedAt: number
    aiRequestFinishedAt: number
    prompt: { usageTokens: number; cachedTokens: number; audioTokens: number }
    completion: { usageTokens: number; reasoningTokens: number; audioTokens: number }
    total: { usageTokens: number }
}

export type ImageUsageReport = {
    eventMeta: EventMeta
    pricingLookup: PricingLookup
    aiVendorRequestId: string
    aiRequestReceivedAt: number
    aiRequestFinishedAt: number
    image: { size: string; quality: string; count: number }
}

export type VideoUsageReport = {
    eventMeta: EventMeta
    pricingLookup: PricingLookup
    aiVendorRequestId: string
    aiRequestReceivedAt: number
    aiRequestFinishedAt: number
    video: {
        measuringUnit: 'tokens' | 'seconds'
        durationSeconds: number
        resolution: string
        aspectRatio: string
        totalTokens?: number
        completionTokens?: number
        inputVideoSeconds?: number
    }
}

const pricingLookupFor = (model: AiModelMetaInfo, pricingDimensions: PricingLookup['pricingDimensions']): PricingLookup => {
    const pricingKey = model.pricingReference?.pricingKey
    if (!pricingKey) throw new Error(`Missing pricingReference for ${model.provider}:${model.model}`)
    return { pricingKey, pricingDimensions }
}

export class UsageReporter {
    reportTokensUsage(args: {
        eventMeta: EventMeta
        aiModelMetaInfo: AiModelMetaInfo
        aiVendorRequestId: string
        usage: Partial<Usage>
        aiRequestReceivedAt: number
        aiRequestFinishedAt: number
    }): UsageReport | undefined {
        try {
            const { aiModelMetaInfo, usage, eventMeta, aiVendorRequestId, aiRequestReceivedAt, aiRequestFinishedAt } = args
            const promptTokens = usage.promptTokens ?? 0
            const completionTokens = usage.completionTokens ?? 0
            return {
                eventMeta,
                pricingLookup: pricingLookupFor(aiModelMetaInfo, {}),
                aiVendorRequestId,
                aiRequestReceivedAt,
                aiRequestFinishedAt,
                prompt: { usageTokens: promptTokens, cachedTokens: usage.promptCachedTokens ?? 0, audioTokens: usage.promptAudioTokens ?? 0 },
                completion: { usageTokens: completionTokens, reasoningTokens: usage.completionReasoningTokens ?? 0, audioTokens: usage.completionAudioTokens ?? 0 },
                total: { usageTokens: usage.totalTokens ?? promptTokens + completionTokens },
            }
        } catch (error) {
            console.error(`Failed to normalize token usage: ${error}`)
            return undefined
        }
    }

    reportImageUsage(args: {
        eventMeta: EventMeta
        aiModelMetaInfo: AiModelMetaInfo
        aiVendorRequestId: string
        imageSize: string
        imageQuality: string
        aiRequestReceivedAt: number
        aiRequestFinishedAt: number
    }): ImageUsageReport | undefined {
        try {
            const { eventMeta, aiModelMetaInfo, aiVendorRequestId, imageSize, imageQuality, aiRequestReceivedAt, aiRequestFinishedAt } = args
            return {
                eventMeta,
                pricingLookup: pricingLookupFor(aiModelMetaInfo, { imageSize, imageQuality }),
                aiVendorRequestId,
                aiRequestReceivedAt,
                aiRequestFinishedAt,
                image: { size: imageSize, quality: imageQuality, count: 1 },
            }
        } catch (error) {
            console.error(`Failed to normalize image usage: ${error}`)
            return undefined
        }
    }

    reportVideoUsage(args: {
        eventMeta: EventMeta
        aiModelMetaInfo: AiModelMetaInfo
        aiVendorRequestId: string
        durationSeconds: number
        resolution: string
        aspectRatio: string
        totalTokens?: number
        completionTokens?: number
        inputVideoSeconds?: number
        aiRequestReceivedAt: number
        aiRequestFinishedAt: number
    }): VideoUsageReport | undefined {
        try {
            const { eventMeta, aiModelMetaInfo, aiVendorRequestId, durationSeconds, resolution, aspectRatio, totalTokens, completionTokens, inputVideoSeconds, aiRequestReceivedAt, aiRequestFinishedAt } = args
            const measuringUnit = aiModelMetaInfo.pricingReference?.providerRoute === 'byteplus-modelark' ? 'tokens' : 'seconds'
            return {
                eventMeta,
                pricingLookup: pricingLookupFor(aiModelMetaInfo, { resolution }),
                aiVendorRequestId,
                aiRequestReceivedAt,
                aiRequestFinishedAt,
                video: {
                    measuringUnit,
                    durationSeconds: Number(durationSeconds) || 0,
                    resolution,
                    aspectRatio,
                    ...(measuringUnit === 'tokens' ? { totalTokens: Number(totalTokens) || 0, completionTokens: Number(completionTokens) || 0 } : {}),
                    ...(typeof inputVideoSeconds === 'number' && inputVideoSeconds > 0 ? { inputVideoSeconds: Math.ceil(inputVideoSeconds) } : {}),
                },
            }
        } catch (error) {
            console.error(`Failed to normalize video usage: ${error}`)
            return undefined
        }
    }
}
