'use strict'

import { Decimal } from 'decimal.js'

import { warn } from '@lixpi/debug-tools'

import type { AiModelMetaInfo, EventMeta, Usage } from '../graph/state.ts'

// Match Python `Decimal` behavior (default 28-digit precision, ROUND_HALF_EVEN).
// decimal.js defaults to 20-digit precision; bumping it here so pricing
// arithmetic stays byte-identical to the Python implementation.
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN })

export type UsageReport = {
    eventMeta: EventMeta
    aiModel: string
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
}

export type ImageUsageReport = {
    eventMeta: EventMeta
    aiModel: string
    aiVendorRequestId: string
    aiRequestReceivedAt: number
    aiRequestFinishedAt: number
    image: {
        size: string
        quality: string
        count: number
        pricePerImage: string
        pricePerImageResale: string
        purchasedFor: string
        soldToClientFor: string
    }
}

const dec = (v: unknown, fallback: string = '0'): Decimal =>
    new Decimal(v == null ? fallback : String(v))

export class UsageReporter {
    // Currently logs only. Swap the return value for natsService.publish('usage.tokens.ai', report) when ready.
    reportTokensUsage(args: {
        eventMeta: EventMeta
        aiModelMetaInfo: AiModelMetaInfo
        aiVendorRequestId: string
        aiVendorModelName: string
        usage: Partial<Usage>
        aiRequestReceivedAt: number
        aiRequestFinishedAt: number
    }): UsageReport | undefined {
        try {
            const { aiModelMetaInfo, usage, eventMeta, aiVendorRequestId, aiRequestReceivedAt, aiRequestFinishedAt } = args
            const pricing = aiModelMetaInfo.pricing ?? {}
            const resaleMargin = dec(pricing.resaleMargin, '1.0')
            const pricePer = dec(pricing.text?.pricePer, '1000000')
            const tiers = pricing.text?.tiers?.default ?? {}
            const promptPrice = dec(tiers.prompt, '0')
            const completionPrice = dec(tiers.completion, '0')

            const promptResale = promptPrice.mul(resaleMargin)
            const completionResale = completionPrice.mul(resaleMargin)

            const promptTokens = usage.promptTokens ?? 0
            const completionTokens = usage.completionTokens ?? 0
            const totalTokens = usage.totalTokens ?? 0

            const promptPurchased = promptPrice.div(pricePer).mul(dec(promptTokens))
            const promptSold = promptResale.div(pricePer).mul(dec(promptTokens))
            const completionPurchased = completionPrice.div(pricePer).mul(dec(completionTokens))
            const completionSold = completionResale.div(pricePer).mul(dec(completionTokens))
            const totalPurchased = promptPurchased.plus(completionPurchased)
            const totalSold = promptSold.plus(completionSold)

            const report: UsageReport = {
                eventMeta,
                aiModel: `${aiModelMetaInfo.provider}:${aiModelMetaInfo.model}`,
                aiVendorRequestId,
                aiRequestReceivedAt,
                aiRequestFinishedAt,
                textPricePer: pricePer.toString(),
                textPromptPrice: promptPrice.toString(),
                textCompletionPrice: completionPrice.toString(),
                textPromptPriceResale: promptResale.toString(),
                textCompletionPriceResale: completionResale.toString(),
                prompt: {
                    usageTokens: promptTokens,
                    cachedTokens: usage.promptCachedTokens ?? 0,
                    audioTokens: usage.promptAudioTokens ?? 0,
                    purchasedFor: promptPurchased.toString(),
                    soldToClientFor: promptSold.toString(),
                },
                completion: {
                    usageTokens: completionTokens,
                    reasoningTokens: usage.completionReasoningTokens ?? 0,
                    audioTokens: usage.completionAudioTokens ?? 0,
                    purchasedFor: completionPurchased.toString(),
                    soldToClientFor: completionSold.toString(),
                },
                total: {
                    usageTokens: totalTokens,
                    purchasedFor: totalPurchased.toString(),
                    soldToClientFor: totalSold.toString(),
                },
            }

            // TODO: publish to NATS once usage.tokens.ai subject is wired up.
            return report
        } catch (e) {
            warn(`Failed to report token usage: ${e}`)
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
            const pricing = aiModelMetaInfo.pricing ?? {}
            const resaleMargin = dec(pricing.resaleMargin, '1.0')

            const imagePricing = pricing.image ?? {}
            const sizePricing = imagePricing[imageSize] ?? imagePricing.default ?? {}
            const qualityKey = (imageQuality in sizePricing) ? imageQuality : 'high'
            const pricePerImage = dec(sizePricing[qualityKey], '0.04')
            const pricePerImageResale = pricePerImage.mul(resaleMargin)

            const report: ImageUsageReport = {
                eventMeta,
                aiModel: `${aiModelMetaInfo.provider}:${aiModelMetaInfo.model}`,
                aiVendorRequestId,
                aiRequestReceivedAt,
                aiRequestFinishedAt,
                image: {
                    size: imageSize,
                    quality: imageQuality,
                    count: 1,
                    pricePerImage: pricePerImage.toString(),
                    pricePerImageResale: pricePerImageResale.toString(),
                    purchasedFor: pricePerImage.toString(),
                    soldToClientFor: pricePerImageResale.toString(),
                },
            }

            // TODO: publish to NATS once usage.images.ai subject is wired up.
            return report
        } catch (e) {
            warn(`Failed to report image usage: ${e}`)
            return undefined
        }
    }
}
