'use strict'

import process from 'node:process'

import NatsService from '@lixpi/nats-service'
import { info, err } from '@lixpi/debug-tools'
import DynamoDBService from '@lixpi/dynamodb-service'
import { NATS_SUBJECTS } from '@lixpi/constants'
import { PricingImporter } from './importer/pricing-importer.ts'
import { PricingStorage } from './importer/pricing-storage.ts'
import { PricingOverrideService } from './admin/override-service.ts'
import { PricingResponders } from './serving/pricing-responders.ts'
import { createActualsAdapters } from './reconciliation/actuals-adapters.ts'
import { parseUsdMicros } from './reconciliation/decimal-usd.ts'
import { PricingReconciliationService } from './reconciliation/reconciliation-service.ts'
import { PricingReconciliationStorage } from './reconciliation/reconciliation-storage.ts'

const requiredEnvironment = (name: string): string => {
    const value = process.env[name]?.trim()

    if (!value) {
        throw new Error(`${name} must be configured`)
    }

    return value
}

const natsService = await NatsService.init({
    servers: requiredEnvironment('NATS_SERVERS').split(',').map(server => server.trim()).filter(Boolean),
    name: 'model-pricing',
    nkeySeed: requiredEnvironment('NATS_PRICING_SERVICE_NKEY_SEED'),
    userId: 'svc:model-pricing',
})

const pricingStorage = new PricingStorage(
    new DynamoDBService({
        region: requiredEnvironment('AWS_REGION'),
        endpoint: process.env.DYNAMODB_ENDPOINT?.trim(),
    }),
    {
        snapshots: requiredEnvironment('MODEL_PRICING_SNAPSHOTS_TABLE'),
        records: requiredEnvironment('MODEL_PRICING_RECORDS_TABLE'),
        audit: requiredEnvironment('MODEL_PRICING_AUDIT_TABLE'),
        reconciliation: requiredEnvironment('MODEL_PRICING_RECONCILIATION_TABLE'),
    },
)
const reconciliationStorage = new PricingReconciliationStorage(
    new DynamoDBService({
        region: requiredEnvironment('AWS_REGION'),
        endpoint: process.env.DYNAMODB_ENDPOINT?.trim(),
    }),
    requiredEnvironment('MODEL_PRICING_RECONCILIATION_TABLE'),
)
const reconciliationSettlementLagDays = Number(process.env.MODEL_PRICING_RECONCILIATION_SETTLEMENT_LAG_DAYS ?? '14')
if (!Number.isSafeInteger(reconciliationSettlementLagDays) || reconciliationSettlementLagDays < 1) {
    throw new Error('MODEL_PRICING_RECONCILIATION_SETTLEMENT_LAG_DAYS must be an integer of at least 1')
}
const reconciliationUsageToleranceBpsValue = process.env.MODEL_PRICING_RECONCILIATION_USAGE_TOLERANCE_BPS ?? '100'
if (!/^\d+$/.test(reconciliationUsageToleranceBpsValue)) {
    throw new Error('MODEL_PRICING_RECONCILIATION_USAGE_TOLERANCE_BPS must be an integer from 0 through 10000')
}
const reconciliationUsageToleranceBps = BigInt(reconciliationUsageToleranceBpsValue)
if (reconciliationUsageToleranceBps > 10_000n) {
    throw new Error('MODEL_PRICING_RECONCILIATION_USAGE_TOLERANCE_BPS must be an integer from 0 through 10000')
}
const reconciliation = new PricingReconciliationService(
    reconciliationStorage,
    createActualsAdapters(),
    parseUsdMicros(process.env.MODEL_PRICING_RECONCILIATION_MATERIAL_USD ?? '1'),
    reconciliationSettlementLagDays,
    reconciliationUsageToleranceBps,
)
const importer = new PricingImporter(
    new DynamoDBService({
        region: requiredEnvironment('AWS_REGION'),
        endpoint: process.env.DYNAMODB_ENDPOINT?.trim(),
    }),
    pricingStorage,
    requiredEnvironment('AI_MODELS_LIST_TABLE_NAME'),
)
const operatorPublicKeys = new Set(
    requiredEnvironment('NATS_PRICING_OPERATOR_NKEY_PUBLIC')
        .split(',')
        .map(key => key.trim())
        .filter(Boolean),
)
const pricingResponders = new PricingResponders(
    natsService,
    pricingStorage,
    new PricingOverrideService(
        new DynamoDBService({
            region: requiredEnvironment('AWS_REGION'),
            endpoint: process.env.DYNAMODB_ENDPOINT?.trim(),
        }),
        pricingStorage,
        requiredEnvironment('MODEL_PRICING_AUDIT_TABLE'),
        operatorPublicKeys,
    ),
    reconciliation,
)
pricingResponders.register()
const importIntervalMs = Number(process.env.MODEL_PRICING_IMPORT_INTERVAL_MS ?? '21600000')
if (!Number.isSafeInteger(importIntervalMs) || importIntervalMs < 60_000) {
    throw new Error('MODEL_PRICING_IMPORT_INTERVAL_MS must be an integer of at least 60000')
}
const snapshotRetentionMs = Number(process.env.MODEL_PRICING_SNAPSHOT_RETENTION_MS ?? '2592000000')
if (!Number.isSafeInteger(snapshotRetentionMs) || snapshotRetentionMs < importIntervalMs) {
    throw new Error('MODEL_PRICING_SNAPSHOT_RETENTION_MS must be an integer of at least MODEL_PRICING_IMPORT_INTERVAL_MS')
}
const retainedActivations = Number(process.env.MODEL_PRICING_RETAINED_ACTIVATIONS ?? '5')
if (!Number.isSafeInteger(retainedActivations) || retainedActivations < 1) {
    throw new Error('MODEL_PRICING_RETAINED_ACTIVATIONS must be an integer of at least 1')
}
const reconciliationIntervalMs = Number(process.env.MODEL_PRICING_RECONCILIATION_INTERVAL_MS ?? '21600000')
if (!Number.isSafeInteger(reconciliationIntervalMs) || reconciliationIntervalMs < 60_000) {
    throw new Error('MODEL_PRICING_RECONCILIATION_INTERVAL_MS must be an integer of at least 60000')
}
const reconciliationRetentionMs = Number(process.env.MODEL_PRICING_RECONCILIATION_RETENTION_MS ?? '7776000000')
if (!Number.isSafeInteger(reconciliationRetentionMs) || reconciliationRetentionMs < reconciliationIntervalMs) {
    throw new Error('MODEL_PRICING_RECONCILIATION_RETENTION_MS must be an integer of at least MODEL_PRICING_RECONCILIATION_INTERVAL_MS')
}

