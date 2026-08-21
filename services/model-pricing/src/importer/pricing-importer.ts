'use strict'

import DynamoDBService from '@lixpi/dynamodb-service'
import type { ModelPriceRecord } from '@lixpi/constants'
import { canonicalHash } from './canonical-json.ts'
import { LiteLlmFeedImporter } from './litellm-feed.ts'
import { createProviderAdapters } from './provider-adapters.ts'
import { PricingStorage } from './pricing-storage.ts'
import { resolveLiteLlmCandidate } from './route-resolution.ts'
import { ProviderSourceError } from './secure-fetch.ts'
import type { CatalogPricingModel, CandidateHold, CandidateHoldReason, ProviderValidationResult } from './types.ts'

type CatalogRecord = {
    provider: string
    model: string
    pricingReference: Record<string, unknown>
}

const isCatalogPricingModel = (value: Record<string, unknown>): value is CatalogRecord => {
    const pricingReference = value.pricingReference
    return typeof value.provider === 'string'
        && typeof value.model === 'string'
        && pricingReference !== null
        && typeof pricingReference === 'object'
        && typeof (pricingReference as Record<string, unknown>).pricingKey === 'string'
        && typeof (pricingReference as Record<string, unknown>).providerRoute === 'string'
        && typeof (pricingReference as Record<string, unknown>).vendorModel === 'string'
        && typeof (pricingReference as Record<string, unknown>).pricingRegion === 'string'
}

export class PricingImporter {
    private readonly feedImporter = new LiteLlmFeedImporter()
    private readonly adapters = createProviderAdapters()

    constructor(
        private readonly dynamo: DynamoDBService,
        private readonly storage: PricingStorage,
        private readonly catalogTable: string,
    ) {}

    async import(): Promise<{ snapshotId: string; records: number; holds: number }> {
        const createdAt = new Date().toISOString()
        const feed = await this.feedImporter.fetch()
        const catalogModels = await this.loadCatalogModels()
        const records: ModelPriceRecord[] = []
        const holds: CandidateHold[] = []

        for (const model of catalogModels) {
            const candidate = resolveLiteLlmCandidate(model, feed, createdAt)
            if (!candidate) {
                holds.push({ pricingKey: model.pricingKey, reason: 'missing-upstream-entry', detail: 'No exact or route-prefixed LiteLLM entry exists', createdAt })
                continue
            }
            const adapter = this.adapters.get(model.providerRoute)
            if (!adapter) {
                holds.push({ pricingKey: model.pricingKey, candidateHash: candidate.candidateHash, reason: 'unsupported-route', detail: `No provider adapter exists for ${model.providerRoute}`, createdAt })
                continue
            }
            let validation: ProviderValidationResult
            try {
                validation = await adapter.validate(candidate)
            } catch (error) {
                // A single provider adapter failing (network hiccup, unexpected page
                // shape) must hold only this pricingKey, never abort the whole run.
                const reason: CandidateHoldReason = error instanceof ProviderSourceError
                    ? error.reason
                    : 'provider-evidence-unavailable'
                const detail = error instanceof Error ? error.message : String(error)
                holds.push({ pricingKey: model.pricingKey, candidateHash: candidate.candidateHash, reason, detail, createdAt })
                continue
            }
            if (validation.status === 'held') {
                holds.push({ pricingKey: model.pricingKey, candidateHash: candidate.candidateHash, reason: validation.reason, detail: validation.detail, createdAt })
                continue
            }
            records.push({
                ...candidate.record,
                snapshotId: '',
                variants: validation.variants,
                verification: { status: 'verified', candidateHash: candidate.candidateHash, verifiedAt: createdAt },
                createdAt,
            })
        }

        const normalizedRecords = records
            .map(({
                snapshotId: _snapshotId,
                createdAt: _createdAt,
                verification,
                ...record
            }) => ({
                ...record,
                verification: {
                    status: verification.status,
                    candidateHash: verification.candidateHash,
                },
            }))
            .sort((a, b) => a.pricingKey.localeCompare(b.pricingKey))
        const normalizedHolds = holds
            .map(({ createdAt: _createdAt, ...hold }) => hold)
            .sort((a, b) => a.pricingKey.localeCompare(b.pricingKey))
        const normalizedContentHash = canonicalHash({ records: normalizedRecords, holds: normalizedHolds })
        const snapshotId = `candidate-${feed.commitSha.slice(0, 12)}-${normalizedContentHash.slice(0, 12)}`
        const stagedRecords = records.map(record => ({ ...record, snapshotId }))
        await this.storage.stageRun({ snapshotId, sourceRevision: feed.commitSha, normalizedContentHash, records: stagedRecords, holds, createdAt })
        return { snapshotId, records: stagedRecords.length, holds: holds.length }
    }

    private async loadCatalogModels(): Promise<CatalogPricingModel[]> {
        const response = await this.dynamo.scanItems({ tableName: this.catalogTable, fetchAllItems: true, origin: 'model-pricing.catalog-scan' })
        const items = (response?.items ?? []) as Record<string, unknown>[]
        return items.filter(isCatalogPricingModel).map(item => ({
            provider: item.provider as CatalogPricingModel['provider'],
            model: item.model as string,
            ...(item.pricingReference as Omit<CatalogPricingModel, 'provider' | 'model'>),
        }))
    }
}
