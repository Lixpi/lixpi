'use strict'

import { canonicalHash } from './canonical-json.ts'
import type { CatalogPricingModel, ImmutableLiteLlmFeed, PricingCandidate } from './types.ts'

const routePrefixes: Record<PricingCandidate['record']['providerRoute'], readonly string[]> = {
    'openai-api': ['openai/'],
    'anthropic-api': ['anthropic/'],
    'gemini-api': ['gemini/'],
    'vertex-ai': ['vertex_ai/'],
    'stability-api': ['stability/'],
    'aws-bedrock': ['bedrock/'],
    'byteplus-modelark': ['byteplus/'],
}

const candidateKeys = (catalogModel: CatalogPricingModel): string[] => {
    const prefixes = routePrefixes[catalogModel.providerRoute] ?? []
    return [
        catalogModel.vendorModel,
        ...prefixes.map(prefix => `${prefix}${catalogModel.vendorModel}`),
    ]
}

export const resolveLiteLlmCandidate = (
    catalogModel: CatalogPricingModel,
    feed: ImmutableLiteLlmFeed,
    observedAt: string,
): PricingCandidate | undefined => {
    const upstreamKey = candidateKeys(catalogModel).find(key => feed.entries[key])
    if (!upstreamKey) return undefined

    const record = {
        pricingKey: catalogModel.pricingKey,
        catalogProvider: catalogModel.provider,
        catalogModel: catalogModel.model,
        vendorModel: catalogModel.vendorModel,
        providerRoute: catalogModel.providerRoute,
        pricingRegion: catalogModel.pricingRegion,
        currency: 'USD' as const,
        variants: [],
        upstream: {
            key: upstreamKey,
            commitSha: feed.commitSha,
            contentSha256: feed.contentSha256,
        },
        effectiveFrom: observedAt,
    }

    return { record, upstreamKey, candidateHash: canonicalHash({ record, upstream: feed.entries[upstreamKey] }) }
}
