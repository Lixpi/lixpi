'use strict'

import type {
    ModelPriceRecord,
    PricingReference,
    PriceVariant,
    ProviderRoute,
} from '@lixpi/constants'

export type CatalogPricingModel = PricingReference & {
    provider: ModelPriceRecord['catalogProvider']
    model: string
}

export type LiteLlmEntry = Record<string, unknown>

export type ImmutableLiteLlmFeed = {
    commitSha: string
    contentSha256: string
    entries: Record<string, LiteLlmEntry>
}

export type CandidateHoldReason =
    | 'missing-upstream-entry'
    | 'provider-evidence-unavailable'
    | 'provider-source-invalid'
    | 'unsupported-route'

export type CandidateHold = {
    pricingKey: string
    candidateHash?: string
    reason: CandidateHoldReason
    detail: string
    createdAt: string
}

export type PricingCandidate = {
    record: Omit<ModelPriceRecord, 'snapshotId' | 'verification' | 'createdAt'>
    candidateHash: string
    upstreamKey: string
}

export type ProviderValidationResult =
    | { status: 'verified'; variants: PriceVariant[] }
    | { status: 'held'; reason: CandidateHoldReason; detail: string }

export type ProviderAdapter = {
    readonly route: ProviderRoute
    validate(candidate: PricingCandidate): Promise<ProviderValidationResult>
}