class PricingMaintenanceCoordinator {
    private tail: Promise<void> = Promise.resolve()
    private readonly pending = new Set<string>()
    private stopped = false

    run(key: 'import' | 'reconciliation', task: () => Promise<void>): Promise<void> {
        if (this.stopped || this.pending.has(key)) return this.tail
        this.pending.add(key)
        const execution = this.tail.then(task, task)
            .finally(() => this.pending.delete(key))
        this.tail = execution.catch(error => {
            err(`Model pricing ${key} maintenance task failed:`, error)
        })
        return this.tail
    }

    async stopAndWait(): Promise<void> {
        this.stopped = true
        await this.tail
    }
}

const stageImport = async (): Promise<void> => {
    try {
        const result = await importer.import()
        const activation = await pricingStorage.activateSnapshot(result.snapshotId)
        if (activation.activated && activation.activatedAt) {
            pricingResponders.publishChanged(activation)
            info(`Activated pricing snapshot ${result.snapshotId}: ${result.records} verified records, ${result.holds} holds`)
        } else {
            info(`Pricing snapshot ${result.snapshotId} is already active`)
        }
    } catch (error) {
        // An import or activation failure never replaces the prior active pointer.
        err('Model pricing import failed; no snapshot was activated:', error)
    }

    try {
        const { prunedSnapshotIds } = await pricingStorage.pruneAbandonedSnapshots({
            retentionMs: snapshotRetentionMs,
            retainedActivations,
        })
        if (prunedSnapshotIds.length > 0) {
            info(`Pruned ${prunedSnapshotIds.length} abandoned pricing snapshot(s): ${prunedSnapshotIds.join(', ')}`)
        }
    } catch (error) {
        // Pruning is best-effort housekeeping; a failure never affects serving.
        err('Model pricing snapshot pruning failed:', error)
    }
}

const reconcileActuals = async (): Promise<void> => {
    try {
        await reconciliation.reconcile()
    } catch (error) {
        err('Model pricing reconciliation failed; active pricing remains unchanged:', error)
    }

    try {
        const { prunedCount } = await reconciliation.prune(reconciliationRetentionMs)
        if (prunedCount > 0) {
            info(`Pruned ${prunedCount} settled reconciliation record(s)`)
        }
    } catch (error) {
        // Pruning is best-effort housekeeping; a failure never affects reconciliation or serving.
        err('Model pricing reconciliation record pruning failed:', error)
    }
}

const maintenance = new PricingMaintenanceCoordinator()
const runImport = (): Promise<void> => maintenance.run('import', stageImport)
const runReconciliation = (): Promise<void> => maintenance.run('reconciliation', reconcileActuals)

// Material incidents must be up to date before the first import can activate.
await runReconciliation()
void runImport()
const importTimer = setInterval(() => { void runImport() }, importIntervalMs)
const reconciliationTimer = setInterval(() => { void runReconciliation() }, reconciliationIntervalMs)
natsService.subscribe(NATS_SUBJECTS.AI_MODELS_SUBJECTS.MODELS_SYNC_COMPLETED, async () => {
    await runImport()
})
info('Model pricing service is connected with reconciliation, activation, read APIs, and signed override handling')

const shutdown = async (signal: string): Promise<void> => {
    info(`Model pricing service received ${signal}; draining NATS connection`)
    clearInterval(importTimer)
    clearInterval(reconciliationTimer)
    info('Waiting for in-flight pricing maintenance to finish before shutdown')
    await maintenance.stopAndWait()
    await natsService.drain()
    process.exit(0)
}

process.once('SIGINT', async () => {
    try {
        await shutdown('SIGINT')
    } catch (error) {
        err('Model pricing service shutdown failed:', error)
        process.exit(1)
    }
})

process.once('SIGTERM', async () => {
    try {
        await shutdown('SIGTERM')
    } catch (error) {
        err('Model pricing service shutdown failed:', error)
        process.exit(1)
    }
})
