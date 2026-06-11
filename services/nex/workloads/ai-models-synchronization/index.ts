'use strict'

// nex-entry — the AI-models catalog sync, supervised on NATS NEX.
//
// The native nexlet launches this file as a long-running `service`:
//     node --experimental-transform-types index.ts
// It runs AiModelsSync.synchronizeModels() at boot and then every
// LIXPI_SYNC_INTERVAL_MS (default 1h), isolating per-run failures so the loop
// stays alive. The catalog lands in the existing AI_MODELS_LIST DynamoDB table,
// which the API reads live (model::AiModel.getAvailableAiModels -> scanItems),
// so no NATS completion event is published here — the cross-account
// aiModels.syncCompleted push is deferred to v2 (see the proposal).
//
// Env reaches this process via the start_request.environment that
// services/nex/entrypoint.sh injects at deploy time — the native nexlet does
// NOT inherit the container env (agents/native/state.go sets the child env to
// ONLY start_request.environment). So ORG_NAME/STAGE/AWS_*/DYNAMODB_ENDPOINT/
// <provider>_API_KEY are present here exactly as the API sees them.

import process from 'process'

import { info, warn, err } from '@lixpi/debug-tools'

import { AiModelsSync } from './ai-models-synchronization.ts'

const DEFAULT_INTERVAL_MS = 3_600_000 // 1 hour
const intervalMs = Number(process.env.LIXPI_SYNC_INTERVAL_MS) || DEFAULT_INTERVAL_MS

// Reads AWS/DynamoDB/ORG_NAME/STAGE/provider keys from env (unchanged class).
const sync = new AiModelsSync({})

let timer: ReturnType<typeof setTimeout> | null = null

async function runOnce(): Promise<void> {
    const startedAt = new Date()
    try {
        info(`🚀 ai-models sync starting (${startedAt.toISOString()})`)
        const result = await sync.synchronizeModels()
        info(
            `✅ ai-models sync done: new=${result.totalNew} updated=${result.totalUpdated} ` +
            `deleted=${result.totalDeleted} processed=${result.totalProcessed}`,
        )
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

const shutdown = (signal: string): void => {
    warn(`nex-entry received ${signal}; shutting down ai-models sync`)
    if (timer) clearTimeout(timer)
    process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

info(`nex-entry ai-models-sync up; interval=${intervalMs}ms`)
void loop()
