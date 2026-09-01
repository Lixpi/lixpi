'use strict'

import { Decimal } from 'decimal.js'
import {
    log,
    info,
    infoStr,
    warn,
    err,
} from '@lixpi/debug-tools'

import type {
    TokensUsage,
    TokensUsageEvent,
} from '@lixpi/constants'

export const reportAiTokensUsage = ({
    eventMeta,
    aiModelMetaInfo,

    aiVendorRequestId,
    aiVendorModelName,
    usage: {
        promptTokens,
        promptAudioTokens,
        promptCachedTokens,

        completionTokens,
        completionAudioTokens,
        completionReasoningTokens,

        totalTokens,
    },
    aiRequestReceivedAt,
    aiRequestFinishedAt,
}: TokensUsage) => {
    const resaleMargin = new Decimal(aiModelMetaInfo.pricing.resaleMargin)
    const pricePer = new Decimal(aiModelMetaInfo.pricing.text.pricePer)

    const textPromptPrice = new Decimal(aiModelMetaInfo.pricing.text.tiers.default.prompt)
    const textCompletionPrice = new Decimal(aiModelMetaInfo.pricing.text.tiers.default.completion)

    const textPromptPriceResale = textPromptPrice.mul(resaleMargin)
    const textCompletionPriceResale = textCompletionPrice.mul(resaleMargin)

    const message: TokensUsageEvent = {
        eventMeta,

        aiModel: `${aiModelMetaInfo.provider}:${aiModelMetaInfo.model}`,
        aiVendorRequestId,
        aiRequestReceivedAt,
        aiRequestFinishedAt,

        textPricePer: pricePer.toString(),
        textPromptPrice: textPromptPrice.toString(),
        textCompletionPrice: textCompletionPrice.toString(),
        textPromptPriceResale: textPromptPriceResale.toString(),
        textCompletionPriceResale: textCompletionPriceResale.toString(),

        prompt: {
            usageTokens: promptTokens,
            cachedTokens: promptCachedTokens,
            audioTokens: promptAudioTokens,
            purchasedFor: textPromptPrice.div(pricePer).mul(promptTokens).toString(),
            soldToClientFor: textPromptPriceResale.div(pricePer).mul(promptTokens).toString(),
        },
        completion: {
            usageTokens: completionTokens,
            purchasedFor: textCompletionPrice.div(pricePer).mul(completionTokens).toString(),
            reasoningTokens: completionReasoningTokens,
            audioTokens: completionAudioTokens,
            soldToClientFor: textCompletionPriceResale.div(pricePer).mul(completionTokens).toString(),
        },
        get total() {
            return {
                usageTokens: totalTokens,
                purchasedFor: new Decimal(this.prompt.purchasedFor).add(new Decimal(this.completion.purchasedFor)).toString(),
                soldToClientFor: new Decimal(this.prompt.soldToClientFor).add(new Decimal(this.completion.soldToClientFor)).toString(),
            }
        },
    }
}
