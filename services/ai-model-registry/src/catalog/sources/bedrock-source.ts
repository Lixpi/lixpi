import {
    BedrockClient,
    ListFoundationModelsCommand,
    ListInferenceProfilesCommand,
    type FoundationModelSummary,
    type InferenceProfileSummary,
} from '@aws-sdk/client-bedrock'
import { fromSSO } from '@aws-sdk/credential-providers'
import process from 'node:process'

import {
    info,
    warn,
} from '@lixpi/debug-tools'

import {
    BedrockPricing,
    type BedrockModelRates,
    type BedrockRateTier,
} from './bedrock-pricing.ts'
import {
    CredentialsExpiredError,
    isCredentialsProblem,
} from './credentials-error.ts'
import {
    type LixpiModelRecord,
    type ProviderDirectory,
    type SourceId,
} from '../types.ts'
import {
    type ModelSource,
    type SourceModelFacts,
} from './model-source.ts'

const PER_MILLION = 1000000

// The AWS Bedrock foundation-model catalog. It is a separate source from the
// vendor's own API rather than a substitute for it: when inference is routed through
// Bedrock, this is the catalog that says what the account can actually invoke, while
// the vendor API still publishes the token limits Bedrock does not carry. Keeping
// both means a model can be checked against either.
//
// Bedrock exposes concrete dated releases rather than the vendor's moving aliases,
// so ids are projected back onto the exact vendor-API ids the platform persists.
//
// Three AWS calls back this source. The foundation-model listing says what exists and
// what it can do, the inference-profile listing says how a model that has no
// on-demand entry is actually called, and the Price List API says what the account
// pays for it. The rates matter most: on the Bedrock route they are the bill, and
// without them the catalog prices Bedrock traffic from an aggregator's copy of a
// public price page.

// What Bedrock reports about a model that the model record has no field for. It is
// kept in the source file rather than dropped, because it is the answer to "can this
// account still call this model, how, and with what inputs", which is exactly what a
// reader opens a Bedrock file to find out.
export type BedrockSourceOnlyFacts = {
    bedrockModelIds: string[]
    // The id Lixpi passes to Bedrock: the foundation model when it takes on-demand
    // traffic, otherwise the cross-region inference profile that covers it. This
    // mirrors how services/api resolves a model at call time.
    modelIdToInvoke: string
    invokedThroughInferenceProfile: boolean
    // Which price-list tier the rates in the model record came from, so a reader can
    // see the choice rather than infer it from the numbers.
    ratesReadFromTier?: BedrockRateTier
    inferenceTypesSupported: string[]
    inputModalities: string[]
    outputModalities: string[]
    supportsResponseStreaming: boolean
    customizationsSupported: string[]
    lifecycleStatus?: string
    endOfLifeTime?: string
    // Every tier the price list carries for this model, including the one the rates
    // above were not taken from, and the usage types each was read from.
    ratesByTier?: Record<string, BedrockModelRates>
    // Set when Bedrock lists the model but the price list has no entry under any id
    // it is known by, so a missing price reads as unmatched rather than free.
    noRatesInPriceList?: true
}

type BedrockModel = {
    fields: Partial<LixpiModelRecord>
    sourceOnlyFacts: BedrockSourceOnlyFacts
}

type BedrockModelFacts = Map<string, BedrockModel>

// Bedrock ids carry the vendor prefix, a release version, and sometimes a
// context-window variant: `anthropic.claude-3-haiku-20240307-v1:0:200k`. Only the
// vendor's own model id is wanted, and the dated snapshot on the end of that is
// collapsed into the family later. The 48k and 200k variants of one model are the
// same model to this catalog.
const projectModelId = (bedrockModelId: string): string | null => {
    const withoutVendor = bedrockModelId.replace(/^[a-z0-9-]+\./iu, '')

    if (withoutVendor === bedrockModelId)
        return null

    return withoutVendor.replace(/-v\d+(?::[A-Za-z0-9]+)*$/u, '')
}

export class BedrockSource implements ModelSource {
    readonly id: SourceId = 'bedrock'

    private readonly facts = new Map<ProviderDirectory, BedrockModelFacts | null>()
    private readonly pricing = new BedrockPricing(process.env.AWS_REGION ?? 'us-east-1')
    private profiles: InferenceProfileSummary[] = []

