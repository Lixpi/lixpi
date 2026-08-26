import { describe, it, expect } from 'vitest'
import type {
    DailyPredictedProviderCost,
    ReconciliationActualCost,
    ReconciliationIncident,
} from '@lixpi/constants'

import { PricingReconciliationService } from './reconciliation-service.ts'
import type { PricingReconciliationStorage } from './reconciliation-storage.ts'
import type { ActualsAdapter, StoredPrediction } from './types.ts'

// FakeReconciliationStorage mirrors PricingReconciliationStorage's public query
// surface with a plain in-memory model. PricingReconciliationStorage has private
// constructor fields (a real DynamoDBService + table name), so TypeScript treats
// it nominally — a structurally matching fake can only be substituted via an
// explicit cast, same as this codebase's other DynamoDB-backed collaborators.
class FakeReconciliationStorage {
    predictions: StoredPrediction[] = []
    actuals = new Map<string, ReconciliationActualCost[]>()
    incidents: ReconciliationIncident[] = []
    putPredictionCalls: Array<{ prediction: DailyPredictedProviderCost, payloadHash: string }> = []
    replaceActualsCalls = 0

    async putPrediction(prediction: DailyPredictedProviderCost, payloadHash: string) {
        this.putPredictionCalls.push({ prediction, payloadHash })
        this.predictions.push({ ...prediction, recordKey: '', sortKey: '', payloadHash, receivedAt: new Date().toISOString() })
        return { idempotent: false }
    }

    async getPredictionsSince(day: string) {
        return this.predictions.filter(prediction => prediction.day >= day)
    }

    async getPredictions(providerRoute: string, providerAccountRef: string, day: string) {
        return this.predictions.filter(prediction =>
            prediction.providerRoute === providerRoute && prediction.providerAccountRef === providerAccountRef && prediction.day === day)
    }

    async replaceActuals(providerRoute: string, providerAccountRef: string, day: string, actuals: ReconciliationActualCost[]) {
        this.replaceActualsCalls++
        this.actuals.set(`${providerRoute}|${providerAccountRef}|${day}`, actuals)
    }

    async getActuals(providerRoute: string, providerAccountRef: string, day: string) {
        return this.actuals.get(`${providerRoute}|${providerAccountRef}|${day}`) ?? []
    }

    async getWatermarks() {
        return []
    }

    async getOpenIncidents() {
        return this.incidents.filter(incident => incident.status === 'open')
    }

    async pruneSettledRecords(_retentionMs: number) {
        return { prunedCount: 0 }
    }

    async putIncident(incident: ReconciliationIncident) {
        this.incidents = this.incidents.filter(existing => !(existing.providerRoute === incident.providerRoute
            && existing.providerAccountRef === incident.providerAccountRef && existing.day === incident.day && existing.status === 'open'))
        this.incidents.push(incident)
    }
}

const asStorage = (fake: FakeReconciliationStorage): PricingReconciliationStorage => fake as unknown as PricingReconciliationStorage

class FakeAdapter implements ActualsAdapter {
    readonly route
    readonly providerAccountRef
    private readonly byDay: Map<string, ReconciliationActualCost[]>
    calls: string[] = []

    constructor(route: ActualsAdapter['route'], providerAccountRef: string, byDay: Record<string, ReconciliationActualCost[]>) {
        this.route = route
        this.providerAccountRef = providerAccountRef
        this.byDay = new Map(Object.entries(byDay))
    }

    async fetchDay(day: string): Promise<ReconciliationActualCost[]> {
        this.calls.push(day)
        return this.byDay.get(day) ?? []
    }

    setDay(day: string, actuals: ReconciliationActualCost[]): void {
        this.byDay.set(day, actuals)
    }
}

const dollars = (amount: number, unit = 1_000_000): bigint => BigInt(Math.round(amount * unit))

