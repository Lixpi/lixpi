import {
    info,
    warn,
} from '@lixpi/debug-tools'
import {
    type AiModel,
} from '@lixpi/constants'

import { CatalogBaseIndex } from './base-index.ts'
import { CatalogFetcher } from './catalog-fetcher.ts'
import { CatalogSchema } from './base-schema.ts'
import {
    DriftReporter,
    type DriftReport,
} from './drift-reporter.ts'
import {
    DynamoDbCatalogWriter,
    type CatalogWriteResult,
} from './dynamodb-catalog-writer.ts'
import { ModelCatalogStore } from './model-catalog-store.ts'
import { ModelMerger } from './model-merger.ts'
import { ProviderCatalogIndex } from './catalog-index.ts'
import {
    PROVIDER_DIRECTORIES,
    type MergedModel,
    type ProviderDirectory,
} from './types.ts'

export type CatalogSyncOptions = {
    catalogDir: string
    // Off in production, where the catalog tree ships with the image and is read
    // only. A production run merges what shipped and writes DynamoDB.
    writeCatalogFiles: boolean
    writeDynamoDb: boolean
}

export type ModelStatusSummary = {
    modelId: string
    detail: string[]
}

export type CatalogSyncResult = {
    ranAt: string
    models: number
    // Model directories deleted because the catalog index skips them.
    removed: string[]
    included: number
    excluded: ModelStatusSummary[]
    incomplete: ModelStatusSummary[]
    unitMismatches: ModelStatusSummary[]
    usedFallback: ModelStatusSummary[]
    drift: DriftReport
    write: Record<string, CatalogWriteResult>
    totalNew: number
    totalUpdated: number
    totalDeleted: number
    totalProcessed: number
}

// One sync: discover, fetch every source into its own file, merge each model against
// the base schema, write the merged file, and send the complete ones to DynamoDB.
// A model reaches DynamoDB only when `_catalog-index.json` includes it and every
// field the schema demands is filled in.
export class CatalogSync {
    private readonly store: ModelCatalogStore

    constructor(private readonly options: CatalogSyncOptions) {
        this.store = new ModelCatalogStore(options.catalogDir)
    }

    private async mergeAll(): Promise<MergedModel[]> {
        const schema = await CatalogSchema.load(this.store.rootDir)
        const baseIndex = await CatalogBaseIndex.load(this.store.rootDir)
        const merger = new ModelMerger(schema)
        const merged: MergedModel[] = []

        for (const provider of this.store.listProviders()) {
            const index = await ProviderCatalogIndex.load(this.store.rootDir, provider)

            for (const modelId of await this.store.listModels(provider)) {
                const bundle = await this.store.loadBundle(provider, modelId)
                merged.push(
                    merger.merge(
                        bundle,
                        index,
                        baseIndex,
                    ),
                )
            }
        }

        return merged
    }

    // The merged catalog as it stands, without fetching or writing anything.
    async loadMerged(): Promise<MergedModel[]> {
        return await this.mergeAll()
    }

    private summarize(
        merged: MergedModel[],
        pick: (entry: MergedModel) => string[],
    ): ModelStatusSummary[] {
        return merged.map(
            entry => ({
                modelId: `${PROVIDER_DIRECTORIES[entry.provider]}:${entry.modelId}`,
                detail: pick(entry),
            }),
        ).filter(entry => entry.detail.length > 0)
    }

