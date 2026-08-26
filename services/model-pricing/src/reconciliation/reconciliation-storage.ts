'use strict'

import DynamoDBService from '@lixpi/dynamodb-service'
import type {
    DailyPredictedProviderCost,
    ReconciliationActualCost,
    ReconciliationActualUsage,
    ReconciliationIncident,
} from '@lixpi/constants'
import { canonicalHash } from '../importer/canonical-json.ts'
import type { StoredPrediction } from './types.ts'

const predictionRecordKey = (prediction: DailyPredictedProviderCost): string =>
    `PREDICTION#${prediction.providerRoute}#${prediction.providerAccountRef}#${prediction.day}`

const actualRecordKey = (providerRoute: string, providerAccountRef: string, day: string): string =>
    `ACTUAL#${providerRoute}#${providerAccountRef}#${day}`

const actualUsageRecordKey = (providerRoute: string, providerAccountRef: string, day: string): string =>
    `USAGE_ACTUAL#${providerRoute}#${providerAccountRef}#${day}`

const predictionRecordKeyFor = (providerRoute: string, providerAccountRef: string, day: string): string =>
    `PREDICTION#${providerRoute}#${providerAccountRef}#${day}`

export class PricingReconciliationStorage {
    constructor(
        private readonly dynamo: DynamoDBService,
        private readonly table: string,
    ) {}

    async putPrediction(prediction: DailyPredictedProviderCost, payloadHash: string): Promise<{ idempotent: boolean }> {
        const recordKey = predictionRecordKey(prediction)
        const sortKey = `${prediction.snapshotId}#${payloadHash}`
        const existing = await this.dynamo.getItem({
            tableName: this.table,
            key: { recordKey, sortKey },
            consistentRead: true,
            origin: 'model-pricing.reconciliation-prediction-idempotency',
            throwOnError: true,
        }) as StoredPrediction | undefined
        if (existing) return { idempotent: true }
        const conflict = await this.dynamo.queryItems({
            tableName: this.table,
            keyConditions: { recordKey },
            fetchAllItems: true,
            consistentRead: true,
            origin: 'model-pricing.reconciliation-prediction-conflict',
        })
        const sameSnapshot = ((conflict?.items ?? []) as StoredPrediction[]).find(value => value.snapshotId === prediction.snapshotId)
        if (sameSnapshot && sameSnapshot.payloadHash !== payloadHash) {
            throw new Error(`Predicted provider cost replay for ${recordKey}/${prediction.snapshotId} has different content`)
        }
        const result = await this.dynamo.putItem({
            tableName: this.table,
            item: { recordKey, sortKey, ...prediction, payloadHash, receivedAt: new Date().toISOString() },
            origin: 'model-pricing.reconciliation-prediction',
            throwOnError: true,
        })
        if (!result) throw new Error('Failed to persist predicted provider cost')
        return { idempotent: false }
    }

    async getPredictionsSince(day: string): Promise<StoredPrediction[]> {
        const response = await this.dynamo.scanItems({
            tableName: this.table,
            fetchAllItems: true,
            origin: 'model-pricing.reconciliation-predictions-scan',
        })
        return ((response?.items ?? []) as StoredPrediction[])
            .filter(value => value.recordKey.startsWith('PREDICTION#') && value.day >= day)
    }

    async getPredictions(providerRoute: string, providerAccountRef: string, day: string): Promise<StoredPrediction[]> {
        const response = await this.dynamo.queryItems({
            tableName: this.table,
            keyConditions: { recordKey: predictionRecordKeyFor(providerRoute, providerAccountRef, day) },
            fetchAllItems: true,
            consistentRead: true,
            origin: 'model-pricing.reconciliation-day-predictions',
        })
        return (response?.items ?? []) as StoredPrediction[]
    }

    async replaceActuals(providerRoute: string, providerAccountRef: string, day: string, actuals: ReconciliationActualCost[]): Promise<void> {
        const recordKey = actualRecordKey(providerRoute, providerAccountRef, day)
        const existing = await this.dynamo.queryItems({
            tableName: this.table,
            keyConditions: { recordKey },
            fetchAllItems: true,
            consistentRead: true,
            origin: 'model-pricing.reconciliation-existing-actuals',
        })
        for (const value of existing?.items ?? []) {
            await this.dynamo.deleteItems({
                tableName: this.table,
                key: { recordKey, sortKey: (value as { sortKey: string }).sortKey },
                origin: 'model-pricing.reconciliation-replace-actuals',
            })
        }
        for (const actual of actuals) {
            const result = await this.dynamo.putItem({
                tableName: this.table,
                item: { recordKey, sortKey: actual.sourceHash, ...actual },
                origin: 'model-pricing.reconciliation-actual',
                throwOnError: true,
            })
            if (!result) throw new Error('Failed to persist provider actual')
        }
        await this.dynamo.putItem({
            tableName: this.table,
            item: { recordKey: 'WATERMARK', sortKey: `${providerRoute}#${providerAccountRef}`, providerRoute, providerAccountRef, day, observedAt: new Date().toISOString() },
            origin: 'model-pricing.reconciliation-watermark',
            throwOnError: true,
        })
    }

    async getActuals(providerRoute: string, providerAccountRef: string, day: string): Promise<ReconciliationActualCost[]> {
        const response = await this.dynamo.queryItems({
            tableName: this.table,
            keyConditions: { recordKey: actualRecordKey(providerRoute, providerAccountRef, day) },
            fetchAllItems: true,
            consistentRead: true,
            origin: 'model-pricing.reconciliation-day-actuals',
        })
        return (response?.items ?? []) as ReconciliationActualCost[]
    }

