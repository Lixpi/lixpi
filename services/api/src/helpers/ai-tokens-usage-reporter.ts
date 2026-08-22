'use strict'

import type { TokensUsage, TokensUsageEvent } from '@lixpi/constants'

// Legacy callers retain this helper, but it now only normalizes measured usage.
// Provider cost and customer resale policy belong exclusively to billing.
export const reportAiTokensUsage = ({
    eventMeta,
    aiModelMetaInfo,
    aiVendorRequestId,
    usage,
    aiRequestReceivedAt,
    aiRequestFinishedAt,
}: TokensUsage): TokensUsageEvent => ({
    eventMeta,
    aiModel: `${aiModelMetaInfo.provider}:${aiModelMetaInfo.model}`,
    aiVendorRequestId,
    aiRequestReceivedAt,
    aiRequestFinishedAt,
    pricingLookup: {
        pricingKey: aiModelMetaInfo.pricingReference.pricingKey,
        pricingDimensions: {},
    },
    prompt: {
        usageTokens: usage.promptTokens,
        cachedTokens: usage.promptCachedTokens,
        audioTokens: usage.promptAudioTokens,
    },
    completion: {
        usageTokens: usage.completionTokens,
        reasoningTokens: usage.completionReasoningTokens,
        audioTokens: usage.completionAudioTokens,
    },
    total: { usageTokens: usage.totalTokens },
})
