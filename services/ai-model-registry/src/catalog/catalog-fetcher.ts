import {
    info,
    warn,
} from '@lixpi/debug-tools'

import {
    type CatalogSchema,
} from './base-schema.ts'
import {
    groupIntoFamilies,
    type ModelFamily,
} from './model-identity.ts'
import { BedrockSource } from './sources/bedrock-source.ts'
import {
    type CatalogBaseIndex,
} from './base-index.ts'
import { LiteLlmSource } from './sources/litellm-source.ts'
import {
    type ModelCatalogStore,
} from './model-catalog-store.ts'
import { ModelsDevSource } from './sources/models-dev-source.ts'
import { ProviderCatalogIndex } from './catalog-index.ts'
import { ProviderApiSource } from './sources/provider-api-source.ts'
import {
    type InferenceProviderId,
    type ProviderDirectory,
    type SourceModelRecord,
} from './types.ts'
import {
    type ModelSource,
    type SourceModelFacts,
} from './sources/model-source.ts'
import { CredentialsExpiredError } from './sources/credentials-error.ts'

export type FetchResult = {
    discovered: number
    // Models the catalog index skips, so nothing was written for them.
    skipped: string[]
    scaffolded: string[]
    models: number
    sourceFiles: number
    uncovered: number
}

// Asks every source about every model in the tree and writes one file per source per
// model, including for sources that have nothing to say. A source file that records
// "no data" is the point: it makes a gap visible in the tree instead of leaving a
// reader to wonder whether the source was ever consulted.
//
// Discovery is separate from selection. What a provider lists becomes a model in the
// tree with an empty `-lixpi.json` scaffold; whether it reaches DynamoDB is decided
// by `_catalog-index.json` and by whether its authored fields are filled in.
export class CatalogFetcher {
    private readonly sources: ModelSource[]

    constructor(
        private readonly store: ModelCatalogStore,
        private readonly schema: CatalogSchema,
        private readonly baseIndex: CatalogBaseIndex,
        sources?: ModelSource[],
    ) {
        // The merge's precedence lives in SOURCE_PRECEDENCE; this order only decides
        // which source is asked first, and every answer is written to its own file
        // regardless.
        this.sources = sources ?? [
            new LiteLlmSource(),
            new ModelsDevSource(),
            new ProviderApiSource(),
            new BedrockSource(
                baseIndex.listedUnderProviderName('aws-bedrock'),
            ),
        ]
    }

    private async loadSources(): Promise<ModelSource[]> {
        const loaded: ModelSource[] = []

        for (const source of this.sources) {
            try {
                await source.load()
                loaded.push(source)
            } catch (error) {
                // A provider being down is a skip. Missing or expired credentials are
                // not: the run would produce a catalog quietly missing whatever that
                // source knows, so it stops here instead.
                if (error instanceof CredentialsExpiredError)
                    throw error

                warn(`Source ${source.id} unavailable: ${error instanceof Error ? error.message : String(error)}`)
            }
        }

        return loaded
    }

    // What a provider says it offers, plus everything already in the tree, collapsed
    // into one entry per model family. A provider publishes a moving alias and its
    // dated snapshots as separate ids; they are one model, so the catalog holds one
    // file named without the snapshot suffix and calls whichever version is current.
    //
    // Only the provider APIs are used for discovery: the aggregators list thousands
    // of models across every vendor, most of which Lixpi has no route to.
    private async discover(
        sources: ModelSource[],
        provider: ProviderDirectory,
    ): Promise<ModelFamily[]> {
        const known = new Set<string>()

        // An id a model already claims as its own alias belongs to that model, not to
        // a new entry. Bedrock calls Stability's Ultra endpoint `stable-image-ultra`
        // while the catalog calls it `stability-ultra`; without this, discovery would
        // create a second directory for the same model.
        const aliasOwners = new Map<string, string>()

        // Tree entries are already family-named, so they seed their own family.
        for (const modelId of await this.store.listModels(provider)) {
            known.add(modelId)

            const authored = await this.store.readLixpiRecord(provider, modelId)

            for (const alias of authored.otherIdsUsedBySources ?? [])
                aliasOwners.set(alias, modelId)
        }

        // Both account-level catalogs contribute: a model reachable through Bedrock
        // but absent from the vendor's own listing still exists for this account.
        for (const source of sources) {
            if (
                source.id !== 'provider-api'
                && source.id !== 'bedrock'
            )
                continue

            for (const modelId of source.listAvailable(provider) ?? [])
                known.add(aliasOwners.get(modelId) ?? modelId)
        }

        return groupIntoFamilies([...known])
    }

