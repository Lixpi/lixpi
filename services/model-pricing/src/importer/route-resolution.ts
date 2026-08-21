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

// Rung 3 of the route ladder: a reviewed, code-configured hint for a real
// vendor model whose LiteLLM key doesn't structurally match its exact id or
// its route-prefixed id (rungs 1-2). This is developer-reviewed code, not a
// signed runtime command, so it carries the same trust level as
// `routePrefixes` above - it is not rung 4's signed override candidate,
// which still requires phase 5's signed-command infrastructure. Empty until
// a specific naming mismatch is found and reviewed; never guessed.
const operatorKeyHints: Readonly<Record<string, string>> = {}

const candidateKeys = (catalogModel: CatalogPricingModel): string[] => {
    const prefixes = routePrefixes[catalogModel.providerRoute] ?? []
    const hint = operatorKeyHints[catalogModel.vendorModel]
    return [
        catalogModel.vendorModel,
        ...prefixes.map(prefix => `${prefix}${catalogModel.vendorModel}`),
        ...(hint ? [hint] : []),
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