    // Which catalog directory Bedrock serves, and the name it lists each one's models
    // under. It comes from `_base-index.json` rather than a constant here, so adding a
    // Bedrock-served vendor is a data change. Every directory named is fetched on
    // every run whatever the `*_USE_AWS_BEDROCK_INFERENCE` flags say: a model's Bedrock
    // rates belong in the catalog whether or not Lixpi is billing on them today, so
    // flipping a flag re-prices from data already on disk instead of waiting for a
    // fetch.
    constructor(private readonly listedUnderProviderName: Partial<Record<ProviderDirectory, string>>) {}

    private client(): BedrockClient {
        const profile = process.env.AWS_PROFILE

        return new BedrockClient({
            region: process.env.AWS_REGION,
            ...(profile && { credentials: fromSSO({ profile }) }),
        })
    }

    async load(): Promise<void> {
        this.profiles = await this.loadInferenceProfiles()
        await this.loadPricing()

        for (const [directory, bedrockProvider] of Object.entries(this.listedUnderProviderName)) {
            const provider = directory as ProviderDirectory
            this.facts.set(provider, await this.loadProvider(provider, bedrockProvider!))
        }
    }

    // The price list is a separate API behind its own `pricing:GetProducts`
    // permission, so losing it means the account cannot read rates, not that the
    // session is gone. It downgrades the source and the sync carries on with the
    // aggregators' rates. An expired session is caught by the model listing, which
    // stops the run for every source at once.
    private async loadPricing(): Promise<void> {
        try {
            await this.pricing.load()
        } catch (error) {
            warn(`Bedrock price list skipped: ${error instanceof Error ? error.message : String(error)}. Bedrock-route rates fall back to the aggregators.`)
        }
    }

    private async loadInferenceProfiles(): Promise<InferenceProfileSummary[]> {
        const client = this.client()
        const profiles: InferenceProfileSummary[] = []
        let nextToken: string | undefined

        try {
            do {
                const response = await client.send(new ListInferenceProfilesCommand({ nextToken }))
                profiles.push(...(response.inferenceProfileSummaries ?? []))
                nextToken = response.nextToken
            } while (nextToken)

            info(`Bedrock returned ${profiles.length} inference profiles`)
        } catch (error) {
            if (isCredentialsProblem(error))
                throw new CredentialsExpiredError(process.env.AWS_PROFILE ?? 'default', error)

            warn(`Bedrock inference profiles skipped: ${error instanceof Error ? error.message : String(error)}`)
        }

        return profiles
    }

    private async loadProvider(
        provider: ProviderDirectory,
        bedrockProvider: string,
    ): Promise<BedrockModelFacts | null> {
        try {
            const response = await this.client().send(
                new ListFoundationModelsCommand({ byProvider: bedrockProvider }),
            )
            const summaries = new Map<string, FoundationModelSummary[]>()

            for (const summary of response.modelSummaries ?? []) {
                const modelId = summary.modelId ? projectModelId(summary.modelId) : null

                if (!modelId)
                    continue

                summaries.set(
                    modelId,
                    [...(summaries.get(modelId) ?? []), summary],
                )
            }

            const facts: BedrockModelFacts = new Map()

            for (const [modelId, releases] of summaries) {
                facts.set(
                    modelId,
                    this.buildModel(modelId, releases),
                )
            }

            info(`Bedrock catalog returned ${facts.size} ${bedrockProvider} models`)

            return facts
        } catch (error) {
            // An expired session is not a provider outage. Continuing would produce a
            // catalog quietly missing everything Bedrock knows, so the run stops.
            if (isCredentialsProblem(error))
                throw new CredentialsExpiredError(process.env.AWS_PROFILE ?? 'default', error)

            warn(`Bedrock ${bedrockProvider} catalog skipped: ${error instanceof Error ? error.message : String(error)}`)

            return null
        }
    }

