'use strict'

import type {
    DailyPredictedProviderCost,
    PredictedProviderUsageGroup,
    ReconciliationActualUsage,
    ReconciliationIncident,
} from '@lixpi/constants'
import { canonicalHash } from '../importer/canonical-json.ts'
import { PricingReconciliationStorage } from './reconciliation-storage.ts'
import { supportsUsageActuals, type ActualsAdapter } from './types.ts'
import { formatUsdMicros, parseUsdMicros } from './decimal-usd.ts'

const dayPattern = /^\d{4}-\d{2}-\d{2}$/
const quantityPattern = /^(0|[1-9]\d*)$/

const parseQuantity = (value: string): bigint => {
    if (!quantityPattern.test(value)) throw new Error(`Usage quantity must be a non-negative integer, received ${value}`)
    return BigInt(value)
}

type AggregatedPredictedUsage = {
    pricingKey: string
    providerModel: string
    usageKind: PredictedProviderUsageGroup['usageKind']
    grouping: Record<string, string>
    usage: Map<string, bigint>
}

export class PricingReconciliationService {
    constructor(
        private readonly storage: PricingReconciliationStorage,
        private readonly adapters: readonly ActualsAdapter[],
        private readonly materialDifferenceMicros: bigint,
        private readonly settlementLagDays: number,
        private readonly usageToleranceBps: bigint = 0n,
    ) {}

    async recordPrediction(value: unknown): Promise<{ idempotent: boolean }> {
        const prediction = this.requirePrediction(value)
        return await this.storage.putPrediction(prediction, canonicalHash(prediction))
    }

    async health(): Promise<{
        configuredRoutes: string[]
        watermarks: Array<{ providerRoute: string; providerAccountRef: string; day: string; observedAt: string }>
        openIncidents: ReconciliationIncident[]
    }> {
        const [watermarks, openIncidents] = await Promise.all([
            this.storage.getWatermarks(),
            this.storage.getOpenIncidents(),
        ])
        return {
            configuredRoutes: [...new Set(this.adapters.map(adapter => adapter.route))],
            watermarks,
            openIncidents,
        }
    }

    async prune(retentionMs: number): Promise<{ prunedCount: number }> {
        return await this.storage.pruneSettledRecords(retentionMs)
    }

