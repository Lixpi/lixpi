'use strict'

import type { ProviderAdapter, PricingCandidate, ProviderValidationResult } from './types.ts'
import { PROVIDER_ROUTES, type ProviderRoute } from '@lixpi/constants'
import { AnthropicPricingAdapter } from './adapters/anthropic-adapter.ts'
import { GeminiPricingAdapter } from './adapters/gemini-adapter.ts'
import { OpenAiPricingAdapter } from './adapters/openai-adapter.ts'
import { AwsBedrockPricingAdapter } from './adapters/aws-bedrock-adapter.ts'
import { StabilityPricingAdapter } from './adapters/stability-adapter.ts'

// Candidate discovery and provider evidence are deliberately separate. Until a
// reviewed, route-specific official parser is configured, LiteLLM can only
// produce a held candidate and can never supply evidence by itself.
class EvidenceRequiredAdapter implements ProviderAdapter {
    constructor(readonly route: ProviderRoute, private readonly reason: string) {}

    async validate(_candidate: PricingCandidate): Promise<ProviderValidationResult> {
        return {
            status: 'held',
            reason: 'provider-evidence-unavailable',
            detail: this.reason,
        }
    }
}

// `vertex-ai` is a dead route today: `resolveProviderRoute` in
// provider-route-config.ts never produces it (only openai-api, anthropic-api,
// gemini-api, stability-api, aws-bedrock, and byteplus-modelark are ever
// assigned), so it stays stubbed rather than getting a real GCP Cloud
// Billing Catalog adapter no candidate can ever reach.
//
// `byteplus-modelark` has no machine-readable official source (matches the
// plan's own worked example), so it stays stubbed until phase 5's signed
// operator-override path exists.
export const createProviderAdapters = (): Map<ProviderRoute, ProviderAdapter> => {
    const adapters = new Map<ProviderRoute, ProviderAdapter>(PROVIDER_ROUTES.map(route => [
        route,
        new EvidenceRequiredAdapter(route, `No reviewed official evidence adapter is configured for ${route}`),
    ]))

    adapters.set('anthropic-api', new AnthropicPricingAdapter())
    adapters.set('gemini-api', new GeminiPricingAdapter())
    adapters.set('openai-api', new OpenAiPricingAdapter())
    adapters.set('aws-bedrock', new AwsBedrockPricingAdapter())
    adapters.set('stability-api', new StabilityPricingAdapter())
    adapters.set('vertex-ai', new EvidenceRequiredAdapter('vertex-ai', 'vertex-ai is unreachable from the current catalog route resolver; no adapter is warranted yet'))
    adapters.set('byteplus-modelark', new EvidenceRequiredAdapter('byteplus-modelark', 'BytePlus has no machine-readable official source; requires a signed operator override (phase 5)'))

    return adapters
}
