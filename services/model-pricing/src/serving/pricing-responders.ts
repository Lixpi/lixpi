'use strict'

import NatsService from '@lixpi/nats-service'
import { NATS_SUBJECTS } from '@lixpi/constants'
import { PricingOverrideService } from '../admin/override-service.ts'
import { PricingStorage } from '../importer/pricing-storage.ts'
import { PricingReconciliationService } from '../reconciliation/reconciliation-service.ts'

const requiredPricingKey = (value: unknown): string => {
    if (!value || typeof value !== 'object' || typeof (value as { pricingKey?: unknown }).pricingKey !== 'string') {
        throw new Error('pricingKey must be provided')
    }
    const pricingKey = (value as { pricingKey: string }).pricingKey.trim()
    if (!pricingKey) throw new Error('pricingKey must not be empty')
    return pricingKey
}

const requiredSnapshotId = (value: unknown): string => {
    if (!value || typeof value !== 'object' || typeof (value as { snapshotId?: unknown }).snapshotId !== 'string') {
        throw new Error('snapshotId must be provided')
    }
    const snapshotId = (value as { snapshotId: string }).snapshotId.trim()
    if (!snapshotId) throw new Error('snapshotId must not be empty')
    return snapshotId
}

export class PricingResponders {
    constructor(
        private readonly nats: NatsService,
        private readonly storage: PricingStorage,
        private readonly overrides: PricingOverrideService,
        private readonly reconciliation: PricingReconciliationService,
        private readonly onConsumerRefreshAcknowledged?: (snapshotId: string) => void,
    ) {}

    register(): void {
        this.nats.reply(NATS_SUBJECTS.PRICING_SUBJECTS.REVISION_GET, async () => await this.storage.getActivePointer())
        this.nats.reply(NATS_SUBJECTS.PRICING_SUBJECTS.MODEL_GET, async (request) => {
            const table = await this.requireActiveTable()
            const pricingKey = requiredPricingKey(request)
            const record = table.records.find(candidate => candidate.pricingKey === pricingKey)
            if (!record) throw new Error(`No active price record exists for ${pricingKey}`)
            return { manifest: table.manifest, record }
        })
        this.nats.reply(NATS_SUBJECTS.PRICING_SUBJECTS.TABLE_GET, async () => await this.requireActiveTable())
        this.nats.reply(NATS_SUBJECTS.PRICING_SUBJECTS.CONSUMER_REFRESH_ACK, async request => {
            const snapshotId = requiredSnapshotId(request)
            const active = await this.storage.getActivePointer()
            if (!active || active.snapshotId !== snapshotId) {
                throw new Error(`Cannot acknowledge inactive pricing snapshot ${snapshotId}`)
            }
            this.onConsumerRefreshAcknowledged?.(snapshotId)
            return { acknowledgedSnapshotId: snapshotId }
        })
        this.nats.reply(NATS_SUBJECTS.PRICING_SUBJECTS.ADMIN_STATUS_GET, async () => {
            const active = await this.storage.getActivePointer()
            const holds = await this.storage.getCurrentHolds()
            const activeTable = active ? await this.storage.getActiveTable() : undefined
            const activeRecordsByKey = new Map((activeTable?.records ?? []).map(record => [record.pricingKey, record]))
            return {
                active,
                activeRecordCount: activeTable?.records.length ?? 0,
                holds: holds
                    .sort((left, right) => left.pricingKey.localeCompare(right.pricingKey))
                    // Carries the currently active record (hash, variants, per-input
                    // evidence/parser version) alongside each hold so an operator can
                    // compare "what's serving" against "what's stuck" without a second
                    // round trip.
                    .map(hold => ({ ...hold, activeRecord: activeRecordsByKey.get(hold.pricingKey) })),
                reconciliation: await this.reconciliation.health(),
            }
        })
        this.nats.reply(NATS_SUBJECTS.PRICING_SUBJECTS.ADMIN_OVERRIDE_COMMAND, async command => await this.overrides.submit(command))
        this.nats.reply(NATS_SUBJECTS.PRICING_SUBJECTS.RECONCILIATION_PREDICTED_DAILY, async prediction =>
            await this.reconciliation.recordPrediction(prediction))
    }

    publishChanged({
        snapshotId,
        previousSnapshotId,
        normalizedContentHash,
        activatedAt,
    }: {
        snapshotId: string
        previousSnapshotId?: string
        normalizedContentHash: string
        activatedAt: string
    }): void {
        this.nats.publish(NATS_SUBJECTS.PRICING_SUBJECTS.CHANGED, {
            snapshotId,
            ...(previousSnapshotId && { previousSnapshotId }),
            normalizedContentHash,
            activatedAt,
        })
    }

    private async requireActiveTable() {
        const table = await this.storage.getActiveTable()
        if (!table) throw new Error('No active pricing snapshot exists')
        return table
    }
}
