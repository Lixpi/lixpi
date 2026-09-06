import {
    getCapabilityUserEventSubject,
    NATS_SUBJECTS,
    type CapabilityRunEvent,
} from '@lixpi/constants'
import NATS_Service from '@lixpi/nats-service'

const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_MESSAGES_PER_SUBJECT = 10000
const NANOS_PER_MS = 1000000

export type CapabilityRunEventEnvelope = {
    userId: string
    workspaceId: string
    event: CapabilityRunEvent
    streamSequence: number
}

export type CapabilityRunReplayResult = {
    streamName: string
    subject: string
    events: CapabilityRunEventEnvelope[]
    hasMore: boolean
}

export class CapabilityRunEventLog {
    constructor(private readonly natsService: NATS_Service) {}

    static fromSingleton(): CapabilityRunEventLog {
        const natsService = NATS_Service.getInstance()

        if (!natsService)
            throw new Error('NATS service is not initialized')

        return new CapabilityRunEventLog(natsService)
    }

    async append({
        userId,
        workspaceId,
        event,
    }: {
        userId: string
        workspaceId: string
        event: CapabilityRunEvent
    }): Promise<CapabilityRunEventEnvelope> {
        const streamName = await this.ensureWorkspaceStream(workspaceId)
        const subject = getCapabilityRunEventSubject(workspaceId, event.runId)
        const envelope = {
            userId,
            workspaceId,
            event,
            streamSequence: 0,
        }
        const ack = await this.natsService.publishJetStream(
            subject,
            envelope,
            {
                msgID: `${event.runId}:${event.sequence}`,
                expect: { streamName },
            },
        )
        const streamSequence = getPublishAckSequence(ack)

        return {
            ...envelope,
            streamSequence,
        }
    }

    async replay({
        workspaceId,
        runId,
        startStreamSequence = 1,
        maxMessages = 1000,
    }: {
        workspaceId: string
        runId: string
        startStreamSequence?: number
        maxMessages?: number
    }): Promise<CapabilityRunReplayResult> {
        const streamName = getCapabilityRunEventStreamName(workspaceId)
        const subject = getCapabilityRunEventSubject(workspaceId, runId)
        const lastMessage = await this.natsService.getJetStreamMessage<CapabilityRunEventEnvelope>(
            streamName,
            {
                last_by_subj: subject,
            },
        )

        if (
            !lastMessage
            || lastMessage.seq < startStreamSequence
        )
            return {
                streamName,
                subject,
                events: [],
                hasMore: false,
            }

        const events: CapabilityRunEventEnvelope[] = []
        let nextSequence = startStreamSequence

        while (
            nextSequence <= lastMessage.seq
            && events.length < maxMessages
        ) {
            const message = await this.natsService.getJetStreamMessage<CapabilityRunEventEnvelope>(
                streamName,
                {
                    seq: nextSequence,
                    next_by_subj: subject,
                },
            )

            if (
                !message
                || message.seq > lastMessage.seq
            )
                break

            events.push({
                ...message.data,
                streamSequence: message.seq,
            })
            nextSequence = message.seq + 1
        }

        return {
            streamName,
            subject,
            events,
            hasMore: (events.at(-1)?.streamSequence ?? startStreamSequence - 1) < lastMessage.seq,
        }
    }

    async ensureWorkspaceStream(workspaceId: string): Promise<string> {
        const streamName = getCapabilityRunEventStreamName(workspaceId)
        await this.natsService.ensureJetStreamStream({
            name: streamName,
            subjects: [`${NATS_SUBJECTS.CAPABILITY_SUBJECTS.RUN.EVENTS}.${sanitizeToken(workspaceId)}.>`],
            retention: 'limits',
            storage: 'file',
            num_replicas: 3,
            allow_direct: true,
            max_age: DEFAULT_MAX_AGE_MS * NANOS_PER_MS,
            max_bytes: DEFAULT_MAX_BYTES,
            max_msgs_per_subject: DEFAULT_MAX_MESSAGES_PER_SUBJECT,
        })

        return streamName
    }
}

export class CapabilityRunEventRelay {
    private subscriptionCount = 0

    constructor(private readonly natsService: NATS_Service) {}

    start(): void {
        if (this.subscriptionCount > 0)
            return

        const connection = this.natsService.getConnection()
        const canonicalSubject = `${NATS_SUBJECTS.CAPABILITY_SUBJECTS.RUN.EVENTS}.*.*`
        const subscription = connection.subscribe(canonicalSubject, { queue: 'capability-run-event-relay' })
        this.subscriptionCount = 1
        void (async () => {
            try {
                for await (const message of subscription) {
                    let envelope: CapabilityRunEventEnvelope

                    try {
                        envelope = JSON.parse(
                            message.string(),
                        ) as CapabilityRunEventEnvelope
                    } catch {
                        continue
                    }

                    if (
                        !envelope.userId
                        || !envelope.event?.runId
                    )
                        continue

                    connection.publish(
                        [
                            getCapabilityUserEventSubject(envelope.userId, NATS_SUBJECTS.CAPABILITY_SUBJECTS.RUN.STATUS),
                            sanitizeToken(envelope.workspaceId),
                            sanitizeToken(envelope.event.runId),
                        ].join('.'),
                        message.data,
                    )
                }
            } finally {
                this.subscriptionCount = 0
            }
        })()
    }
}

export function getCapabilityRunEventSubject(
    workspaceId: string,
    runId: string,
): string {
    return `${NATS_SUBJECTS.CAPABILITY_SUBJECTS.RUN.EVENTS}.${sanitizeToken(workspaceId)}.${sanitizeToken(runId)}`
}

export function getCapabilityRunEventStreamName(workspaceId: string): string {
    return `CAPABILITY_RUN_EVENTS_${sanitizeToken(workspaceId)}`
}

function sanitizeToken(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, '_')
}

function getPublishAckSequence(ack: unknown): number {
    const candidate = ack as {
        seq?: number
        sequence?: number
    }

    if (typeof candidate.seq === 'number')
        return candidate.seq

    if (typeof candidate.sequence === 'number')
        return candidate.sequence

    throw new Error('JetStream publish ack did not include a stream sequence')
}