    async replaceUsageActuals(providerRoute: string, providerAccountRef: string, day: string, actuals: ReconciliationActualUsage[]): Promise<void> {
        const recordKey = actualUsageRecordKey(providerRoute, providerAccountRef, day)
        const existing = await this.dynamo.queryItems({
            tableName: this.table,
            keyConditions: { recordKey },
            fetchAllItems: true,
            consistentRead: true,
            origin: 'model-pricing.reconciliation-existing-usage-actuals',
        })
        for (const value of existing?.items ?? []) {
            await this.dynamo.deleteItems({
                tableName: this.table,
                key: { recordKey, sortKey: (value as { sortKey: string }).sortKey },
                origin: 'model-pricing.reconciliation-replace-usage-actuals',
            })
        }
        for (const actual of actuals) {
            const result = await this.dynamo.putItem({
                tableName: this.table,
                item: { recordKey, sortKey: actual.sourceHash, ...actual },
                origin: 'model-pricing.reconciliation-usage-actual',
                throwOnError: true,
            })
            if (!result) throw new Error('Failed to persist provider usage actual')
        }
    }

    async getUsageActuals(providerRoute: string, providerAccountRef: string, day: string): Promise<ReconciliationActualUsage[]> {
        const response = await this.dynamo.queryItems({
            tableName: this.table,
            keyConditions: { recordKey: actualUsageRecordKey(providerRoute, providerAccountRef, day) },
            fetchAllItems: true,
            consistentRead: true,
            origin: 'model-pricing.reconciliation-day-usage-actuals',
        })
        return (response?.items ?? []) as ReconciliationActualUsage[]
    }

    async getWatermarks(): Promise<Array<{ providerRoute: string; providerAccountRef: string; day: string; observedAt: string }>> {
        const response = await this.dynamo.queryItems({
            tableName: this.table,
            keyConditions: { recordKey: 'WATERMARK' },
            fetchAllItems: true,
            consistentRead: true,
            origin: 'model-pricing.reconciliation-watermarks',
        })
        return (response?.items ?? []) as Array<{ providerRoute: string; providerAccountRef: string; day: string; observedAt: string }>
    }

    async getOpenIncidents(): Promise<ReconciliationIncident[]> {
        const response = await this.dynamo.queryItems({
            tableName: this.table,
            keyConditions: { recordKey: 'INCIDENT' },
            fetchAllItems: true,
            consistentRead: true,
            origin: 'model-pricing.reconciliation-open-incidents',
        })
        return ((response?.items ?? []) as ReconciliationIncident[]).filter(incident => incident.status === 'open')
    }

    async pruneSettledRecords(retentionMs: number): Promise<{ prunedCount: number }> {
        const cutoffDay = new Date(Date.now() - retentionMs).toISOString().slice(0, 10)
        const response = await this.dynamo.scanItems({
            tableName: this.table,
            fetchAllItems: true,
            origin: 'model-pricing.reconciliation-prune-scan',
        })
        const items = (response?.items ?? []) as Array<{ recordKey: string; sortKey: string; day?: string; status?: string; resolvedAt?: string }>
        let prunedCount = 0
        for (const item of items) {
            const isResolvedIncident = item.recordKey === 'INCIDENT' && item.status === 'resolved'
            const day = isResolvedIncident ? item.resolvedAt?.slice(0, 10) : item.day
            const isPrunable = item.recordKey.startsWith('PREDICTION#') || item.recordKey.startsWith('ACTUAL#')
                || item.recordKey.startsWith('USAGE_ACTUAL#') || isResolvedIncident
            if (!isPrunable || !day || day >= cutoffDay) continue
            await this.dynamo.deleteItems({
                tableName: this.table,
                key: { recordKey: item.recordKey, sortKey: item.sortKey },
                origin: 'model-pricing.reconciliation-prune-delete',
            })
            prunedCount++
        }
        return { prunedCount }
    }

    async putIncident(incident: ReconciliationIncident): Promise<void> {
        const previous = await this.dynamo.queryItems({
            tableName: this.table,
            keyConditions: { recordKey: 'INCIDENT' },
            fetchAllItems: true,
            consistentRead: true,
            origin: 'model-pricing.reconciliation-existing-incidents',
        })
        const sameScope = ((previous?.items ?? []) as ReconciliationIncident[]).filter(value => value.status === 'open'
            && this.incidentScope(value) === this.incidentScope(incident))
        const result = await this.dynamo.putItem({
            tableName: this.table,
            item: { recordKey: 'INCIDENT', sortKey: incident.incidentId, ...incident },
            origin: 'model-pricing.reconciliation-incident',
            throwOnError: true,
        })
        if (!result) throw new Error('Failed to persist reconciliation incident')
        for (const value of sameScope) {
            if (value.incidentId === incident.incidentId) continue
            await this.dynamo.deleteItems({
                tableName: this.table,
                key: { recordKey: 'INCIDENT', sortKey: value.incidentId },
                origin: 'model-pricing.reconciliation-resolve-incident',
            })
        }
    }

    private incidentScope(incident: ReconciliationIncident): string {
        return canonicalHash({
            kind: incident.kind ?? 'cost',
            providerRoute: incident.providerRoute,
            providerAccountRef: incident.providerAccountRef,
            day: incident.day,
            providerModel: incident.providerModel ?? '',
            grouping: incident.grouping ?? {},
            usageDimension: incident.usageDimension ?? '',
        })
    }
}
