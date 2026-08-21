'use strict'

import DynamoDBService from '@lixpi/dynamodb-service'
import type {
    ActivePricingPointer,
    ModelPriceRecord,
    PricingActivationEvent,
    PricingOverrideCommand,
    PricingSnapshotManifest,
    PricingTableResponse,
} from '@lixpi/constants'
import { canonicalHash } from './canonical-json.ts'
import type { CandidateHold } from './types.ts'

export type ApprovedOverride = {
    eventId: string
    actorKeyId: string
    patch: NonNullable<PricingOverrideCommand['patch']>
}

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
        }) as PricingSnapshotManifest | undefined
        if (existing) {
            if (existing.sourceRevision !== sourceRevision
                || existing.normalizedContentHash !== normalizedContentHash
                || existing.recordsContentHash !== this.createRecordsContentHash(records)
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
                items: holds.flatMap(hold => [
                    {
                        recordKey: `HOLD#${hold.pricingKey}`,
                        sortKey: 'CURRENT',
                        ...hold,
                    },
                    {
                        recordKey: 'HOLD',
                        sortKey: hold.pricingKey,
                        ...hold,
                    },
                ]),
                origin: 'model-pricing.stage-hold',
            })
        }

        const heldPricingKeys = new Set(holds.map(hold => hold.pricingKey))
        const resolvedPricingKeys = records
            .map(record => record.pricingKey)
            .filter(pricingKey => !heldPricingKeys.has(pricingKey))
        if (resolvedPricingKeys.length > 0) {
            await this.batchWriteOrThrow({
                tableName: this.tables.snapshots,
                items: resolvedPricingKeys.flatMap(pricingKey => [
                    {
                        recordKey: `HOLD#${pricingKey}`,
                        sortKey: 'CURRENT',
                        pricingKey,
                        resolvedAt: createdAt,
                    },
                    {
                        recordKey: 'HOLD',
                        sortKey: pricingKey,
                        pricingKey,
                        resolvedAt: createdAt,
                    },
                ]),
                origin: 'model-pricing.resolve-hold',
            })
        }

        const manifest: PricingSnapshotManifest = {
            recordKey: 'SNAPSHOT',
            sortKey: snapshotId,
            snapshotId,
            sourceRevision,
            normalizedContentHash,
            recordsContentHash: this.createRecordsContentHash(records),
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

    async getActivePointer(): Promise<ActivePricingPointer | undefined> {
        return await this.dynamo.getItem({
            tableName: this.tables.snapshots,
            key: { recordKey: 'ACTIVE', sortKey: 'POINTER' },
            consistentRead: true,
            origin: 'model-pricing.active-pointer',
            throwOnError: true,
        }) as ActivePricingPointer | undefined
    }

    async getSnapshotManifest(snapshotId: string): Promise<PricingSnapshotManifest | undefined> {
        return await this.dynamo.getItem({
            tableName: this.tables.snapshots,
            key: { recordKey: 'SNAPSHOT', sortKey: snapshotId },
            consistentRead: true,
            origin: 'model-pricing.snapshot-manifest',
            throwOnError: true,
        }) as PricingSnapshotManifest | undefined
    }

    async getSnapshotRecords(snapshotId: string): Promise<ModelPriceRecord[]> {
        const response = await this.dynamo.queryItems({
            tableName: this.tables.records,
            keyConditions: { snapshotId },
            fetchAllItems: true,
            consistentRead: true,
            origin: 'model-pricing.snapshot-records',
        })
        return (response?.items ?? []) as ModelPriceRecord[]
    }

    async getActiveTable(): Promise<PricingTableResponse | undefined> {
        const pointer = await this.getActivePointer()
        if (!pointer) return undefined

        const manifest = await this.getSnapshotManifest(pointer.snapshotId)
        if (!manifest || manifest.status !== 'complete' || manifest.normalizedContentHash !== pointer.normalizedContentHash) {
            throw new Error(`Active pricing pointer ${pointer.snapshotId} does not reference its complete manifest`)
        }

        const records = await this.getSnapshotRecords(pointer.snapshotId)
        this.assertSnapshotRecords(manifest, records)
        return { manifest, records: records.sort((left, right) => left.pricingKey.localeCompare(right.pricingKey)) }
    }

    async getCurrentHold(pricingKey: string): Promise<CandidateHold | undefined> {
        return await this.dynamo.getItem({
            tableName: this.tables.snapshots,
            key: { recordKey: `HOLD#${pricingKey}`, sortKey: 'CURRENT' },
            consistentRead: true,
            origin: 'model-pricing.current-hold',
            throwOnError: true,
        }) as CandidateHold | undefined
    }

    async getCurrentHolds(): Promise<CandidateHold[]> {
        const response = await this.dynamo.queryItems({
            tableName: this.tables.snapshots,
            keyConditions: { recordKey: 'HOLD' },
            fetchAllItems: true,
            consistentRead: true,
            origin: 'model-pricing.current-holds',
        })
        return ((response?.items ?? []) as CandidateHold[]).filter(hold => typeof hold.candidateHash === 'string')
    }

    async getApprovedOverride(pricingKey: string, candidateHash: string): Promise<ApprovedOverride | undefined> {
        const response = await this.dynamo.queryItems({
            tableName: this.tables.audit,
            keyConditions: { recordKey: `OVERRIDE#${pricingKey}` },
            fetchAllItems: true,
            consistentRead: true,
            origin: 'model-pricing.approved-override',
        })
        const events = (response?.items ?? []) as Array<{
            action?: string
            candidateHash?: string
            patch?: ApprovedOverride['patch']
            actorKeyId?: string
            sortKey?: string
            proposalEventId?: string
        }>
        // A decision is resolved against the exact proposal event it references
        // (proposalEventId), never merely against "the latest proposal sharing
        // this candidate hash" - otherwise a later, never-approved proposal for
        // the same still-held hash could silently inherit an earlier approval.
        const proposalsById = new Map(
            events.filter(event => event.action === 'propose' && event.sortKey).map(event => [event.sortKey!, event]),
        )
        const latestDecisionByProposal = new Map<string, typeof events[number]>()
        for (const event of events) {
            if ((event.action !== 'approve' && event.action !== 'reject') || !event.proposalEventId || !event.sortKey) continue
            const current = latestDecisionByProposal.get(event.proposalEventId)
            if (!current || event.sortKey.localeCompare(current.sortKey!) > 0) {
                latestDecisionByProposal.set(event.proposalEventId, event)
            }
        }
        const approvedDecisions = [...latestDecisionByProposal.values()]
            .filter(decision => decision.action === 'approve')
            .map(decision => ({ decision, proposal: proposalsById.get(decision.proposalEventId!) }))
            .filter((entry): entry is { decision: typeof events[number]; proposal: typeof events[number] } =>
                entry.proposal?.candidateHash === candidateHash && !!entry.proposal.patch)
            .sort((left, right) => left.decision.sortKey!.localeCompare(right.decision.sortKey!))
        const latest = approvedDecisions.at(-1)
        if (!latest?.decision.actorKeyId || !latest.decision.sortKey || !latest.proposal.patch) return undefined
        return { eventId: latest.decision.sortKey, actorKeyId: latest.decision.actorKeyId, patch: latest.proposal.patch }
    }

    async activateSnapshot(snapshotId: string): Promise<{
        activated: boolean
        snapshotId: string
        previousSnapshotId?: string
        normalizedContentHash: string
        activatedAt?: string
    }> {
        const manifest = await this.getSnapshotManifest(snapshotId)
        if (!manifest || manifest.status !== 'complete') {
            throw new Error(`Pricing snapshot ${snapshotId} is not a complete staged manifest`)
        }

        const records = await this.getSnapshotRecords(snapshotId)
        this.assertSnapshotRecords(manifest, records)
        const active = await this.getActivePointer()
        if (active?.snapshotId === snapshotId) {
            return {
                activated: false,
                snapshotId,
                previousSnapshotId: active.snapshotId,
                normalizedContentHash: active.normalizedContentHash,
            }
        }

        const activatedAt = new Date().toISOString()
        const pointer: ActivePricingPointer = {
            recordKey: 'ACTIVE',
            sortKey: 'POINTER',
            snapshotId,
            normalizedContentHash: manifest.normalizedContentHash,
            activatedAt,
        }
        const activation: PricingActivationEvent = {
            recordKey: 'ACTIVATION',
            sortKey: `${activatedAt}#${snapshotId}`,
            snapshotId,
            ...(active && { previousSnapshotId: active.snapshotId }),
            normalizedContentHash: manifest.normalizedContentHash,
            activatedAt,
        }

        await this.dynamo.transactWrite({
            operations: [
                {
                    type: 'put',
                    tableName: this.tables.snapshots,
                    item: pointer,
                    conditionExpression: active ? '#snapshotId = :expectedSnapshotId' : 'attribute_not_exists(#snapshotId)',
                    expressionAttributeNames: { '#snapshotId': 'snapshotId' },
                    expressionAttributeValues: active ? { ':expectedSnapshotId': active.snapshotId } : undefined,
                },
                {
                    type: 'put',
                    tableName: this.tables.snapshots,
                    item: activation,
                    conditionExpression: 'attribute_not_exists(#recordKey)',
                    expressionAttributeNames: { '#recordKey': 'recordKey' },
                },
            ],
            logConditionalCheckFailures: false,
            origin: 'model-pricing.activate-snapshot',
        })

        return {
            activated: true,
            snapshotId,
            ...(active && { previousSnapshotId: active.snapshotId }),
            normalizedContentHash: manifest.normalizedContentHash,
            activatedAt,
        }
    }

    // Deletes complete, superseded snapshots once they are older than
    // `retentionMs` and outside the `retainedActivations` most recent
    // activation events. Never touches the current ACTIVE snapshot. This
    // cannot see whether a billing operation still references an older
    // snapshot (that state lives in a separate repository/service), so the
    // retention window and retained-activation count are the only guard - keep
    // both comfortably longer than any in-flight billing operation lifetime.
    // Does not detect snapshots orphaned by a crash mid-import (records/holds
    // written, manifest never committed): those never appear in the `SNAPSHOT`
    // partition scanned here and are a known, separately-scoped gap.
    async pruneAbandonedSnapshots({
        retentionMs,
        retainedActivations = 5,
    }: {
        retentionMs: number
        retainedActivations?: number
    }): Promise<{ prunedSnapshotIds: string[] }> {
        const active = await this.getActivePointer()
        const activationsResponse = await this.dynamo.queryItems({
            tableName: this.tables.snapshots,
            keyConditions: { recordKey: 'ACTIVATION' },
            fetchAllItems: true,
            consistentRead: true,
            origin: 'model-pricing.prune-activations',
        })
        const activations = ((activationsResponse?.items ?? []) as PricingActivationEvent[])
            .sort((left, right) => right.sortKey.localeCompare(left.sortKey))

        const retainedSnapshotIds = new Set<string>()
        if (active) retainedSnapshotIds.add(active.snapshotId)
        for (const activation of activations.slice(0, retainedActivations)) {
            retainedSnapshotIds.add(activation.snapshotId)
        }

        const manifestsResponse = await this.dynamo.queryItems({
            tableName: this.tables.snapshots,
            keyConditions: { recordKey: 'SNAPSHOT' },
            fetchAllItems: true,
            consistentRead: true,
            origin: 'model-pricing.prune-manifests',
        })
        const manifests = (manifestsResponse?.items ?? []) as PricingSnapshotManifest[]
        const cutoff = Date.now() - retentionMs

        const prunedSnapshotIds: string[] = []
        for (const manifest of manifests) {
            if (retainedSnapshotIds.has(manifest.snapshotId)) continue
            if (!Number.isFinite(Date.parse(manifest.createdAt)) || Date.parse(manifest.createdAt) > cutoff) continue

            await this.dynamo.deleteItems({
                tableName: this.tables.records,
                key: { snapshotId: manifest.snapshotId },
                deleteRange: true,
                origin: 'model-pricing.prune-records',
            })
            await this.dynamo.deleteItems({
                tableName: this.tables.snapshots,
                key: { recordKey: 'SNAPSHOT', sortKey: manifest.snapshotId },
                origin: 'model-pricing.prune-manifest',
            })
            prunedSnapshotIds.push(manifest.snapshotId)
        }
        return { prunedSnapshotIds }
    }

    private assertSnapshotRecords(manifest: PricingSnapshotManifest, records: ModelPriceRecord[]): void {
        if (records.length !== manifest.recordCount) {
            throw new Error(`Pricing snapshot ${manifest.snapshotId} record count mismatch: expected ${manifest.recordCount}, found ${records.length}`)
        }
        if (new Set(records.map(record => record.pricingKey)).size !== records.length) {
            throw new Error(`Pricing snapshot ${manifest.snapshotId} has duplicate pricing keys`)
        }
        if (records.some(record => record.snapshotId !== manifest.snapshotId)) {
            throw new Error(`Pricing snapshot ${manifest.snapshotId} contains a record from another snapshot`)
        }
        // The manifest hash includes holds, which are intentionally mutable CURRENT
        // projections. Re-hash the immutable records to detect corrupted serving rows.
        if (manifest.recordsContentHash !== this.createRecordsContentHash(records)) {
            throw new Error(`Pricing snapshot ${manifest.snapshotId} immutable record hash mismatch`)
        }
    }

    private createRecordsContentHash(records: ModelPriceRecord[]): string {
        return canonicalHash(records
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
            .sort((left, right) => left.pricingKey.localeCompare(right.pricingKey)))
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
