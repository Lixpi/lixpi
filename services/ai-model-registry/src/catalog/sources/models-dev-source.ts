import {
    info,
    warn,
} from '@lixpi/debug-tools'

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

// models.dev is the one external catalog whose sync process makes its own
// uncertainty visible: per-provider modules declare the fields they are
// authoritative for, a provider that cannot be trusted to auto-create entries sets
// skipCreates and files an issue instead of guessing, and the hourly workflow
// validates every change. It is fetched live rather than pinned, because catching a
// reprice is the reason it is here at all.
//
// It carries no BytePlus, ModelArk, or fal provider, and reaches Seedance only
// through resellers whose prices are their own markup. Those routes get nothing
// from here, by design.

const CATALOG_URL = 'https://models.dev/api.json'

const PROVIDER_KEYS: Record<ProviderDirectory, string | null> = {
    openai: 'openai',
    anthropic: 'anthropic',
    google: 'google',
    stability: null,
    byteplus: null,
}

// models.dev files the Bedrock route under one provider for every vendor, keyed by
// the vendor's own Bedrock model id.
const BEDROCK_PROVIDER_KEY = 'amazon-bedrock'

type ModelsDevModel = {
    id: string
    name?: string
    limit?: {
        context?: number
        input?: number
        output?: number
    }
    modalities?: {
        input?: string[]
        output?: string[]
    }
    cost?: {
        input?: number
        output?: number
    } | null
}

type ModelsDevProvider = {
    id: string
    name?: string
    models?: Record<string, ModelsDevModel>
}

export class ModelsDevSource implements ModelSource {
    readonly id: SourceId = 'models.dev'

    private catalog: Record<string, ModelsDevProvider> = {}
    private bedrockIndex = new Map<string, {
        key: string
        entry: ModelsDevModel
    }>()

    async load(): Promise<void> {
        const response = await fetch(CATALOG_URL)

        if (!response.ok)
            throw new Error(`MODELS_DEV_FETCH_FAILED:${response.status}`)

        this.catalog = (await response.json()) as Record<string, ModelsDevProvider>
        this.bedrockIndex = indexBedrockKeys(
            Object.entries(this.catalog[BEDROCK_PROVIDER_KEY]?.models ?? {}),
            () => true,
        )
        info(`models.dev catalog loaded: ${Object.keys(this.catalog).length} providers, ${this.bedrockIndex.size} Bedrock routes`)
    }

    private providerCatalog(provider: ProviderDirectory): ModelsDevProvider | null {
        const key = PROVIDER_KEYS[provider]

        if (!key)
            return null

        return this.catalog[key] ?? null
    }

    // Prices are published per 1M tokens. Lixpi states the same unit explicitly in
    // `pricePer`, so the conversion is a format change, not arithmetic.
    //
    // models.dev carries one `cost` per model and does not say which cost family it
    // belongs to. The output modalities are the only signal available, so the rate
    // is claimed for a bucket only when they are unambiguous. A model that emits
    // both text and images (every Gemini image model) is ambiguous: its published
    // output cost is the image-token rate, and reading it as a text price is a 20x
    // error. Those models get nothing from here, and LiteLLM, which names the two
    // families separately, supplies both.
    private buildPricing(entry: ModelsDevModel): LixpiModelRecord['pricing'] | null {
        const cost = entry.cost

        if (
            !cost
            || typeof cost.input !== 'number'
            || typeof cost.output !== 'number'
        )
            return null

        const outputs = entry.modalities?.output ?? []
        const emitsText = outputs.includes('text')
        const emitsImage = outputs.includes('image')

        if (
            emitsText
            && emitsImage
        )
            return null

        const rates = {
            measuringUnit: 'tokens',
            pricePer: '1000000',
            prompt: cost.input.toFixed(2),
            completion: cost.output.toFixed(2),
        }

        if (emitsImage) {
            return {
                currency: 'USD',
                image: rates,
            } as LixpiModelRecord['pricing']
        }

        if (!emitsText)
            return null

        return {
            currency: 'USD',
            text: {
                measuringUnit: 'tokens',
                pricePer: '1000000',
                tiers: {
                    default: {
                        prompt: rates.prompt,
                        completion: rates.completion,
                    },
                },
            },
        }
    }

    private toFacts(
        key: string,
        entry: ModelsDevModel,
    ): SourceProviderFacts {
        const fields: Partial<LixpiModelRecord> = {}

        if (entry.limit?.context)
            fields.contextWindow = entry.limit.context

        if (entry.limit?.output)
            fields.maxCompletionSize = entry.limit.output

        const pricing = this.buildPricing(entry)

        if (pricing)
            fields.pricing = pricing

        return {
            sourceKey: key,
            fields,
        }
    }

    // Bedrock keys are matched through the shared index rather than rebuilt by
    // string concatenation. models.dev publishes the plain key and the regional
    // profiles side by side, and the plain one is the base on-demand rate.
    private resolveBedrock(candidates: string[]): {
        key: string
        entry: ModelsDevModel
    } | null {
        for (const candidate of candidates) {
            const found = this.bedrockIndex.get(candidate)

            if (found)
                return found
        }

        return null
    }

    lookup(
        provider: ProviderDirectory,
        modelId: string,
        familyVersions: string[] = [modelId],
    ): SourceModelFacts | null {
        const direct = this.providerCatalog(provider)?.models?.[modelId]
        const bedrock = this.resolveBedrock(familyVersions)

        if (
            !direct
            && !bedrock
        )
            return null

        return {
            byInferenceProvider: {
                ...(direct && { [provider]: this.toFacts(modelId, direct) }),
                ...(bedrock && { 'aws-bedrock': this.toFacts(bedrock.key, bedrock.entry) }),
            },
        }
    }

    listAvailable(provider: ProviderDirectory): string[] | null {
        const catalog = this.providerCatalog(provider)

        if (!catalog) {
            warn(`models.dev has no provider for ${provider}`)

            return null
        }

        return Object.keys(catalog.models ?? {}).sort()
    }
}
