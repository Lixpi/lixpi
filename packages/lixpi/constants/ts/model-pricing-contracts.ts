'use strict'

import type { ProviderName } from './types.ts'

export const PROVIDER_ROUTES = [
    'openai-api',
    'anthropic-api',
    'gemini-api',
    'vertex-ai',
    'stability-api',
    'aws-bedrock',
    'byteplus-modelark',
] as const

export type ProviderRoute = typeof PROVIDER_ROUTES[number]

export const PRICING_DIMENSIONS = [
    'serviceTier',
    'contextBand',
    'resolution',
    'imageSize',
    'imageQuality',
] as const

export type PricingDimension = typeof PRICING_DIMENSIONS[number]
export type PricingDimensions = Partial<Record<PricingDimension, string>>

export type PricingReference = {
    pricingKey: string
    providerRoute: ProviderRoute
    vendorModel: string
    pricingRegion: string
}

export type PricingLookup = {
    pricingKey: string
    pricingDimensions: PricingDimensions
}

export type PricingKeyInput = {
    catalogProvider: ProviderName
    catalogModel: string
    providerRoute: ProviderRoute
    pricingRegion: string
}

export type PriceComponentKind =
    | 'input'
    | 'output'
    | 'cacheRead'
    | 'cacheWrite'
    | 'reasoningOutput'
    | 'imageOutput'
    | 'videoOutput'
    | 'audioInput'
    | 'audioOutput'

export type PriceEvidence = {
    mechanism:
        | 'provider-doc'
        | 'provider-openapi'
        | 'aws-price-list'
        | 'gcp-billing-catalog'
        | 'provider-usage-api'
        | 'provider-cost-api'
        | 'operator-approval'
    sourceId: string
    sourceHash?: string
    sourceLocators: string[]
    parserVersion?: string
    observedAt: string
}

export type PriceDerivationInput = {
    inputId: string
    value: string
    unit: string
    evidence: PriceEvidence[]
}

export type PriceDerivationExpression =
    | { operation: 'input'; inputId: string }
    | { operation: 'add' | 'multiply'; operands: PriceDerivationExpression[] }

export type PriceRate = {
    measuringUnit: 'tokens' | 'images' | 'seconds' | 'credits'
    pricePer: string
    amount: string
    derivation: {
        inputs: PriceDerivationInput[]
        expression: PriceDerivationExpression
    }
}

export type PriceVariant = {
    variantId: string
    selectors: PricingDimensions
    components: Partial<Record<PriceComponentKind, PriceRate>>
}

export type ModelPriceRecord = {
    snapshotId: string
    pricingKey: string
    catalogProvider: ProviderName
    catalogModel: string
    vendorModel: string
    providerRoute: ProviderRoute
    pricingRegion: string
    currency: 'USD'
    variants: PriceVariant[]
    verification: {
        status: 'verified' | 'override-approved'
        candidateHash: string
        verifiedAt: string
    }
    upstream?: {
        key: string
        commitSha: string
        contentSha256: string
    }
    effectiveFrom: string
    createdAt: string
}

export type PricingSnapshotManifest = {
    recordKey: 'SNAPSHOT'
    sortKey: string
    snapshotId: string
    sourceRevision: string
    normalizedContentHash: string
    recordCount: number
    status: 'complete'
    createdAt: string
}

export type ActivePricingPointer = {
    recordKey: 'ACTIVE'
    sortKey: 'POINTER'
    snapshotId: string
    normalizedContentHash: string
    activatedAt: string
}

export type PricingActivationEvent = {
    recordKey: 'ACTIVATION'
    sortKey: string
    snapshotId: string
    previousSnapshotId?: string
    normalizedContentHash: string
    activatedAt: string
}

export type PricingTableResponse = {
    manifest: PricingSnapshotManifest
    records: ModelPriceRecord[]
}

export type PricingOverrideCommand = {
    commandId: string
    action: 'propose' | 'approve' | 'reject'
    pricingKey: string
    expectedActiveSnapshotId: string
    candidateHash: string
    patch?: Partial<Pick<ModelPriceRecord, 'variants' | 'effectiveFrom'>>
    reason: string
    changeReference: string
    issuedAt: string
    expiresAt: string
    nonce: string
    actorKeyId: string
    signature: string
}

export type DailyPredictedProviderCost = {
    providerRoute: ProviderRoute
    providerAccountRef: string
    day: string
    pricingKey?: string
    snapshotId: string
    predictedProviderCostUsd: string
    usage: Record<string, string>
}

const normalizeRequiredComponent = (component: string, label: string): string => {
    const normalized = component.trim()

    if (!normalized) {
        throw new Error(`Pricing key ${label} must not be empty`)
    }

    return normalized
}

const encodePricingKeyComponent = (component: string): string => encodeURIComponent(component)
    .replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)

// Pricing keys are opaque cross-repository identifiers. Consumers must retain
// this result verbatim and must never split it to reconstruct route identity.
export const createPricingKey = ({
    catalogProvider,
    catalogModel,
    providerRoute,
    pricingRegion,
}: PricingKeyInput): string => {
    const components = [
        normalizeRequiredComponent(catalogProvider, 'catalog provider'),
        normalizeRequiredComponent(catalogModel, 'catalog model'),
        normalizeRequiredComponent(providerRoute, 'provider route').toLowerCase(),
        normalizeRequiredComponent(pricingRegion, 'pricing region').toLowerCase(),
    ]

    return components.map(encodePricingKeyComponent).join(':')
}
