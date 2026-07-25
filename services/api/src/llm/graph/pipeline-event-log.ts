'use strict'

import { NATS_SUBJECTS } from '@lixpi/constants'
import NATS_Service from '@lixpi/nats-service'

// Explicit terminal-state cleanup purges a pipeline after its final response and
// conversation snapshot are persisted. This age limit is only the crash/orphan
// backstop for processes that terminate before the explicit purge runs.
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_MSGS_PER_SUBJECT = 10000
const NANOS_PER_MS = 1000000

type PipelineEventLogOptions = {
    maxAgeMs?: number
    maxBytes?: number
    maxMsgsPerSubject?: number
}

export type PipelineEventEnvelope = {
    kind: 'PIPELINE_EVENT'
    workspaceId: string
    pipelineId: string
    eventId: string
    payload: Record<string, any>
    publishedAt: number
    streamSequence: number
}

export type PublishPipelineEventPayload = {
    workspaceId: string
    pipelineId: string
    eventId: string
    payload: Record<string, any>
}

export type ReplayPipelineEventsOptions = {
    workspaceId: string
    pipelineId: string
    startStreamSeq?: number
    maxMessages?: number
}

export type PipelineReplayResult = {
    streamName: string
    subject: string
    events: PipelineEventEnvelope[]
    hasMore: boolean
}

export class PipelineEventLog {
    constructor(
        private readonly natsService: NATS_Service,
        private readonly options: PipelineEventLogOptions = {},
    ) {}

    static fromSingleton(options: PipelineEventLogOptions = {}): PipelineEventLog {
        const natsService = NATS_Service.getInstance()
        if (!natsService) {
            throw new Error('NATS service is not initialized')
        }
        return new PipelineEventLog(natsService, options)
    }

    async publishEvent(payload: PublishPipelineEventPayload): Promise<PipelineEventEnvelope> {
        const streamName = await this.ensureWorkspaceStream(payload.workspaceId)
        const subject = getPipelineEventSubject(payload.workspaceId, payload.pipelineId)
        const envelopeWithoutSequence = {
            kind: 'PIPELINE_EVENT' as const,
            workspaceId: payload.workspaceId,
            pipelineId: payload.pipelineId,
            eventId: payload.eventId,
            payload: sanitizeForJetStream(payload.payload) as Record<string, any>,
            publishedAt: Date.now(),
            streamSequence: 0,
        }
        const ack = await this.natsService.publishJetStream(subject, envelopeWithoutSequence, {
            msgID: payload.eventId,
            expect: { streamName },
        })
        const streamSequence = getPublishAckSequence(ack)
        return {
            ...envelopeWithoutSequence,
            streamSequence,
        }
    }

    async replayPipelineEvents(options: ReplayPipelineEventsOptions): Promise<PipelineReplayResult> {
        const streamName = getPipelineEventStreamName(options.workspaceId)
        const subject = getPipelineEventSubject(options.workspaceId, options.pipelineId)
        const lastMessage = await this.natsService.getJetStreamMessage<PipelineEventEnvelope>(streamName, {
            last_by_subj: subject,
        })
        const startStreamSeq = options.startStreamSeq ?? 1
        if (!lastMessage || lastMessage.seq < startStreamSeq) {
            return {
                streamName,
                subject,
                events: [],
                hasMore: false,
            }
        }

        const messages: Array<{ data: PipelineEventEnvelope; subject: string; seq: number }> = []
        const maxMessages = options.maxMessages ?? 1000
        let nextSeq = startStreamSeq
        while (nextSeq <= lastMessage.seq && messages.length < maxMessages) {
            const message = await this.natsService.getJetStreamMessage<PipelineEventEnvelope>(streamName, {
                seq: nextSeq,
                next_by_subj: subject,
            })
            if (!message || message.seq > lastMessage.seq) break
            messages.push(message)
            nextSeq = message.seq + 1
        }
        return {
            streamName,
            subject,
            events: messages.map(message => ({
                ...message.data,
                streamSequence: message.seq,
            })),
            hasMore: (messages.at(-1)?.seq ?? startStreamSeq - 1) < lastMessage.seq,
        }
    }

    async purgePipelineEvents(workspaceId: string, pipelineId: string): Promise<void> {
        const streamName = await this.ensureWorkspaceStream(workspaceId)
        await this.natsService.purgeJetStreamSubject(streamName, getPipelineEventSubject(workspaceId, pipelineId))
    }

    async ensureWorkspaceStream(workspaceId: string): Promise<string> {
        const streamName = getPipelineEventStreamName(workspaceId)
        await this.natsService.ensureJetStreamStream({
            name: streamName,
            subjects: [getPipelineEventStreamSubject(workspaceId)],
            retention: 'limits',
            storage: 'file',
            allow_direct: true,
            max_age: (this.options.maxAgeMs ?? DEFAULT_MAX_AGE_MS) * NANOS_PER_MS,
            max_bytes: this.options.maxBytes ?? DEFAULT_MAX_BYTES,
            max_msgs_per_subject: this.options.maxMsgsPerSubject ?? DEFAULT_MAX_MSGS_PER_SUBJECT,
        })
        return streamName
    }

}

export function getPipelineEventSubject(workspaceId: string, pipelineId: string): string {
    return [
        NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_EVENTS,
        sanitizeSubjectToken(workspaceId),
        sanitizeSubjectToken(pipelineId),
    ].join('.')
}

function getPipelineEventStreamName(workspaceId: string): string {
    return `PIPELINE_EVENTS_${sanitizeStreamToken(workspaceId)}`
}

function getPipelineEventStreamSubject(workspaceId: string): string {
    return `${NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_EVENTS}.${sanitizeSubjectToken(workspaceId)}.>`
}

function getPublishAckSequence(ack: any): number {
    if (typeof ack?.seq === 'number') return ack.seq
    if (typeof ack?.sequence === 'number') return ack.sequence
    throw new Error('JetStream publish ack did not include a stream sequence')
}

function sanitizeForJetStream(value: unknown): unknown {
    if (value === undefined) return null
    if (value === null || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(item => sanitizeForJetStream(item))

    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
        if (item === undefined) continue
        result[key] = sanitizeForJetStream(item)
    }
    return result
}

function sanitizeStreamToken(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, '_')
}

function sanitizeSubjectToken(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, '_')
}