    async reconcile(): Promise<void> {
        const oldestDay = new Date(Date.now() - this.settlementLagDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const predictions = await this.storage.getPredictionsSince(oldestDay)
        for (const adapter of this.adapters) {
            const days = new Set(predictions
                .filter(prediction => prediction.providerRoute === adapter.route && prediction.providerAccountRef === adapter.providerAccountRef)
                .map(prediction => prediction.day))
            for (const day of days) {
                const actuals = await adapter.fetchDay(day)
                await this.storage.replaceActuals(adapter.route, adapter.providerAccountRef, day, actuals)
                await this.reconcileCostDay(adapter.route, adapter.providerAccountRef, day)
                if (supportsUsageActuals(adapter)) {
                    const usageActuals = await adapter.fetchUsageDay(day)
                    await this.storage.replaceUsageActuals(adapter.route, adapter.providerAccountRef, day, usageActuals)
                    await this.reconcileUsageDay(adapter.route, adapter.providerAccountRef, day)
                }
            }
        }
    }

    private async reconcileCostDay(providerRoute: DailyPredictedProviderCost['providerRoute'], providerAccountRef: string, day: string): Promise<void> {
        const predictions = await this.storage.getPredictions(providerRoute, providerAccountRef, day)
        const actuals = await this.storage.getActuals(providerRoute, providerAccountRef, day)
        if (predictions.length === 0 || actuals.length === 0) return
        const predicted = predictions.reduce((total, value) => total + parseUsdMicros(value.predictedProviderCostUsd), 0n)
        const actual = actuals.reduce((total, value) => total + parseUsdMicros(value.actualProviderCostUsd), 0n)
        const difference = actual - predicted
        const material = (difference < 0n ? -difference : difference) >= this.materialDifferenceMicros
        const pricingKeys = [...new Set(predictions.flatMap(value => [
            ...(value.pricingKeys ?? []),
            ...(value.pricingKey ? [value.pricingKey] : []),
        ]))].sort()
        const incident: ReconciliationIncident = {
            incidentId: canonicalHash({ kind: 'cost', providerRoute, providerAccountRef, day }),
            kind: 'cost',
            providerRoute,
            providerAccountRef,
            day,
            pricingKeys,
            predictedProviderCostUsd: formatUsdMicros(predicted),
            actualProviderCostUsd: formatUsdMicros(actual),
            differenceUsd: formatUsdMicros(difference),
            material,
            status: material ? 'open' : 'resolved',
            createdAt: new Date().toISOString(),
            ...(material ? {} : { resolvedAt: new Date().toISOString() }),
        }
        await this.storage.putIncident(incident)
    }

    private async reconcileUsageDay(providerRoute: DailyPredictedProviderCost['providerRoute'], providerAccountRef: string, day: string): Promise<void> {
        const predictions = await this.storage.getPredictions(providerRoute, providerAccountRef, day)
        const actuals = await this.storage.getUsageActuals(providerRoute, providerAccountRef, day)
        if (predictions.length === 0 || actuals.length === 0) return
        const groups = this.aggregatePredictedUsage(predictions)
        for (const group of groups) {
            const matchingActuals = actuals.filter(actual => this.actualMatchesGroup(actual, group))
            if (matchingActuals.length === 0) continue
            for (const [dimension, predicted] of group.usage) {
                const actual = matchingActuals.reduce((total, value) => {
                    const quantity = value.usage[dimension]
                    return total + (quantity === undefined ? 0n : parseQuantity(quantity))
                }, 0n)
                const difference = actual - predicted
                const material = this.isMaterialUsageDifference(predicted, actual)
                const scope = {
                    kind: 'usage' as const,
                    providerRoute,
                    providerAccountRef,
                    day,
                    providerModel: group.providerModel,
                    usageKind: group.usageKind,
                    grouping: group.grouping,
                    usageDimension: dimension,
                }
                const now = new Date().toISOString()
                await this.storage.putIncident({
                    incidentId: canonicalHash(scope),
                    kind: 'usage',
                    providerRoute,
                    providerAccountRef,
                    day,
                    pricingKeys: [group.pricingKey],
                    providerModel: group.providerModel,
                    grouping: { usageKind: group.usageKind, ...group.grouping },
                    usageDimension: dimension,
                    predictedQuantity: String(predicted),
                    actualQuantity: String(actual),
                    quantityDifference: String(difference),
                    material,
                    status: material ? 'open' : 'resolved',
                    createdAt: now,
                    ...(material ? {} : { resolvedAt: now }),
                })
            }
        }
    }

    private aggregatePredictedUsage(predictions: DailyPredictedProviderCost[]): AggregatedPredictedUsage[] {
        const aggregated = new Map<string, AggregatedPredictedUsage>()
        for (const prediction of predictions) {
            for (const group of prediction.usageGroups ?? []) {
                const key = canonicalHash({
                    pricingKey: group.pricingKey,
                    providerModel: group.providerModel,
                    usageKind: group.usageKind,
                    grouping: group.grouping,
                })
                let target = aggregated.get(key)
                if (!target) {
                    target = {
                        pricingKey: group.pricingKey,
                        providerModel: group.providerModel,
                        usageKind: group.usageKind,
                        grouping: group.grouping,
                        usage: new Map<string, bigint>(),
                    }
                    aggregated.set(key, target)
                }
                for (const [dimension, quantity] of Object.entries(group.usage)) {
                    target.usage.set(dimension, (target.usage.get(dimension) ?? 0n) + parseQuantity(quantity))
                }
            }
        }
        return [...aggregated.values()]
    }

    private actualMatchesGroup(actual: ReconciliationActualUsage, predicted: AggregatedPredictedUsage): boolean {
        return actual.grouping.model === predicted.providerModel
            && actual.grouping.usageKind === predicted.usageKind
            && Object.entries(predicted.grouping).every(([key, value]) => actual.grouping[key] === value)
    }

    private isMaterialUsageDifference(predicted: bigint, actual: bigint): boolean {
        const difference = actual >= predicted ? actual - predicted : predicted - actual
        if (difference === 0n) return false
        if (this.usageToleranceBps === 0n) return true
        const scale = actual >= predicted ? actual : predicted
        return difference * 10_000n >= scale * this.usageToleranceBps
    }

    private requirePrediction(value: unknown): DailyPredictedProviderCost {
        if (!value || typeof value !== 'object') throw new Error('Predicted provider cost must be an object')
        const prediction = value as DailyPredictedProviderCost
        if (!prediction.providerRoute || !prediction.providerAccountRef?.trim() || !dayPattern.test(prediction.day)
            || !prediction.snapshotId?.trim() || !prediction.predictedProviderCostUsd?.trim() || !prediction.usage || typeof prediction.usage !== 'object') {
            throw new Error('Predicted provider cost has missing required fields')
        }
        parseUsdMicros(prediction.predictedProviderCostUsd)
        if (prediction.pricingKey !== undefined && !prediction.pricingKey.trim()) throw new Error('pricingKey must not be empty when provided')
        for (const [dimension, quantity] of Object.entries(prediction.usage)) {
            if (!dimension.trim()) throw new Error('usage dimensions must not be empty')
            parseQuantity(quantity)
        }
        const pricingKeys = [...new Set([
            ...(prediction.pricingKeys ?? []),
            ...(prediction.pricingKey ? [prediction.pricingKey] : []),
        ].map(pricingKey => pricingKey.trim()))].filter(Boolean).sort()
        if ((prediction.pricingKeys ?? []).some(pricingKey => !pricingKey.trim())) {
            throw new Error('pricingKeys must not contain an empty key')
        }
        const usageGroups = (prediction.usageGroups ?? []).map(group => this.requireUsageGroup(group))
            .sort((left, right) => canonicalHash(left).localeCompare(canonicalHash(right)))
        return {
            ...prediction,
            ...(pricingKeys.length > 0 && { pricingKeys }),
            ...(usageGroups.length > 0 && { usageGroups }),
        }
    }

    private requireUsageGroup(group: PredictedProviderUsageGroup): PredictedProviderUsageGroup {
        if (!group || typeof group !== 'object' || !group.pricingKey?.trim() || !group.providerModel?.trim()
            || !['completions', 'images', 'video'].includes(group.usageKind)
            || !group.grouping || typeof group.grouping !== 'object' || !group.usage || typeof group.usage !== 'object') {
            throw new Error('Predicted provider usage group has missing required fields')
        }
        for (const [key, value] of Object.entries(group.grouping)) {
            if (!key.trim() || !value.trim()) throw new Error('Predicted provider usage grouping must have non-empty keys and values')
        }
        for (const [dimension, value] of Object.entries(group.usage)) {
            if (!dimension.trim()) throw new Error('Predicted provider usage dimension must not be empty')
            parseQuantity(value)
        }
        return {
            pricingKey: group.pricingKey.trim(),
            providerModel: group.providerModel.trim(),
            usageKind: group.usageKind,
            grouping: Object.fromEntries(Object.entries(group.grouping).sort(([left], [right]) => left.localeCompare(right))),
            usage: Object.fromEntries(Object.entries(group.usage).sort(([left], [right]) => left.localeCompare(right))),
        }
    }
}
