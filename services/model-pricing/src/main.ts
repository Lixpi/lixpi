'use strict'

import process from 'node:process'

import NatsService from '@lixpi/nats-service'
import { info, err } from '@lixpi/debug-tools'
import DynamoDBService from '@lixpi/dynamodb-service'
import { NATS_SUBJECTS } from '@lixpi/constants'
import { PricingImporter } from './importer/pricing-importer.ts'
import { PricingStorage } from './importer/pricing-storage.ts'

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
    },
)
const importer = new PricingImporter(
    new DynamoDBService({
        region: requiredEnvironment('AWS_REGION'),
        endpoint: process.env.DYNAMODB_ENDPOINT?.trim(),
    }),
    pricingStorage,
    requiredEnvironment('AI_MODELS_LIST_TABLE_NAME'),
)
const importIntervalMs = Number(process.env.MODEL_PRICING_IMPORT_INTERVAL_MS ?? '21600000')
if (!Number.isSafeInteger(importIntervalMs) || importIntervalMs < 60_000) {
    throw new Error('MODEL_PRICING_IMPORT_INTERVAL_MS must be an integer of at least 60000')
}

let importInProgress: Promise<void> | undefined
const stageImport = async (): Promise<void> => {
    if (importInProgress) {
        info('Model pricing import already in progress; skipping this trigger')
        return
    }
    importInProgress = (async () => {
        try {
            const result = await importer.import()
            info(`Staged non-serving pricing snapshot ${result.snapshotId}: ${result.records} verified records, ${result.holds} holds`)
        } catch (error) {
            // An import failure never changes an active pointer. Phase 5 owns activation.
            err('Model pricing import failed; no snapshot was activated:', error)
        }
    })()
    try {
        await importInProgress
    } finally {
        importInProgress = undefined
    }
}

void stageImport()
const importTimer = setInterval(() => { void stageImport() }, importIntervalMs)
natsService.subscribe(NATS_SUBJECTS.AI_MODELS_SUBJECTS.MODELS_SYNC_COMPLETED, async () => {
    await stageImport()
})
info('Model pricing service is connected and staging Phase 4 non-serving snapshots')

const shutdown = async (signal: string): Promise<void> => {
    info(`Model pricing service received ${signal}; draining NATS connection`)
    clearInterval(importTimer)
    if (importInProgress) {
        info('Waiting for in-flight pricing import to finish before shutdown')
        await importInProgress
    }
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