    async run(): Promise<CatalogSyncResult> {
        const ranAt = new Date().toISOString()

        if (this.options.writeCatalogFiles) {
            const schema = await CatalogSchema.load(this.store.rootDir)
            const baseIndex = await CatalogBaseIndex.load(this.store.rootDir)
            await new CatalogFetcher(
                this.store,
                schema,
                baseIndex,
            ).run()
        }

        const merged = await this.mergeAll()

        // A model the catalog index skips is removed from the tree entirely, its
        // directory included, after everything in it is copied into history/. Leaving
        // the files behind would mean the tree no longer says what the catalog holds,
        // and the next run would fetch for it again.
        const removed: string[] = []

        if (this.options.writeCatalogFiles) {
            for (const entry of merged) {
                if (entry.meta.syncStatus === 'skipped-by-catalog-index') {
                    const keptIn = await this.store.removeModel(entry.provider, entry.modelId)
                    removed.push(`${PROVIDER_DIRECTORIES[entry.provider]}:${entry.modelId}`)
                    warn(
                        `REMOVED ${PROVIDER_DIRECTORIES[entry.provider]}:${entry.modelId}: skipped by _catalog-index.json, directory deleted${keptIn ? `, previous version kept in ${keptIn}` : ''}`,
                    )

                    continue
                }

                await this.store.writeMergedRecord(
                    entry.provider,
                    entry.modelId,
                    entry.file,
                )
                await this.store.writeMetaRecord(
                    entry.provider,
                    entry.modelId,
                    entry.meta,
                )
            }
        }

        const reporter = new DriftReporter()
        const drift = reporter.build(
            merged.flatMap(entry => entry.drift),
        )
        reporter.log(drift)

        const excluded = this.summarize(
            merged,
            entry => (entry.meta.syncStatus === 'skipped-by-catalog-index' ? [entry.meta.note ?? 'excluded'] : []),
        )
        const incomplete = this.summarize(
            merged,
            entry => (entry.meta.syncStatus === 'missing-required-fields' ? entry.meta.requiredFieldsStillMissing : []),
        )
        const unitMismatches = this.summarize(merged, entry => entry.meta.ratesRefusedBecauseUnitsDiffer)
        const usedFallback = this.summarize(merged, entry => entry.meta.fieldsFilledFromSchemaDefault)

        for (const entry of incomplete)
            warn(`INCOMPLETE ${entry.modelId}: ${entry.detail.join(', ')} not filled in, not written to DynamoDB`)

        for (const entry of unitMismatches)
            warn(`UNIT MISMATCH ${entry.modelId}: ${entry.detail.join(', ')} kept from the authored file, the source measures it differently`)

        for (const entry of usedFallback)
            warn(`NO SOURCE ${entry.modelId}: ${entry.detail.join(', ')} written from the schema fallback`)

        const byProvider = new Map<ProviderDirectory, AiModel[]>()

        for (const entry of merged) {
            if (!entry.model)
                continue

            const models = byProvider.get(entry.provider) ?? []
            models.push(entry.model)
            byProvider.set(entry.provider, models)
        }

        const write: Record<string, CatalogWriteResult> = {}

        if (this.options.writeDynamoDb) {
            const writer = new DynamoDbCatalogWriter()

            for (const [provider, models] of byProvider) {
                const providerKey = PROVIDER_DIRECTORIES[provider]
                write[providerKey] = await writer.writeProvider(providerKey, models)
            }
        } else
            warn('DynamoDB write disabled; the merged catalog was built but not persisted')

        const results = Object.values(write)
        const included = merged.filter(entry => entry.model !== null).length
        const result: CatalogSyncResult = {
            ranAt,
            models: merged.length,
            removed,
            included,
            excluded,
            incomplete,
            unitMismatches,
            usedFallback,
            drift,
            write,
            totalNew: results.reduce((total, entry) => total + entry.newModels, 0),
            totalUpdated: results.reduce((total, entry) => total + entry.updatedModels, 0),
            totalDeleted: results.reduce((total, entry) => total + entry.deletedModels, 0),
            totalProcessed: results.reduce((total, entry) => total + entry.processed, 0),
        }

        info(
            `Catalog sync complete: ${merged.length} models in the tree, ${included} written, ${incomplete.length} incomplete, ${excluded.length} excluded, ${drift.total} drift findings`,
        )

        return result
    }
}