const prediction = (overrides: Partial<DailyPredictedProviderCost> = {}): DailyPredictedProviderCost => ({
    providerRoute: 'openai-api',
    providerAccountRef: 'lixpi-prod',
    day: '2026-08-20',
    snapshotId: 'snap-a',
    predictedProviderCostUsd: '100',
    usage: { operations: '5' },
    ...overrides,
})

const actual = (amountUsd: string, overrides: Partial<ReconciliationActualCost> = {}): ReconciliationActualCost => ({
    providerRoute: 'openai-api',
    providerAccountRef: 'lixpi-prod',
    day: '2026-08-20',
    grouping: { projectId: 'proj_a' },
    actualProviderCostUsd: amountUsd,
    sourceId: 'openai:organization-costs',
    sourceHash: `hash-${amountUsd}`,
    observedAt: new Date().toISOString(),
    ...overrides,
})

// =============================================================================
// recordPrediction — validation and delegation
// =============================================================================

describe('PricingReconciliationService.recordPrediction', () => {
    it('rejects a non-object payload', async () => {
        const storage = new FakeReconciliationStorage()
        const service = new PricingReconciliationService(asStorage(storage), [], dollars(1), 14)
        await expect(service.recordPrediction(null)).rejects.toThrow(/must be an object/)
    })

    it('rejects a payload missing required fields', async () => {
        const storage = new FakeReconciliationStorage()
        const service = new PricingReconciliationService(asStorage(storage), [], dollars(1), 14)
        await expect(service.recordPrediction({ providerRoute: 'openai-api' })).rejects.toThrow(/missing required fields/)
    })

    it('rejects a malformed day', async () => {
        const storage = new FakeReconciliationStorage()
        const service = new PricingReconciliationService(asStorage(storage), [], dollars(1), 14)
        await expect(service.recordPrediction(prediction({ day: '08/20/2026' }))).rejects.toThrow(/missing required fields/)
    })

    it('rejects an unparseable predictedProviderCostUsd', async () => {
        const storage = new FakeReconciliationStorage()
        const service = new PricingReconciliationService(asStorage(storage), [], dollars(1), 14)
        await expect(service.recordPrediction(prediction({ predictedProviderCostUsd: '$1.00' }))).rejects.toThrow()
    })

    it('rejects an explicitly empty pricingKey (must be omitted, not blank)', async () => {
        const storage = new FakeReconciliationStorage()
        const service = new PricingReconciliationService(asStorage(storage), [], dollars(1), 14)
        await expect(service.recordPrediction(prediction({ pricingKey: '  ' }))).rejects.toThrow(/pricingKey must not be empty/)
    })

    it('delegates a valid prediction to storage with its canonical content hash', async () => {
        const storage = new FakeReconciliationStorage()
        const service = new PricingReconciliationService(asStorage(storage), [], dollars(1), 14)
        const result = await service.recordPrediction(prediction())
        expect(result).toEqual({ idempotent: false })
        expect(storage.putPredictionCalls).toHaveLength(1)
        expect(storage.putPredictionCalls[0].prediction.providerRoute).toBe('openai-api')
        expect(storage.putPredictionCalls[0].payloadHash).toBeTruthy()
    })
})

// =============================================================================
// reconcile — settlement lag window
// =============================================================================

