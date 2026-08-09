'use strict'

import {
    createPricingKey,
    type PricingReference,
    type ProviderRoute,
} from './model-pricing-contracts.ts'
import type { ProviderName } from './types.ts'

export type ProviderRouteEnvironment = {
    ANTHROPIC_USE_AWS_BEDROCK_INFERENCE?: string
    STABILITY_USE_AWS_BEDROCK_INFERENCE?: string
    STABLE_DIFFUSION_USE_AWS_BEDROCK_INFERENCE?: string
    AWS_REGION?: string
}

export type CatalogModelRouteInput = {
    catalogProvider: ProviderName
    catalogModel: string
    vendorModel?: string
}

const enabled = (value: string | undefined): boolean => value?.trim().toLowerCase() === 'true'

const directRouteFor = (provider: ProviderName): ProviderRoute => {
    switch (provider) {
        case 'OpenAI': return 'openai-api'
        case 'Anthropic': return 'anthropic-api'
        case 'Google': return 'gemini-api'
        case 'Stability': return 'stability-api'
        case 'BytePlus': return 'byteplus-modelark'
    }
}

const usesBedrock = (provider: ProviderName, environment: ProviderRouteEnvironment): boolean =>
    (provider === 'Anthropic' && enabled(environment.ANTHROPIC_USE_AWS_BEDROCK_INFERENCE))
    || (provider === 'Stability' && (
        enabled(environment.STABILITY_USE_AWS_BEDROCK_INFERENCE)
        || enabled(environment.STABLE_DIFFUSION_USE_AWS_BEDROCK_INFERENCE)
    ))

export const resolveProviderRoute = (
    provider: ProviderName,
    environment: ProviderRouteEnvironment = {},
): ProviderRoute => usesBedrock(provider, environment) ? 'aws-bedrock' : directRouteFor(provider)

export const resolvePricingRegion = (
    providerRoute: ProviderRoute,
    environment: ProviderRouteEnvironment = {},
): string => providerRoute === 'aws-bedrock'
    ? (environment.AWS_REGION?.trim().toLowerCase() || 'global')
    : 'global'

export const resolveCatalogPricingReference = (
    { catalogProvider, catalogModel, vendorModel = catalogModel }: CatalogModelRouteInput,
    environment: ProviderRouteEnvironment = {},
): PricingReference => {
    const providerRoute = resolveProviderRoute(catalogProvider, environment)
    const pricingRegion = resolvePricingRegion(providerRoute, environment)

    return {
        pricingKey: createPricingKey({ catalogProvider, catalogModel, providerRoute, pricingRegion }),
        providerRoute,
        vendorModel,
        pricingRegion,
    }
}
