import { Decimal } from 'decimal.js'

import {
    type TokensUsage,
    type TokensUsageEvent,
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
    const pricePer = new Decimal(aiModelMetaInfo.pricing.text.pricePer)

    const textPromptPrice = new Decimal(aiModelMetaInfo.pricing.text.tiers.default.prompt)
    const textCompletionPrice = new Decimal(aiModelMetaInfo.pricing.text.tiers.default.completion)

    const message: TokensUsageEvent = {
        eventMeta,
        aiModel: `${aiModelMetaInfo.provider}:${aiModelMetaInfo.model}`,
        aiVendorRequestId,
        aiRequestReceivedAt,
        aiRequestFinishedAt,
        textPricePer: pricePer.toString(),
        textPromptPrice: textPromptPrice.toString(),
        textCompletionPrice: textCompletionPrice.toString(),
        textPromptPriceResale: textPromptPrice.toString(),
        textCompletionPriceResale: textCompletionPrice.toString(),
        prompt: {
            usageTokens: promptTokens,
            cachedTokens: promptCachedTokens,
            audioTokens: promptAudioTokens,
            purchasedFor: textPromptPrice.div(pricePer).mul(promptTokens).toString(),
            soldToClientFor: textPromptPrice.div(pricePer).mul(promptTokens).toString(),
        },
        completion: {
            usageTokens: completionTokens,
            purchasedFor: textCompletionPrice.div(pricePer).mul(completionTokens).toString(),
            reasoningTokens: completionReasoningTokens,
            audioTokens: completionAudioTokens,
            soldToClientFor: textCompletionPrice.div(pricePer).mul(completionTokens).toString(),
        },
        get total() {
            return {
                usageTokens: totalTokens,
                purchasedFor: new Decimal(this.prompt.purchasedFor).add(
                    new Decimal(this.completion.purchasedFor),
                ).toString(),
                soldToClientFor: new Decimal(this.prompt.soldToClientFor).add(
                    new Decimal(this.completion.soldToClientFor),
                ).toString(),
            }
        },
    }
}
