import { setTimeout as delay } from 'node:timers/promises'
import { warn } from '@lixpi/debug-tools'
import { NATS_SUBJECTS } from '@lixpi/constants'
import {
    type ProviderUsageOutbox,
    type ProviderUsageTransport,
    type ProviderUsageRecordRequest,
    type ProviderRequestCompletionRequest,
} from '@lixpi/usage-reporter'
import {
    type default as NatsService,
} from '@lixpi/nats-service'

export const PROVIDER_USAGE_OUTBOX_STREAM = 'PROVIDER_USAGE_OUTBOX'
export const PROVIDER_USAGE_OUTBOX_SUBJECT = 'provider-usage.outbox'
const consumer = 'api-provider-usage'

type PendingUsage =
    | {
        kind: 'usage'
        request: ProviderUsageRecordRequest
    }
    | {
        kind: 'completion'
        request: ProviderRequestCompletionRequest
    }

// Usage measurements have no retention deadline or delivery limit. The responder
// must deduplicate records when an acknowledgement is lost after persistence.
export class DurableProviderUsageOutbox implements ProviderUsageOutbox {
    private stopped = false
    private worker?: Promise<void>

    constructor(
        private readonly nats: NatsService,
        private readonly transport: ProviderUsageTransport,
        private readonly replicas = 3,
        private readonly retryMs = 1000,
    ) {}

    async prepare(): Promise<void> {
        await this.nats.ensureJetStreamStream({
            name: PROVIDER_USAGE_OUTBOX_STREAM,
            subjects: [PROVIDER_USAGE_OUTBOX_SUBJECT],
            retention: 'workqueue',
            storage: 'file',
            num_replicas: this.replicas,
            max_age: 0,
            discard: 'new',
        })
        await this.nats.ensureJetStreamConsumer(
            PROVIDER_USAGE_OUTBOX_STREAM,
            {
                durable_name: consumer,
                ack_policy: 'explicit',
                deliver_policy: 'all',
                filter_subject: PROVIDER_USAGE_OUTBOX_SUBJECT,
                ack_wait: 30 * 1000000000,
                max_deliver: -1,
                max_ack_pending: 100,
            },
        )
    }

    async enqueueUsage(request: ProviderUsageRecordRequest): Promise<void> {
        await this.nats.publishJetStream(
            PROVIDER_USAGE_OUTBOX_SUBJECT,
            {
                kind: 'usage',
                request,
            },
            {
                msgID: `usage:${request.providerRequestId}`,
            },
        )
    }

    async enqueueCompletion(request: ProviderRequestCompletionRequest): Promise<void> {
        await this.nats.publishJetStream(
            PROVIDER_USAGE_OUTBOX_SUBJECT,
            {
                kind: 'completion',
                request,
            },
            {
                msgID: `completion:${request.authorizationId}`,
            },
        )
    }

    async deliverPending(): Promise<number> {
        return await this.nats.processJetStreamMessages<PendingUsage>(
            PROVIDER_USAGE_OUTBOX_STREAM,
            consumer,
            async ({ data }) => {
                try {
                    const subject = data.kind === 'usage'
                        ? NATS_SUBJECTS.METRICS_SUBJECTS.PROVIDER_USAGE_RECORD
                        : NATS_SUBJECTS.METRICS_SUBJECTS.PROVIDER_REQUEST_COMPLETE
                    const result = await this.transport.request<unknown, {
                        recorded?: boolean
                        completed?: boolean
                    }>(
                        subject,
                        data.request,
                        3000,
                    )

                    if (data.kind === 'usage' ? result?.recorded !== true : result?.completed !== true)
                        return { nakDelayMs: this.retryMs }
                } catch {
                    // Retain even a pricing/configuration rejection for repair and replay.
                    return { nakDelayMs: this.retryMs }
                }
            },
            {
                maxMessages: 10,
                expiresMs: 1000,
                nakDelayMs: this.retryMs,
            },
        )
    }

    start(): void {
        if (this.worker)
            return

        this.worker = this.run()
    }

    async stop(): Promise<void> {
        this.stopped = true
        await this.worker
    }

    private async run(): Promise<void> {
        while (!this.stopped) {
            try {
                await this.deliverPending()
            } catch {
                warn('[ProviderUsage] durable outbox unavailable; queued measurements retained')
                await delay(this.retryMs)
            }
        }
    }
}