    // One catalog entry can cover several dated Bedrock releases. The one that
    // decides how the model is called and priced is the release the platform would
    // select: an on-demand release when there is one, because that is the cheaper
    // route and the only one callable without a profile.
    private buildModel(
        modelId: string,
        releases: FoundationModelSummary[],
    ): BedrockModel {
        const onDemand = releases.find(release => (release.inferenceTypesSupported ?? []).includes('ON_DEMAND'))
        const selected = onDemand ?? releases.at(-1)!
        const profile = onDemand
            ? undefined
            : this.profileFor(selected.modelId)
        const modelIdToInvoke = profile?.inferenceProfileId ?? selected.modelId ?? modelId
        const rates = this.pricing.isLoaded()
            ? this.pricing.lookup([
                modelId,
                selected.modelId ?? '',
                selected.modelName ?? '',
            ])
            : null

        // Only a global profile bills at the global rate. A geo profile (`us.`, `eu.`)
        // and a plain on-demand call both bill at the region's own rate, so the id
        // being invoked decides the tier rather than merely whether a profile is
        // involved.
        const tier: BedrockRateTier = modelIdToInvoke.startsWith('global.')
            ? 'global-profile'
            : 'regional'
        const chosen = rates?.get(tier) ?? rates?.values().next().value ?? null

        const fields: Partial<LixpiModelRecord> = {
            ...(selected.modelName && { title: selected.modelName }),
        }
        const pricing = this.buildPricing(chosen)

        if (pricing)
            fields.pricing = pricing

        return {
            fields,
            sourceOnlyFacts: {
                bedrockModelIds: releases.map(release => release.modelId ?? '').filter(Boolean).sort(),
                modelIdToInvoke,
                invokedThroughInferenceProfile: Boolean(profile),
                ratesReadFromTier: tier,
                inferenceTypesSupported: selected.inferenceTypesSupported ?? [],
                inputModalities: selected.inputModalities ?? [],
                outputModalities: selected.outputModalities ?? [],
                supportsResponseStreaming: Boolean(selected.responseStreamingSupported),
                customizationsSupported: selected.customizationsSupported ?? [],
                ...(selected.modelLifecycle?.status && { lifecycleStatus: selected.modelLifecycle.status }),
                ...(selected.modelLifecycle?.endOfLifeTime && { endOfLifeTime: String(selected.modelLifecycle.endOfLifeTime) }),
                ...(rates && { ratesByTier: Object.fromEntries(rates) }),
                ...(this.pricing.isLoaded() && !rates && { noRatesInPriceList: true }),
            },
        }
    }

    // The same `find` the API's own resolver uses, so the registry names the profile
    // production would call rather than a different one from the same list.
    private profileFor(bedrockModelId: string | undefined): InferenceProfileSummary | undefined {
        if (!bedrockModelId)
            return undefined

        return this.profiles.find(profile => (profile.models ?? []).some(model => model.modelArn?.endsWith(`/${bedrockModelId}`)))
    }

    // Which cost family the rates belong to is decided by what the model emits, the
    // same way it is for every other source. A model that emits both text and images
    // publishes both families separately in the price list, so both are stated.
    private buildPricing(rates: BedrockModelRates | null): LixpiModelRecord['pricing'] | null {
        if (!rates)
            return null

        const pricing: Record<string, unknown> = {}

        if (
            rates.promptPerMillionTokens
            && rates.completionPerMillionTokens
        ) {
            pricing.text = {
                measuringUnit: 'tokens',
                pricePer: `${PER_MILLION}`,
                tiers: {
                    default: {
                        prompt: rates.promptPerMillionTokens,
                        completion: rates.completionPerMillionTokens,
                    },
                },
            }
        }

        if (
            rates.imagePromptPerMillionTokens
            && rates.imageCompletionPerMillionTokens
        ) {
            pricing.image = {
                measuringUnit: 'tokens',
                pricePer: `${PER_MILLION}`,
                prompt: rates.imagePromptPerMillionTokens,
                completion: rates.imageCompletionPerMillionTokens,
            }
        } else if (rates.pricePerImage) {
            // Billed per generated image. The unit is stated so the merge refuses to
            // drop this into a field that means credits or tokens.
            pricing.image = {
                measuringUnit: 'images',
                pricePer: '1',
                prompt: '0.00',
                completion: rates.pricePerImage,
            }
        }

        // A text-only model with no text rate has nothing worth publishing, and an
        // empty pricing object would merge as a claim that the model is free.
        // The file records the gap; a log line for it would fire for every model the
        // catalog index skips anyway.
        if (Object.keys(pricing).length === 0)
            return null

        return {
            currency: 'USD',
            ...pricing,
        } as LixpiModelRecord['pricing']
    }

    lookup(
        provider: ProviderDirectory,
        modelId: string,
    ): SourceModelFacts | null {
        const model = this.facts.get(provider)?.get(modelId)

        if (!model)
            return null

        return {
            byInferenceProvider: {
                'aws-bedrock': {
                    sourceKey: modelId,
                    fields: model.fields,
                    sourceOnlyFacts: model.sourceOnlyFacts,
                },
            },
        }
    }

    listAvailable(provider: ProviderDirectory): string[] | null {
        const facts = this.facts.get(provider)

        if (!facts)
            return null

        return [...facts.keys()].sort()
    }
}
