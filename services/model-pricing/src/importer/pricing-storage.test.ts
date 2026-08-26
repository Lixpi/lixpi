import { describe, it, expect } from 'vitest'
import type DynamoDBServiceClass from '@lixpi/dynamodb-service'
import type { ModelPriceRecord, PricingSnapshotManifest } from '@lixpi/constants'

import { PricingStorage, type PricingStorageTables } from './pricing-storage.ts'
import { canonicalHash } from './canonical-json.ts'

type StoredItem = Record<string, unknown>

type TransactOperation = {
    type: string
    tableName: string
    item: StoredItem
    conditionExpression?: string
    expressionAttributeValues?: Record<string, unknown>
}

// FakeDynamoDBService is a minimal in-memory stand-in for @lixpi/dynamodb-service,
// covering only the operations activateSnapshot's code path actually issues
// (getItem/queryItems/transactWrite). PricingStorage's constructor is typed by the
// real DynamoDBService class, which has private instance fields, so TypeScript
// treats it nominally — the fake is substituted via an explicit cast, same as this
// codebase's other DynamoDB-backed collaborators under test.
class FakeDynamoDBService {
    private readonly tables = new Map<string, StoredItem[]>()

    seed(tableName: string, item: StoredItem): void {
        const items = this.tables.get(tableName) ?? []
        items.push(item)
        this.tables.set(tableName, items)
    }

    async getItem({ tableName, key }: { tableName: string, key: Record<string, unknown> }): Promise<StoredItem | undefined> {
        return (this.tables.get(tableName) ?? []).find(item => matchesKey(item, key))
    }

    async queryItems({ tableName, keyConditions }: { tableName: string, keyConditions: Record<string, unknown> }): Promise<{ items: StoredItem[] }> {
        return { items: (this.tables.get(tableName) ?? []).filter(item => matchesKey(item, keyConditions)) }
    }

    async transactWrite({ operations }: { operations: TransactOperation[] }): Promise<void> {
        for (const op of operations) this.checkCondition(op)
        for (const op of operations) this.seed(op.tableName, op.item)
    }

    private checkCondition(op: TransactOperation): void {
        if (!op.conditionExpression) return
        const existing = (this.tables.get(op.tableName) ?? [])
            .find(item => item.recordKey === op.item.recordKey && item.sortKey === op.item.sortKey)
        if (op.conditionExpression === 'attribute_not_exists(#snapshotId)' || op.conditionExpression === 'attribute_not_exists(#recordKey)') {
            if (existing) throw new Error('ConditionalCheckFailedException')
            return
        }
        if (op.conditionExpression === '#snapshotId = :expectedSnapshotId') {
            const expected = op.expressionAttributeValues?.[':expectedSnapshotId']
            if (existing?.snapshotId !== expected) throw new Error('ConditionalCheckFailedException')
        }
    }
}

const matchesKey = (item: StoredItem, key: Record<string, unknown>): boolean =>
    Object.entries(key).every(([field, value]) => item[field] === value)

const asDynamo = (fake: FakeDynamoDBService): DynamoDBServiceClass => fake as unknown as DynamoDBServiceClass

const tables: PricingStorageTables = { snapshots: 'SNAPSHOTS', records: 'RECORDS', audit: 'AUDIT', reconciliation: 'RECONCILIATION' }

const record = (snapshotId: string, pricingKey: string, candidateHash: string): ModelPriceRecord => ({
    snapshotId,
    pricingKey,
    catalogProvider: 'OpenAI',
    catalogModel: 'gpt-5',
    vendorModel: 'gpt-5',
    providerRoute: 'openai-api',
    pricingRegion: 'global',
    currency: 'USD',
    variants: [],
    verification: { status: 'verified', candidateHash, verifiedAt: '2026-08-20T00:00:00.000Z' },
    effectiveFrom: '2026-08-20T00:00:00.000Z',
    createdAt: '2026-08-20T00:00:00.000Z',
})

