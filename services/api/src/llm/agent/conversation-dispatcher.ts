import {
    AGENT_DISPATCH_POLL_MS,
    AGENT_DISPATCH_SHARDS,
    NATS_SUBJECTS,
    type AccountWorkContext,
} from '@lixpi/constants'
import { warn } from '@lixpi/debug-tools'
import { isTransactionConditionalCheckFailure } from '@lixpi/dynamodb-service'
import {
    type default as NatsService,
} from '@lixpi/nats-service'
import { AccountRequestContext } from '../../services/account-request-context.ts'
import {
    conversationDueKey,
    conversationPartition,
    type ConversationRepository,
    type ConversationDispatch,
    type ConversationMeta,
} from './conversation-repository.ts'

const streamName = 'AGENT_CONVERSATIONS'
const consumerName = 'api-agent-conversations'

export class ConversationDispatcher {
    private stopped = true
    private timer?: ReturnType<typeof setTimeout>

    constructor(
        private readonly nats: NatsService,
        private readonly repository: ConversationRepository,
        private readonly execute: (job: ConversationDispatch) => Promise<'done' | 'defer'>,
    ) {}

    async start(): Promise<void> {
        await this.nats.ensureJetStreamStream({
            name: streamName,
            subjects: [NATS_SUBJECTS.CONVERSATION_SUBJECTS.DISPATCH],
            retention: 'workqueue',
            storage: 'file',
            num_replicas: Number(process.env.NATS_STREAM_REPLICAS || 3),
        })
        await this.nats.ensureJetStreamConsumer(
            streamName,
            {
                durable_name: consumerName,
                ack_policy: 'explicit',
                deliver_policy: 'all',
                filter_subject: NATS_SUBJECTS.CONVERSATION_SUBJECTS.DISPATCH,
                ack_wait: 60_000_000_000,
                max_deliver: -1,
            },
        )
        this.stopped = false
        void this.publishDue()

        for (let slot = 0; slot < 4; slot++)
            void this.consume()
    }

    stop(): void {
        this.stopped = true
        clearTimeout(this.timer)
    }

    private async publishDue(): Promise<void> {
        try {
            for (
                let shard = 0;
                shard < AGENT_DISPATCH_SHARDS
                && !this.stopped;
                shard++
            ) {
                const partition = `DISPATCH#${shard}`
                const page = await this.repository.query<ConversationDispatch>(
                    partition,
                    '',
                    { limit: 50 },
                )

                for (const job of page.items) {
                    if (job.dueAt > Date.now())
                        break

                    // The DynamoDB intent remains until JetStream confirms the
                    // durable publish. A crash between these writes duplicates
                    // delivery, which the owner lease and receipts absorb.
                    await this.nats.publishJetStream(NATS_SUBJECTS.CONVERSATION_SUBJECTS.DISPATCH, job)
                    await this.removeDispatched(
                        partition,
                        conversationDueKey(job),
                        job,
                    )
                }
            }
        } catch (error) {
            warn('[ConversationDispatcher] dispatch publication will retry', error)
        } finally {
            if (!this.stopped) {
                this.timer = setTimeout(() => void this.publishDue(), AGENT_DISPATCH_POLL_MS)
                this.timer.unref()
            }
        }
    }

    private async consume(): Promise<void> {
        while (!this.stopped) {
            try {
                await this.nats.processJetStreamMessages<ConversationDispatch>(
                    streamName,
                    consumerName,
                    async message => {
                        const job = message.data
                        const key = conversationPartition(job.organizationId, job.conversationAssetId)
                        const stored = await this.repository.read<ConversationDispatch>(key, `DISPATCH#${job.jobId}`)

                        if (!stored)
                            return

                        // Ignore message-carried scope after looking up the trusted
                        // accepted command. Only stored API metadata is resumable.
                        try {
                            return await AccountRequestContext.resumeWork(stored.account as AccountWorkContext, async () => {
                                if (await this.execute(stored) === 'defer')
                                    return { nakDelayMs: 2_000 }

                                if (!await this.removeDispatched(
                                    key,
                                    `DISPATCH#${stored.jobId}`,
                                    stored,
                                ))
                                    return { nakDelayMs: 2_000 }
                            })
                        } catch (error) {
                            if (
                                !(error instanceof Error)
                                || error.message !== 'ACCOUNT_ADMISSION_DENIED'
                            )
                                throw error

                            await this.pauseDenied(stored)

                            return { nakDelayMs: 30_000 }
                        }
                    },
                    {
                        maxMessages: 1,
                        expiresMs: 1_000,
                        nakDelayMs: 5_000,
                    },
                )
            } catch (error) {
                warn('[ConversationDispatcher] worker fetch will retry', error)
                await new Promise(resolve => setTimeout(resolve, 1_000))
            }
        }
    }

    private async removeDispatched(
        partition: string,
        key: string,
        job: ConversationDispatch,
    ): Promise<boolean> {
        const operation = this.repository.remove(partition, key)

        if (
            job.purpose === 'projection'
            && job.projectionRevision !== undefined
        ) {
            operation.conditionExpression = '#projectionRevision = :projectionRevision'
            operation.expressionAttributeNames = { '#projectionRevision': 'projectionRevision' }
            operation.expressionAttributeValues = { ':projectionRevision': job.projectionRevision }
        }

        try {
            await this.repository.commit([operation])

            return true
        } catch (error) {
            if (!isTransactionConditionalCheckFailure(error))
                throw error

            return false
        }
    }

    private async pauseDenied(job: ConversationDispatch): Promise<void> {
        if (job.purpose === 'projection')
            return

        const pk = conversationPartition(job.organizationId, job.conversationAssetId)
        const meta = await this.repository.read<ConversationMeta>(pk, 'META')

        if (
            !meta
            || (meta.leaseExpiresAt ?? 0) > Date.now()
            || meta.queuePaused
        )
            return

        const next: ConversationMeta = {
            ...meta,
            revision: meta.revision + 1,
            queuePaused: true,
            queueRevision: meta.queueRevision + 1,
            ...(meta.run
                && !['completed', 'failed', 'stopped'].includes(meta.run.state)
                ? { run: {
                    ...meta.run,
                    state: 'needs-reauthentication',
                } }
                : {}),
        }
        delete next.leaseOwner
        delete next.leaseExpiresAt

        try {
            await this.repository.commit([this.repository.put(
                pk,
                'META',
                next,
                meta.revision,
            )])
        } catch (error) {
            if (!isTransactionConditionalCheckFailure(error))
                throw error
        }
    }
}