    async run(): Promise<FetchResult> {
        const sources = await this.loadSources()
        const result: FetchResult = {
            discovered: 0,
            skipped: [],
            scaffolded: [],
            models: 0,
            sourceFiles: 0,
            uncovered: 0,
        }

        for (const provider of this.store.listProviders()) {
            const index = await ProviderCatalogIndex.load(this.store.rootDir, provider)
            const providerBase = await this.store.readProviderBase(provider)
            const inheritedFields = Object.keys(providerBase?.fieldsInheritedByEveryModel ?? {})
            const families = await this.discover(sources, provider)
            const supported = new Set(this.baseIndex.providersFor(provider))
            result.discovered += families.length

            for (const family of families) {
                const modelId = family.family

                // A skipped model is not scaffolded and not fetched for. Doing either
                // would re-create the directory the sync just deleted.
                if (!index.includes(modelId)) {
                    result.skipped.push(`${provider}/${modelId}`)

                    continue
                }

                const created = await this.store.createLixpiRecordIfMissing(
                    provider,
                    modelId,
                    this.schema.scaffoldLixpiRecord(inheritedFields),
                )

                if (created)
                    result.scaffolded.push(`${provider}/${modelId}`)

                let covered = false

                // A catalog entry is named by its family, but a source keys on
                // whichever id it happens to carry: the family name, the moving
                // alias, or any one of the dated snapshots. Anthropic, for instance,
                // publishes only `claude-haiku-4-5-20251001` for a model this
                // catalog calls `claude-haiku-4-5`. Every id in the family is tried,
                // current version first, followed by any alias the authored file
                // records for a source that names the model differently again.
                const authored = await this.store.readLixpiRecord(provider, modelId)
                const candidates = [...new Set([
                    family.latest,
                    modelId,
                    ...family.versions,
                    ...(authored.otherIdsUsedBySources ?? []),
                ])]

                for (const source of sources) {
                    // Inference providers are collected across every candidate rather
                    // than stopping at the first match. One id can match a source's
                    // Bedrock entry while a different id matches the vendor's:
                    // LiteLLM knows Stability Ultra as `stability/stable-image-ultra`
                    // on Stability's own API and `stability.stable-image-ultra-v1:0`
                    // on Bedrock.
                    const found: SourceModelFacts['byInferenceProvider'] = {}

                    for (const candidate of candidates) {
                        const candidateFacts = source.lookup(
                            provider,
                            candidate,
                            candidates,
                        )

                        for (const [inferenceProvider, providerFacts] of Object.entries(candidateFacts?.byInferenceProvider ?? {})) {
                            // A source knows more endpoints than Lixpi can call.
                            // LiteLLM prices OpenAI models on Bedrock, which no Lixpi
                            // adapter routes to, and recording it would put a rate in
                            // the tree for a call that cannot be made.
                            if (!supported.has(inferenceProvider as InferenceProviderId))
                                continue

                            if (found[inferenceProvider as InferenceProviderId])
                                continue

                            found[inferenceProvider as InferenceProviderId] = providerFacts
                        }
                    }

                    const facts = Object.keys(found).length > 0
                        ? { byInferenceProvider: found }
                        : null

                    // The provider API is what knows which concrete version to call,
                    // so it carries the family's versions and the resolved id. Only
                    // when it actually listed the model: a provider that publishes no
                    // listing endpoint, such as BytePlus, would otherwise "resolve"
                    // the family name back over the real dated id in the authored
                    // file.
                    const publishedVersions = source.id === 'provider-api'
                        && facts
                        ? {
                            currentVersion: family.latest,
                            allPublishedVersions: family.versions,
                        }
                        : undefined

                    const byInferenceProvider: SourceModelRecord['byInferenceProvider'] = {}

                    for (const [inferenceProvider, providerFacts] of Object.entries(facts?.byInferenceProvider ?? {})) {
                        byInferenceProvider[inferenceProvider as InferenceProviderId] = {
                            ...providerFacts.fields,
                            ...(publishedVersions && {
                                model: family.latest,
                                modelVersion: family.latest,
                            }),
                            modelKeyAtSource: providerFacts.sourceKey,
                            ...(providerFacts.sourceOnlyFacts && { sourceOnlyFacts: providerFacts.sourceOnlyFacts }),
                        }
                    }

                    // An entry counts as data only for fields the model record
                    // carries. Its key at the source and whatever it reports beside
                    // the record are context, so a source that knows only that the
                    // model exists still reads as having nothing to merge.
                    const inferenceProvidersWithData = (Object.keys(byInferenceProvider) as InferenceProviderId[])
                        .filter(inferenceProvider => Object.keys(byInferenceProvider[inferenceProvider]!)
                            .filter(field => field !== 'modelKeyAtSource' && field !== 'sourceOnlyFacts').length > 0)

                    const record: SourceModelRecord = {
                        byInferenceProvider,
                        _fetchedFrom: {
                            sourceName: source.id,
                            hasDataForThisModel: inferenceProvidersWithData.length > 0,
                            inferenceProvidersWithData,
                            fetchedAt: new Date().toISOString(),
                            ...(publishedVersions && { publishedVersions }),
                            ...(!facts && { note: 'This source has no entry for this model.' }),
                            ...(facts && inferenceProvidersWithData.length === 0 && { note: 'This source lists the model but carries no field Lixpi uses.' }),
                        },
                    }

                    covered ||= record._fetchedFrom.hasDataForThisModel

                    await this.store.writeSourceRecord(
                        provider,
                        modelId,
                        source.id,
                        record,
                    )
                    result.sourceFiles += 1
                }

                result.models += 1

                if (!covered)
                    result.uncovered += 1
            }
        }

        info(`Catalog fetch: ${result.discovered} models discovered, ${result.skipped.length} skipped by the catalog index, ${result.scaffolded.length} scaffolded, ${result.sourceFiles} source files written, ${result.uncovered} models no source covers`)

        for (const scaffolded of result.scaffolded)
            warn(`SCAFFOLDED ${scaffolded}: empty -lixpi.json created, its authored fields still need filling in`)

        return result
    }
}
