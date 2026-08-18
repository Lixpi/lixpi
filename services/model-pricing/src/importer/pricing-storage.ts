'use strict'

import DynamoDBService from '@lixpi/dynamodb-service'
import type { ModelPriceRecord, PricingSnapshotManifest } from '@lixpi/constants'
import type { CandidateHold } from './types.ts'

export type PricingStorageTables = {
    snapshots: string
    records: string
    audit: string
}

export class PricingStorage {
    constructor(
        private readonly dynamo: DynamoDBService,
        private readonly tables: PricingStorageTables,
    ) {}

    async stageRun({
        snapshotId,
        sourceRevision,
        normalizedContentHash,
        records,
        holds,
        createdAt,
    }: {
        snapshotId: string
        sourceRevision: string
        normalizedContentHash: string
        records: ModelPriceRecord[]
        holds: CandidateHold[]
        createdAt: string
    }): Promise<PricingSnapshotManifest> {
        const existing = await this.dynamo.getItem({
            tableName: this.tables.snapshots,
            key: { recordKey: 'SNAPSHOT', sortKey: snapshotId },
            consistentRead: true,
            origin: 'model-pricing.existing-manifest',
            throwOnError: true,
            throwOnError: true,
        }) as PricingSnapshotManifest | undefined
        if (existing) {
            if (existing.sourceRevision !== sourceRevision
                || existing.normalizedContentHash !== normalizedContentHash
                || existing.recordCount !== records.length
                || existing.status !== 'complete') {
                throw new Error(`Immutable pricing snapshot collision for ${snapshotId}`)
            }
            return existing
        }

        if (records.length > 0) {
            await this.batchWriteOrThrow({
                tableName: this.tables.records,
                items: records,
                origin: 'model-pricing.stage-record',
            })
        }

        if (holds.length > 0) {
            await this.batchWriteOrThrow({
                tableName: this.tables.snapshots,
                items: holds.map(hold => ({
                    recordKey: `HOLD#${hold.pricingKey}`,
                    sortKey: 'CURRENT',
                    ...hold,
                })),
                origin: 'model-pricing.stage-hold',
            })
        }

        const manifest: PricingSnapshotManifest = {
            recordKey: 'SNAPSHOT',
            sortKey: snapshotId,
            snapshotId,
            sourceRevision,
            normalizedContentHash,
            recordCount: records.length,
            status: 'complete',
            createdAt,
        }
        await this.putItemOrThrow({
            tableName: this.tables.audit,
            item: {
                recordKey: 'IMPORT_RUN',
                sortKey: snapshotId,
                snapshotId,
                sourceRevision,
                recordCount: records.length,
                holdCount: holds.length,
                createdAt,
            },
            origin: 'model-pricing.stage-run-audit',
        })
        await this.putItemOrThrow({ tableName: this.tables.snapshots, item: manifest, origin: 'model-pricing.stage-manifest' })
        return manifest
    }

    private async putItemOrThrow({
        tableName,
        item,
        origin,
    }: {
        tableName: string
        item: Record<string, unknown>
        origin: string
    }): Promise<void> {
        const result = await this.dynamo.putItem({ tableName, item, origin, throwOnError: true })
        if (!result) {
            throw new Error(`DynamoDB write failed for ${origin}`)
        }
    }

    private async batchWriteOrThrow({
        tableName,
        items,
        origin,
    }: {
        tableName: string
        items: Record<string, unknown>[]
        origin: string
    }): Promise<void> {
        const result = await this.dynamo.batchWriteItems({ tableName, items, origin })
        if (!result) {
            throw new Error(`DynamoDB batch write failed for ${origin}`)
        }
    }
}