// createRecordsContentHash is private on PricingStorage; the fixture builder
// mirrors its exact projection (drop snapshotId/createdAt, keep only
// verification.status/candidateHash, sort ordinally by pricingKey) so
// buildManifest's hash matches what activateSnapshot recomputes and verifies.
const manifestHashFor = (records: ModelPriceRecord[]): string =>
    canonicalHash(records
        .map(({ snapshotId: _snapshotId, createdAt: _createdAt, verification, ...rest }) => ({
            ...rest,
            verification: { status: verification.status, candidateHash: verification.candidateHash },
        }))
        .sort((left, right) => left.pricingKey < right.pricingKey ? -1 : left.pricingKey > right.pricingKey ? 1 : 0))

const seedSnapshot = (fake: FakeDynamoDBService, snapshotId: string, records: ModelPriceRecord[]): void => {
    for (const item of records) fake.seed(tables.records, item as unknown as StoredItem)
    const manifest: PricingSnapshotManifest = {
        recordKey: 'SNAPSHOT',
        sortKey: snapshotId,
        snapshotId,
        sourceRevision: 'rev',
        normalizedContentHash: `norm-${snapshotId}`,
        recordsContentHash: manifestHashFor(records),
        recordCount: records.length,
        status: 'complete',
        createdAt: '2026-08-20T00:00:00.000Z',
    }
    fake.seed(tables.snapshots, manifest as unknown as StoredItem)
}

const seedActivePointer = (fake: FakeDynamoDBService, snapshotId: string): void => {
    fake.seed(tables.snapshots, { recordKey: 'ACTIVE', sortKey: 'POINTER', snapshotId, normalizedContentHash: `norm-${snapshotId}`, activatedAt: '2026-08-20T00:00:00.000Z' })
}

const seedIncident = (fake: FakeDynamoDBService, overrides: Partial<{ providerRoute: string, pricingKeys: string[], material: boolean, status: string }>): void => {
    fake.seed(tables.reconciliation, {
        recordKey: 'INCIDENT',
        sortKey: `incident-${Math.random()}`,
        providerRoute: 'openai-api',
        pricingKeys: ['OpenAI:gpt-5:openai-api:global'],
        material: true,
        status: 'open',
        ...overrides,
    })
}

// =============================================================================
// activateSnapshot — reconciliation-gated activation (the phase 8 mechanism)
// =============================================================================