describe('PricingReconciliationService.reconcile — settlement lag window', () => {
    it('only fetches actuals for days within the settlement lag window', async () => {
        const storage = new FakeReconciliationStorage()
        const today = new Date()
        const recentDay = today.toISOString().slice(0, 10)
        const ancientDay = new Date(today.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        storage.predictions.push(
            { ...prediction({ day: recentDay }), recordKey: '', sortKey: '', payloadHash: 'h1', receivedAt: '' },
            { ...prediction({ day: ancientDay }), recordKey: '', sortKey: '', payloadHash: 'h2', receivedAt: '' },
        )
        const adapter = new FakeAdapter('openai-api', 'lixpi-prod', {})
        const service = new PricingReconciliationService(asStorage(storage), [adapter], dollars(1), 14)

        await service.reconcile()

        expect(adapter.calls).toContain(recentDay)
        expect(adapter.calls).not.toContain(ancientDay)
    })

    it('does nothing for a route with no adapter configured', async () => {
        const storage = new FakeReconciliationStorage()
        storage.predictions.push({ ...prediction({ providerRoute: 'anthropic-api' }), recordKey: '', sortKey: '', payloadHash: 'h1', receivedAt: '' })
        const service = new PricingReconciliationService(asStorage(storage), [], dollars(1), 14)
        await service.reconcile()
        expect(storage.replaceActualsCalls).toBe(0)
    })
})

// =============================================================================
// reconcile — materiality and incidents
// =============================================================================

describe('PricingReconciliationService.reconcile — materiality and incidents', () => {
    it('creates an open material incident when predicted and actual diverge beyond the threshold', async () => {
        const storage = new FakeReconciliationStorage()
        storage.predictions.push({ ...prediction({ predictedProviderCostUsd: '100' }), recordKey: '', sortKey: '', payloadHash: 'h1', receivedAt: '' })
        const adapter = new FakeAdapter('openai-api', 'lixpi-prod', { '2026-08-20': [actual('150')] })
        const service = new PricingReconciliationService(asStorage(storage), [adapter], dollars(1), 14)

        await service.reconcile()

        expect(storage.incidents).toHaveLength(1)
        expect(storage.incidents[0].status).toBe('open')
        expect(storage.incidents[0].material).toBe(true)
        expect(storage.incidents[0].predictedProviderCostUsd).toBe('100')
        expect(storage.incidents[0].actualProviderCostUsd).toBe('150')
        expect(storage.incidents[0].differenceUsd).toBe('50')
    })

    it('records an incident as resolved (not open) when divergence is within the material threshold', async () => {
        const storage = new FakeReconciliationStorage()
        storage.predictions.push({ ...prediction({ predictedProviderCostUsd: '100' }), recordKey: '', sortKey: '', payloadHash: 'h1', receivedAt: '' })
        const adapter = new FakeAdapter('openai-api', 'lixpi-prod', { '2026-08-20': [actual('100.50')] })
        const service = new PricingReconciliationService(asStorage(storage), [adapter], dollars(1), 14)

        await service.reconcile()

        expect(storage.incidents).toHaveLength(1)
        expect(storage.incidents[0].status).toBe('resolved')
        expect(storage.incidents[0].material).toBe(false)
        expect(storage.incidents[0].resolvedAt).toBeTruthy()
    })

    it('does nothing when there are no actuals yet for a predicted day', async () => {
        const storage = new FakeReconciliationStorage()
        storage.predictions.push({ ...prediction(), recordKey: '', sortKey: '', payloadHash: 'h1', receivedAt: '' })
        const adapter = new FakeAdapter('openai-api', 'lixpi-prod', { '2026-08-20': [] })
        const service = new PricingReconciliationService(asStorage(storage), [adapter], dollars(1), 14)

        await service.reconcile()
        expect(storage.incidents).toHaveLength(0)
    })

    it('sums multiple predictions and multiple actuals for the same day before comparing', async () => {
        const storage = new FakeReconciliationStorage()
        storage.predictions.push(
            { ...prediction({ predictedProviderCostUsd: '60', snapshotId: 'snap-a' }), recordKey: '', sortKey: '', payloadHash: 'h1', receivedAt: '' },
            { ...prediction({ predictedProviderCostUsd: '40', snapshotId: 'snap-b' }), recordKey: '', sortKey: '', payloadHash: 'h2', receivedAt: '' },
        )
        const adapter = new FakeAdapter('openai-api', 'lixpi-prod', {
            '2026-08-20': [actual('50', { sourceHash: 'a' }), actual('50', { sourceHash: 'b' })],
        })
        const service = new PricingReconciliationService(asStorage(storage), [adapter], dollars(1), 14)

        await service.reconcile()
        expect(storage.incidents[0].predictedProviderCostUsd).toBe('100')
        expect(storage.incidents[0].actualProviderCostUsd).toBe('100')
        expect(storage.incidents[0].material).toBe(false)
    })

    it('lists distinct pricing keys sorted, dropping predictions with no pricingKey', async () => {
        const storage = new FakeReconciliationStorage()
        storage.predictions.push(
            { ...prediction({ pricingKey: 'OpenAI:gpt-5:openai-api:global' }), recordKey: '', sortKey: '', payloadHash: 'h1', receivedAt: '' },
            { ...prediction({ pricingKey: 'OpenAI:gpt-image-1:openai-api:global' }), recordKey: '', sortKey: '', payloadHash: 'h2', receivedAt: '' },
            { ...prediction({}), recordKey: '', sortKey: '', payloadHash: 'h3', receivedAt: '' }, // no pricingKey
        )
        const adapter = new FakeAdapter('openai-api', 'lixpi-prod', { '2026-08-20': [actual('300')] })
        const service = new PricingReconciliationService(asStorage(storage), [adapter], dollars(1), 14)

        await service.reconcile()
        expect(storage.incidents[0].pricingKeys).toEqual(['OpenAI:gpt-5:openai-api:global', 'OpenAI:gpt-image-1:openai-api:global'])
    })
})

// =============================================================================
// reconcile — late-arriving costs (revisit and overwrite)
// =============================================================================

describe('PricingReconciliationService.reconcile — late-arriving costs', () => {
    it('overwrites the prior actuals and re-evaluates against the revised total on a later run', async () => {
        const storage = new FakeReconciliationStorage()
        storage.predictions.push({ ...prediction({ predictedProviderCostUsd: '100' }), recordKey: '', sortKey: '', payloadHash: 'h1', receivedAt: '' })
        const adapter = new FakeAdapter('openai-api', 'lixpi-prod', { '2026-08-20': [actual('100')] })
        const service = new PricingReconciliationService(asStorage(storage), [adapter], dollars(1), 14)

        await service.reconcile()
        expect(storage.incidents).toHaveLength(1)
        expect(storage.incidents[0].status).toBe('resolved')

        // A late-arriving provider cost adjustment raises the actual total on a
        // later scheduled reconcile pass for the same, still-in-window day.
        adapter.setDay('2026-08-20', [actual('160')])
        await service.reconcile()

        expect(storage.replaceActualsCalls).toBe(2)
        // putIncident only replaces a same-scope PREVIOUSLY OPEN incident; the
        // first pass's incident was resolved, so it stays as an audit row (later
        // swept up by pruneSettledRecords) and the second pass adds its own —
        // getOpenIncidents is what activation-blocking and status actually read.
        expect(storage.incidents).toHaveLength(2)
        const open = await storage.getOpenIncidents()
        expect(open).toHaveLength(1)
        expect(open[0].actualProviderCostUsd).toBe('160')
        expect(open[0].material).toBe(true)
    })

    it('replaces (not duplicates) a still-open incident when a further-revised total keeps it open', async () => {
        const storage = new FakeReconciliationStorage()
        storage.predictions.push({ ...prediction({ predictedProviderCostUsd: '100' }), recordKey: '', sortKey: '', payloadHash: 'h1', receivedAt: '' })
        const adapter = new FakeAdapter('openai-api', 'lixpi-prod', { '2026-08-20': [actual('160')] })
        const service = new PricingReconciliationService(asStorage(storage), [adapter], dollars(1), 14)

        await service.reconcile()
        expect(storage.incidents).toHaveLength(1)
        expect(storage.incidents[0].status).toBe('open')

        adapter.setDay('2026-08-20', [actual('200')])
        await service.reconcile()

        expect(storage.incidents, 'a second still-open incident for the same scope must replace, not duplicate, the first').toHaveLength(1)
        expect(storage.incidents[0].actualProviderCostUsd).toBe('200')
    })
})
