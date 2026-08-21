'use strict'

import process from 'node:process'

import { fromSeed } from '@nats-io/nkeys'
import NatsService from '@lixpi/nats-service'
import { NATS_SUBJECTS, type PricingOverrideCommand } from '@lixpi/constants'
import { canonicalize } from '../importer/canonical-json.ts'

const requiredEnvironment = (name: string): string => {
    const value = process.env[name]?.trim()
    if (!value) throw new Error(`${name} must be configured`)
    return value
}

const createCommand = (action: PricingOverrideCommand['action'], value: unknown): PricingOverrideCommand => {
    if (!value || typeof value !== 'object') throw new Error('Override command JSON must be an object')
    const keyPair = fromSeed(requiredEnvironment('NATS_PRICING_OPERATOR_NKEY_SEED'))
    const now = new Date()
    const command = {
        ...(value as Omit<PricingOverrideCommand, 'action' | 'actorKeyId' | 'signature' | 'issuedAt' | 'expiresAt'>),
        action,
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
        actorKeyId: keyPair.getPublicKey(),
    }
    const signature = Buffer.from(keyPair.sign(new TextEncoder().encode(canonicalize(command))))
        .toString('base64url')
    return { ...command, signature }
}

const main = async (): Promise<void> => {
    const [command, action, json] = process.argv.slice(2)
    const nats = await NatsService.init({
        servers: requiredEnvironment('NATS_SERVERS').split(',').map(server => server.trim()).filter(Boolean),
        name: 'pricingctl',
        nkeySeed: requiredEnvironment('NATS_PRICING_OPERATOR_NKEY_SEED'),
        userId: 'svc:pricing-operator',
    })
    try {
        if (command === 'status' || command === 'holds') {
            const result = await nats.request(NATS_SUBJECTS.PRICING_SUBJECTS.ADMIN_STATUS_GET, {})
            process.stdout.write(`${JSON.stringify(command === 'holds' ? (result as { holds: unknown }).holds : result, null, 2)}\n`)
            return
        }
        if (command === 'override' && ['propose', 'approve', 'reject'].includes(action ?? '') && json) {
            const override = createCommand(action as PricingOverrideCommand['action'], JSON.parse(json))
            const result = await nats.request(NATS_SUBJECTS.PRICING_SUBJECTS.ADMIN_OVERRIDE_COMMAND, override)
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
            return
        }
        throw new Error('Usage: pricingctl status | holds | override <propose|approve|reject> <command-json>')
    } finally {
        await nats.drain()
    }
}

await main()
