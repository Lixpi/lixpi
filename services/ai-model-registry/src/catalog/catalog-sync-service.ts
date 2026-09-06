import process from 'node:process'

import NatsService from '@lixpi/nats-service'
import {
    err,
    info,
    warn,
} from '@lixpi/debug-tools'
import { NATS_SUBJECTS } from '@lixpi/constants'

import {
    CatalogSync,
    type CatalogSyncResult,
} from './catalog-sync.ts'
import { CredentialsExpiredError } from './sources/credentials-error.ts'

const { AI_MODELS_SUBJECTS } = NATS_SUBJECTS

const DEFAULT_INTERVAL_MS = 3600000

// Runs the catalog sync at boot and then on an interval, and announces each
// completed run on `aiModels.syncCompleted` so the API can react. Both halves are
// best effort: a failed run logs and waits for the next tick rather than taking the
// registry down, and a NATS failure disables the event without touching the sync.
export class CatalogSyncService {
    private readonly sync: CatalogSync
    private readonly intervalMs: number
    private timer: ReturnType<typeof setTimeout> | null = null
    private nats: NatsService | null = null
    private lastResult: CatalogSyncResult | null = null
    private running = false

    constructor() {
        const env = process.env

        this.sync = new CatalogSync({
            catalogDir: env.MODEL_CATALOG_DIR ?? '/usr/src/service/data/model-catalog',
            // The deployed catalog tree ships with the image and is read-only, so a
            // production run fetches into memory and writes only DynamoDB. In
            // development the tree is bind-mounted and the fetched files are the
            // point of the run.
            writeCatalogFiles: env.MODEL_CATALOG_WRITE_FILES?.trim().toLowerCase() === 'true',
            writeDynamoDb: env.MODEL_CATALOG_WRITE_DYNAMODB?.trim().toLowerCase() !== 'false',
        })
        this.intervalMs = Number(env.MODEL_CATALOG_SYNC_INTERVAL_MS) || DEFAULT_INTERVAL_MS
    }

    getLastResult(): CatalogSyncResult | null {
        return this.lastResult
    }

    isRunning(): boolean {
        return this.running
    }

    private async getNats(): Promise<NatsService | null> {
        if (this.nats?.isConnected())
            return this.nats

        const servers = process.env.NATS_SERVERS?.split(',').map(server => server.trim()).filter(Boolean)
        const nkeySeed = process.env.NATS_AI_MODEL_REGISTRY_NKEY_SEED
        const userId = process.env.NATS_AI_MODEL_REGISTRY_USER_ID ?? 'svc:ai-model-registry'

        if (
            !servers?.length
            || !nkeySeed
        ) {
            warn('NATS credentials not provided; aiModels.syncCompleted will not be published')

            return null
        }

        try {
            this.nats = await NatsService.init({
                servers,
                name: 'ai-model-registry',
                nkeySeed,
                userId,
            })

            return this.nats
        } catch (error) {
            err('Could not connect to NATS; completion events disabled:', error)
            this.nats = null

            return null
        }
    }

    private async publishCompleted(result: CatalogSyncResult): Promise<void> {
        const nats = await this.getNats()

        if (!nats)
            return

        try {
            nats.publish(
                AI_MODELS_SUBJECTS.MODELS_SYNC_COMPLETED,
                {
                    totalNew: result.totalNew,
                    totalUpdated: result.totalUpdated,
                    totalDeleted: result.totalDeleted,
                    totalProcessed: result.totalProcessed,
                    driftFindings: result.drift.total,
                    pricingDrift: result.drift.pricing.length,
                    incomplete: result.incomplete.length,
                    excluded: result.excluded.length,
                    ranAt: result.ranAt,
                },
            )
            info(`Published ${AI_MODELS_SUBJECTS.MODELS_SYNC_COMPLETED}`)
        } catch (error) {
            err('Failed to publish aiModels.syncCompleted:', error)
        }
    }

    async runOnce(): Promise<CatalogSyncResult | null> {
        if (this.running) {
            warn('Catalog sync already running; skipping this run')

            return null
        }

        this.running = true

        try {
            const result = await this.sync.run()
            this.lastResult = result
            await this.publishCompleted(result)

            return result
        } catch (error) {
            if (error instanceof CredentialsExpiredError)
                err(`Catalog sync stopped, and every later run will fail the same way until this is fixed. ${error.message}`)
            else
                err('Catalog sync failed; will retry on the next interval:', error)

            return null
        } finally {
            this.running = false
        }
    }

    // The interval is measured from the end of a run, so a slow run can never
    // overlap the next one and produce concurrent DynamoDB writes.
    private async loop(): Promise<void> {
        await this.runOnce()
        this.timer = setTimeout(() => void this.loop(), this.intervalMs)
    }

    start(): void {
        info(`Catalog sync scheduled every ${this.intervalMs}ms`)
        void this.loop()
    }

    async stop(): Promise<void> {
        if (this.timer)
            clearTimeout(this.timer)

        this.timer = null

        try {
            await this.nats?.disconnect()
        } catch {
            // Best effort on shutdown.
        }
    }
}
