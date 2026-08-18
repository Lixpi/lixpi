'use strict'

import type { ProviderAdapter, PricingCandidate, ProviderValidationResult } from './types.ts'
import { PROVIDER_ROUTES, type ProviderRoute } from '@lixpi/constants'

// Candidate discovery and provider evidence are deliberately separate. Until a
// reviewed, route-specific official parser is configured, LiteLLM can only
// produce a held candidate and can never supply evidence by itself.
class EvidenceRequiredAdapter implements ProviderAdapter {
    constructor(readonly route: ProviderRoute) {}

    async validate(_candidate: PricingCandidate): Promise<ProviderValidationResult> {
        return {
            status: 'held',
            reason: 'provider-evidence-unavailable',
            detail: `No reviewed official evidence adapter is configured for ${this.route}`,
        }
    }
}

export const createProviderAdapters = (): Map<ProviderRoute, ProviderAdapter> =>
    new Map(PROVIDER_ROUTES.map(route => [route, new EvidenceRequiredAdapter(route)]))
