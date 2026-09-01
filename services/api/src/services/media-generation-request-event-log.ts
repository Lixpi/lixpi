import {
    getMediaGenerationUserEventSubject,
    NATS_SUBJECTS,
    type MediaGenerationRequestEvent,
} from '@lixpi/constants'
import NATS_Service from '@lixpi/nats-service'

const MAX_MEDIA_GENERATION_REQUEST_EVENT_BYTES = 64 * 1024

export type MediaGenerationRequestEventEnvelope = {
    userId: string
    workspaceId: string
    event: MediaGenerationRequestEvent
    streamSequence: number
}

const sanitizeToken = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, '_')
const getMediaGenerationRequestEventSubjectPrefix = (workspaceId: string, generationRequestId: string): string => `${NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.EVENTS}.${sanitizeToken(workspaceId)}.${sanitizeToken(generationRequestId)}`
export const getMediaGenerationRequestEventSubject = (workspaceId: string, generationRequestId: string): string => `${getMediaGenerationRequestEventSubjectPrefix(workspaceId, generationRequestId)}.events`
export const getMediaGenerationRequestProgressSubject = (
    workspaceId: string,
    generationRequestId: string,
    generationRun: number,
): string => `${getMediaGenerationRequestEventSubjectPrefix(workspaceId, generationRequestId)}.progress.${generationRun}`
export const getMediaGenerationRequestReplaySubject = (workspaceId: string, generationRequestId: string): string => `${getMediaGenerationRequestEventSubjectPrefix(workspaceId, generationRequestId)}.>`
export const getMediaGenerationRequestEventStreamName = (workspaceId: string): string => `MEDIA_GENERATION_REQUEST_EVENTS_${sanitizeToken(workspaceId)}`

export class MediaGenerationRequestEventLog {
    constructor(private readonly natsService: NATS_Service) {}

    static fromSingleton(): MediaGenerationRequestEventLog {
        const natsService = NATS_Service.getInstance()
        if (!natsService) throw new Error('NATS service is not initialized')
        return new MediaGenerationRequestEventLog(natsService)
    }

    async append({ userId, workspaceId, event, expectedLastSubjectSequence }: {
        userId: string
        workspaceId: string
        event: MediaGenerationRequestEvent
        expectedLastSubjectSequence?: number
    }): Promise<MediaGenerationRequestEventEnvelope> {
        const streamName = await this.ensureWorkspaceStream(workspaceId)
        const generationRun = typeof event.payload.generationRun === 'number'
            ? event.payload.generationRun
            : undefined
        const subject = event.status === 'MEDIA_GENERATION_PROGRESS' && generationRun !== undefined
            ? getMediaGenerationRequestProgressSubject(workspaceId, event.generationRequestId, generationRun)
            : getMediaGenerationRequestEventSubject(workspaceId, event.generationRequestId)
        const envelope = { userId, workspaceId, event, streamSequence: 0 }
        if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > MAX_MEDIA_GENERATION_REQUEST_EVENT_BYTES) {
            throw new Error('MEDIA_REQUEST_EVENT_TOO_LARGE')
        }
        const ack = await this.natsService.publishJetStream(subject, envelope, {
            msgID: event.eventId,
            expect: {
                streamName,
                ...(typeof expectedLastSubjectSequence === 'number'
                    ? { lastSubjectSequence: expectedLastSubjectSequence }
                    : {}),
            },
        }) as { seq?: number; sequence?: number }
        const streamSequence = ack.seq ?? ack.sequence
        if (typeof streamSequence !== 'number') throw new Error('MEDIA_REQUEST_EVENT_ACK_SEQUENCE_MISSING')
        const persistedEnvelope = { ...envelope, streamSequence }
        this.natsService.publish(
            [
                getMediaGenerationUserEventSubject(userId, NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.STATUS),
                sanitizeToken(workspaceId),
                sanitizeToken(event.generationRequestId),
            ].join('.'),
            persistedEnvelope,
        )
        return persistedEnvelope
    }

    async replay({ workspaceId, generationRequestId, startStreamSequence = 1, maxMessages = 1000 }: {
        workspaceId: string
        generationRequestId: string
        startStreamSequence?: number
        maxMessages?: number
    }): Promise<{ events: MediaGenerationRequestEventEnvelope[]; hasMore: boolean; streamName: string; subject: string }> {
        const streamName = getMediaGenerationRequestEventStreamName(workspaceId)
        const subject = getMediaGenerationRequestReplaySubject(workspaceId, generationRequestId)
        const last = await this.natsService.getJetStreamMessage<MediaGenerationRequestEventEnvelope>(streamName, { last_by_subj: subject })
        if (!last || last.seq < startStreamSequence) return { events: [], hasMore: false, streamName, subject }
        const events: MediaGenerationRequestEventEnvelope[] = []
        let sequence = startStreamSequence
        while (sequence <= last.seq && events.length < maxMessages) {
            const message = await this.natsService.getJetStreamMessage<MediaGenerationRequestEventEnvelope>(streamName, {
                seq: sequence,
                next_by_subj: subject,
            })
            if (!message || message.seq > last.seq) break
            events.push({ ...message.data, streamSequence: message.seq })
            sequence = message.seq + 1
        }
        return { events, hasMore: (events.at(-1)?.streamSequence ?? startStreamSequence - 1) < last.seq, streamName, subject }
    }

    async getLatestRunProgress({ workspaceId, generationRequestId, generationRun }: {
        workspaceId: string
        generationRequestId: string
        generationRun: number
    }): Promise<MediaGenerationRequestEventEnvelope | null> {
        const message = await this.natsService.getJetStreamMessage<MediaGenerationRequestEventEnvelope>(
            getMediaGenerationRequestEventStreamName(workspaceId),
            { last_by_subj: getMediaGenerationRequestProgressSubject(workspaceId, generationRequestId, generationRun) },
        )
        return message ? { ...message.data, streamSequence: message.seq } : null
    }

    async ensureWorkspaceStream(workspaceId: string): Promise<string> {
        const streamName = getMediaGenerationRequestEventStreamName(workspaceId)
        await this.natsService.ensureJetStreamStream({
            name: streamName,
            subjects: [`${NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.EVENTS}.${sanitizeToken(workspaceId)}.>`],
            retention: 'limits',
            storage: 'file',
            num_replicas: 3,
            allow_direct: true,
            max_age: 0,
            max_bytes: 64 * 1024 * 1024,
            max_msgs_per_subject: 10000,
        })
        return streamName
    }

    async purgeRequest({ workspaceId, generationRequestId }: {
        workspaceId: string
        generationRequestId: string
    }): Promise<void> {
        await this.natsService.purgeJetStreamSubject(
            getMediaGenerationRequestEventStreamName(workspaceId),
            getMediaGenerationRequestReplaySubject(workspaceId, generationRequestId),
        ).catch(error => {
            const candidate = error as { code?: number; message?: string }
            if (candidate.code === 404 || /not found|no stream/iu.test(candidate.message ?? '')) return
            throw error
        })
    }
}
