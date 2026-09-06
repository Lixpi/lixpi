import { info } from '@lixpi/debug-tools'

import {
    type LixpiModelRecord,
    type ProviderDirectory,
    type SourceId,
} from '../types.ts'
import { indexBedrockKeys } from './bedrock-key.ts'
import {
    type ModelSource,
    type SourceModelFacts,
    type SourceProviderFacts,
} from './model-source.ts'

// LiteLLM's model_prices_and_context_window.json. Most of it is hand-maintained by a
// maintainer and a fleet of agents rather than synced, and its validation is a JSON
// well-formedness check, so it is not trusted on its own. What it is good at is
// precision: it names each cost family separately, so an image model's image-token
// rate and its text-token rate are different fields instead of one `cost` object.
// That is the distinction models.dev cannot express, and it is why this source is
// consulted first for pricing.
//
// Costs are per token or per unit, not per million, so every rate is scaled here.

const CATALOG_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

const PER_MILLION = 1000000

// LiteLLM keys a model by the route it is called through, and the rates differ
// between them. Reseller routes are deliberately absent: their prices are the
// reseller's markup, not the rate Lixpi pays.
const DIRECT_KEY_PREFIXES: Record<ProviderDirectory, string[]> = {
    openai: [''],
    anthropic: [''],
    google: [
        '',
        'gemini/',
        'vertex_ai/',
    ],
    stability: [
        'stability/',
        '',
    ],
    byteplus: [''],
}

type LiteLlmModel = {
    litellm_provider?: string
    mode?: string
    max_input_tokens?: number
    max_output_tokens?: number
    input_cost_per_token?: number
    output_cost_per_token?: number
    input_cost_per_image_token?: number
    output_cost_per_image_token?: number
    input_cost_per_image?: number
    output_cost_per_image?: number
    output_cost_per_second?: number
}

const toRate = (
    cost: number,
    scale: number,
): string => (cost * scale).toFixed(2)

export class LiteLlmSource implements ModelSource {
    readonly id: SourceId = 'litellm'

    private catalog: Record<string, LiteLlmModel> = {}
    private bedrockIndex = new Map<string, {
        key: string
        entry: LiteLlmModel
    }>()

    async load(): Promise<void> {
        const response = await fetch(CATALOG_URL)

        if (!response.ok)
            throw new Error(`LITELLM_FETCH_FAILED:${response.status}`)

        this.catalog = (await response.json()) as Record<string, LiteLlmModel>
        this.bedrockIndex = indexBedrockKeys(
            Object.entries(this.catalog),
            entry => Boolean(entry.litellm_provider?.startsWith('bedrock')),
        )
        info(`LiteLLM catalog loaded: ${Object.keys(this.catalog).length} entries, ${this.bedrockIndex.size} of them Bedrock routes`)
    }

    private resolveDirect(
        provider: ProviderDirectory,
        modelId: string,
    ): {
        key: string
        entry: LiteLlmModel
    } | null {
        for (const prefix of DIRECT_KEY_PREFIXES[provider]) {
            const key = `${prefix}${modelId}`
            const entry = this.catalog[key]

            // A Bedrock entry reached through a direct-looking key is not the direct
            // route. `anthropic.claude-...` is Bedrock's own naming.
            if (
                entry
                && !entry.litellm_provider?.startsWith('bedrock')
            )
                return {
                    key,
                    entry,
                }
        }

        return null
    }

    // Bedrock keys are matched through the shared index rather than rebuilt by
    // string concatenation, because a source spells the same route several ways:
    // `anthropic.claude-...-v1:0`, `bedrock/us-gov-east-1/anthropic.claude-...`, and
    // `us.anthropic.claude-...` are all the same model.
    private resolveBedrock(candidates: string[]): {
        key: string
        entry: LiteLlmModel
    } | null {
        for (const candidate of candidates) {
            const found = this.bedrockIndex.get(candidate)

            if (found)
                return found
        }

        return null
    }

    private buildPricing(entry: LiteLlmModel): LixpiModelRecord['pricing'] | null {
        const pricing: Record<string, unknown> = {}

        if (
            typeof entry.input_cost_per_token === 'number'
            && typeof entry.output_cost_per_token === 'number'
        ) {
            pricing.text = {
                measuringUnit: 'tokens',
                pricePer: `${PER_MILLION}`,
                tiers: {
                    default: {
                        prompt: toRate(entry.input_cost_per_token, PER_MILLION),
                        completion: toRate(entry.output_cost_per_token, PER_MILLION),
                    },
                },
            }
        }

        if (
            typeof entry.input_cost_per_image_token === 'number'
            && typeof entry.output_cost_per_image_token === 'number'
        ) {
            pricing.image = {
                measuringUnit: 'tokens',
                pricePer: `${PER_MILLION}`,
                prompt: toRate(entry.input_cost_per_image_token, PER_MILLION),
                completion: toRate(entry.output_cost_per_image_token, PER_MILLION),
            }
        } else if (typeof entry.output_cost_per_image === 'number') {
            // Priced per generated image rather than per image token. The unit is
            // stated so the merge can refuse to drop this into a field that means
            // credits or tokens.
            pricing.image = {
                measuringUnit: 'images',
                pricePer: '1',
                prompt: toRate(entry.input_cost_per_image ?? 0, 1),
                completion: toRate(entry.output_cost_per_image, 1),
            }
        }

        if (typeof entry.output_cost_per_second === 'number') {
            pricing.video = {
                measuringUnit: 'seconds',
                pricePer: '1',
                price: toRate(entry.output_cost_per_second, 1),
            }
        }

        if (Object.keys(pricing).length === 0)
            return null

        return {
            currency: 'USD',
            ...pricing,
        } as LixpiModelRecord['pricing']
    }

    private toFacts(resolved: {
        key: string
        entry: LiteLlmModel
    }): SourceProviderFacts {
        const fields: Partial<LixpiModelRecord> = {}

        if (resolved.entry.max_input_tokens)
            fields.contextWindow = resolved.entry.max_input_tokens

        if (resolved.entry.max_output_tokens)
            fields.maxCompletionSize = resolved.entry.max_output_tokens

        const pricing = this.buildPricing(resolved.entry)

        if (pricing)
            fields.pricing = pricing

        return {
            sourceKey: resolved.key,
            fields,
        }
    }

    lookup(
        provider: ProviderDirectory,
        modelId: string,
        familyVersions: string[] = [modelId],
    ): SourceModelFacts | null {
        const direct = this.resolveDirect(provider, modelId)
        const bedrock = this.resolveBedrock(familyVersions)

        if (
            !direct
            && !bedrock
        )
            return null

        return {
            byInferenceProvider: {
                ...(direct && { [provider]: this.toFacts(direct) }),
                ...(bedrock && { 'aws-bedrock': this.toFacts(bedrock) }),
            },
        }
    }

    listAvailable(): string[] | null {
        return Object.keys(this.catalog).sort()
    }
}