describe('PricingStorage.activateSnapshot — reconciliation blocking', () => {
    it('blocks activation when a changed pricing key has an open, material reconciliation incident', async () => {
        const fake = new FakeDynamoDBService()
        const oldRecord = record('snap-old', 'OpenAI:gpt-5:openai-api:global', 'hash-old')
        const newRecord = record('snap-new', 'OpenAI:gpt-5:openai-api:global', 'hash-new')
        seedSnapshot(fake, 'snap-old', [oldRecord])
        seedActivePointer(fake, 'snap-old')
        seedSnapshot(fake, 'snap-new', [newRecord])
        seedIncident(fake, {}) // open, material, targets the changed key

        const storage = new PricingStorage(asDynamo(fake), tables)
        await expect(storage.activateSnapshot('snap-new')).rejects.toThrow(/blocked by an unresolved material reconciliation incident/)

        // The blocked attempt must never have mutated the active pointer.
        const active = await storage.getActivePointer()
        expect(active?.snapshotId).toBe('snap-old')
    })

    it('activates normally when a pricing key changed but the open material incident names a different key', async () => {
        const fake = new FakeDynamoDBService()
        const oldRecord = record('snap-old', 'OpenAI:gpt-5:openai-api:global', 'hash-old')
        const newRecord = record('snap-new', 'OpenAI:gpt-5:openai-api:global', 'hash-new') // changed candidateHash
        seedSnapshot(fake, 'snap-old', [oldRecord])
        seedActivePointer(fake, 'snap-old')
        seedSnapshot(fake, 'snap-new', [newRecord])
        seedIncident(fake, { pricingKeys: ['Anthropic:claude-haiku-4-5:anthropic-api:global'] })

        const storage = new PricingStorage(asDynamo(fake), tables)
        const result = await storage.activateSnapshot('snap-new')
        expect(result.activated).toBe(true)
    })

    it('activates normally when no pricing key actually changed, even with an open material incident present', async () => {
        const fake = new FakeDynamoDBService()
        const oldRecord = record('snap-old', 'OpenAI:gpt-5:openai-api:global', 'hash-same')
        const newRecord = record('snap-new', 'OpenAI:gpt-5:openai-api:global', 'hash-same')
        seedSnapshot(fake, 'snap-old', [oldRecord])
        seedActivePointer(fake, 'snap-old')
        seedSnapshot(fake, 'snap-new', [newRecord])
        seedIncident(fake, {})

        const storage = new PricingStorage(asDynamo(fake), tables)
        const result = await storage.activateSnapshot('snap-new')
        expect(result.activated).toBe(true)
    })

    it('activates normally when the matching incident is not material', async () => {
        const fake = new FakeDynamoDBService()
        seedSnapshot(fake, 'snap-old', [record('snap-old', 'OpenAI:gpt-5:openai-api:global', 'hash-old')])
        seedActivePointer(fake, 'snap-old')
        seedSnapshot(fake, 'snap-new', [record('snap-new', 'OpenAI:gpt-5:openai-api:global', 'hash-new')])
        seedIncident(fake, { material: false })

        const storage = new PricingStorage(asDynamo(fake), tables)
        const result = await storage.activateSnapshot('snap-new')
        expect(result.activated).toBe(true)
    })

    it('activates normally when the matching incident is resolved, not open', async () => {
        const fake = new FakeDynamoDBService()
        seedSnapshot(fake, 'snap-old', [record('snap-old', 'OpenAI:gpt-5:openai-api:global', 'hash-old')])
        seedActivePointer(fake, 'snap-old')
        seedSnapshot(fake, 'snap-new', [record('snap-new', 'OpenAI:gpt-5:openai-api:global', 'hash-new')])
        seedIncident(fake, { status: 'resolved' })

        const storage = new PricingStorage(asDynamo(fake), tables)
        const result = await storage.activateSnapshot('snap-new')
        expect(result.activated).toBe(true)
    })

    it('activates normally with no reconciliation incidents at all', async () => {
        const fake = new FakeDynamoDBService()
        seedSnapshot(fake, 'snap-new', [record('snap-new', 'OpenAI:gpt-5:openai-api:global', 'hash-new')])

        const storage = new PricingStorage(asDynamo(fake), tables)
        const result = await storage.activateSnapshot('snap-new')
        expect(result.activated).toBe(true)
    })

    it('does not consult reconciliation at all when the reconciliation table is not configured', async () => {
        const fake = new FakeDynamoDBService()
        const oldRecord = record('snap-old', 'OpenAI:gpt-5:openai-api:global', 'hash-old')
        const newRecord = record('snap-new', 'OpenAI:gpt-5:openai-api:global', 'hash-new')
        seedSnapshot(fake, 'snap-old', [oldRecord])
        seedActivePointer(fake, 'snap-old')
        seedSnapshot(fake, 'snap-new', [newRecord])
        seedIncident(fake, {}) // would otherwise block

        const storage = new PricingStorage(asDynamo(fake), { snapshots: 'SNAPSHOTS', records: 'RECORDS', audit: 'AUDIT' })
        const result = await storage.activateSnapshot('snap-new')
        expect(result.activated).toBe(true)
    })

    it('re-activating the already-active snapshot is a no-op even with a blocking incident present', async () => {
        const fake = new FakeDynamoDBService()
        const activeRecord = record('snap-a', 'OpenAI:gpt-5:openai-api:global', 'hash-a')
        seedSnapshot(fake, 'snap-a', [activeRecord])
        seedActivePointer(fake, 'snap-a')
        seedIncident(fake, {})

        const storage = new PricingStorage(asDynamo(fake), tables)
        const result = await storage.activateSnapshot('snap-a')
        expect(result.activated).toBe(false)
    })
})
