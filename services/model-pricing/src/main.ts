'use strict'

import process from 'node:process'

import NatsService from '@lixpi/nats-service'
import { info, err } from '@lixpi/debug-tools'

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

// Phase 2 deliberately registers no NATS responders. The process proves that
// the dedicated account and service identity are deployable before pricing data
// or read endpoints are introduced.
info('Model pricing service is connected and awaiting Phase 4 import wiring')

const shutdown = async (signal: string): Promise<void> => {
    info(`Model pricing service received ${signal}; draining NATS connection`)
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
