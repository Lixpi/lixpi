'use strict'

// nex-entry — the AI-models catalog sync, supervised on NATS NEX.
//
// The native nexlet launches this file as a long-running `service`:
//     node --experimental-transform-types index.ts
// It runs AiModelsSync.synchronizeModels() at boot and then every
// LIXPI_SYNC_INTERVAL_MS (default 1h), isolating per-run failures so the loop
// stays alive. The catalog lands in the existing AI_MODELS_LIST DynamoDB table,
// and after each run a completion event is published on aiModels.syncCompleted
// (exported from the NEX account, imported into AUTH) so the API can react.
//
// Env reaches this process via the Nexfile start_request.environment that
// services/nex/entrypoint.sh injects (the native nexlet does NOT inherit the
// container env), plus the NEX_WORKLOAD_NATS_* credentials the native nexlet
// mints for the workload — which are what the completion event is published with.

import process from 'process'

import { connect, type NatsConnection } from '@nats-io/transport-node'
import { nkeyAuthenticator } from '@nats-io/nats-core'

import { info, warn, err } from '@lixpi/debug-tools'
import { NATS_SUBJECTS } from '@lixpi/constants'

import { AiModelsSync } from './ai-models-synchronization.ts'

const { AI_MODELS_SUBJECTS } = NATS_SUBJECTS

const DEFAULT_INTERVAL_MS = 3_600_000 // 1 hour
const intervalMs = Number(process.env.LIXPI_SYNC_INTERVAL_MS) || DEFAULT_INTERVAL_MS

// Reads AWS/DynamoDB/ORG_NAME/STAGE/provider keys from env (unchanged class).
const sync = new AiModelsSync({})

let timer: ReturnType<typeof setTimeout> | null = null
let nats: NatsConnection | null = null

// Connect to NATS with the credentials the native nexlet mints for this workload
// (NEX_WORKLOAD_NATS_SERVERS + NEX_WORKLOAD_NATS_NKEY seed). The node's
// issuer-nkey strategy hands the workload the NEX-account nkey, so it
// authenticates the same way the node does. Best-effort: a NATS failure disables
// the completion event but never blocks or fails the sync.
async function getNats(): Promise<NatsConnection | null> {
    if (nats && !nats.isClosed()) return nats
    nats = null

    const servers = process.env.NEX_WORKLOAD_NATS_SERVERS?.split(',').map(s => s.trim()).filter(Boolean)
    const seed = process.env.NEX_WORKLOAD_NATS_NKEY
    if (!servers?.length || !seed) {
        warn('NEX_WORKLOAD_NATS_* not provided — aiModels.syncCompleted will not be published')
        return null
    }

    try {
        nats = await connect({
            servers,
            name: 'nex-ai-models-sync',
            authenticator: nkeyAuthenticator(new TextEncoder().encode(seed)),
        })
        info(`nex-entry connected to NATS (${nats.getServer()}) for completion events`)
        return nats
    } catch (error) {
        err('nex-entry could not connect to NATS; completion events disabled:', error)
        nats = null
        return null
    }
}

async function publishCompleted(payload: Record<string, unknown>): Promise<void> {
    const nc = await getNats()
    if (!nc) return
    try {
        nc.publish(AI_MODELS_SUBJECTS.MODELS_SYNC_COMPLETED, new TextEncoder().encode(JSON.stringify(payload)))
        await nc.flush()
        info(`📣 published ${AI_MODELS_SUBJECTS.MODELS_SYNC_COMPLETED}`)
    } catch (error) {
        err('nex-entry failed to publish aiModels.syncCompleted:', error)
    }
}

async function runOnce(): Promise<void> {
    const startedAt = new Date()
    try {
        info(`🚀 ai-models sync starting (${startedAt.toISOString()})`)
        const result = await sync.synchronizeModels()
        info(
            `✅ ai-models sync done: new=${result.totalNew} updated=${result.totalUpdated} ` +
            `deleted=${result.totalDeleted} processed=${result.totalProcessed}`,
        )
        await publishCompleted({
            totalNew: result.totalNew,
            totalUpdated: result.totalUpdated,
            totalDeleted: result.totalDeleted,
            totalProcessed: result.totalProcessed,
            ranAt: startedAt.toISOString(),
        })
    } catch (error) {
        // synchronizeModels() already isolates most per-provider failures; this
        // backstop keeps the hourly loop alive on a hard throw.
        err('❌ ai-models sync failed; will retry next interval:', error)
    }
}

// Self-scheduling loop: wait `intervalMs` AFTER each run completes, so a slow
// run can never overlap the next one (no concurrent DynamoDB writes).
async function loop(): Promise<void> {
    await runOnce()
    timer = setTimeout(() => { void loop() }, intervalMs)
}

const shutdown = async (signal: string): Promise<void> => {
    warn(`nex-entry received ${signal}; shutting down ai-models sync`)
    if (timer) clearTimeout(timer)
    try { await nats?.drain() } catch { /* best-effort */ }
    process.exit(0)
}

process.on('SIGTERM', () => { void shutdown('SIGTERM') })
process.on('SIGINT', () => { void shutdown('SIGINT') })

info(`nex-entry ai-models-sync up; interval=${intervalMs}ms`)
void loop()
