import NATS_Service from '@lixpi/nats-service'
import type { MediaGenerationRunMeta } from '@lixpi/constants'
import {
    getDocumentStepSubject,
    getWorkspaceStepStreamName,
    getWorkspaceStepStreamSubject,
    PROSEMIRROR_SCHEMA_VERSION,
    type DocCoordinate,
    type LoggedStepStreamEvent,
    type StepEnvelope,
    type StepStreamControlEnvelope,
    type StepStreamEvent,
    type SubmitResult,
    type SubmitStepPayload,
} from '@lixpi/prosemirror'

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_MSGS_PER_SUBJECT = 10000
const NANOS_PER_MS = 1000000

type ProseMirrorStepTransportOptions = {
    maxAgeMs?: number
    maxBytes?: number
    maxMsgsPerSubject?: number
}

type ReplayDocumentStepsOptions = DocCoordinate & {
    startStreamSeq: number
    maxMessages?: number
}

type PublishAiStreamStepPayload = DocCoordinate & {
    expectedLastStreamSequence: number
    subjectSeq: number
    version: number
    step: object
    msgId?: string
    aiProvider?: string
    generationRun?: MediaGenerationRunMeta
}

type PublishControlEventPayload = DocCoordinate & {
    expectedLastStreamSequence: number
    subjectSeq: number
    kind: 'START' | 'END' | 'ERROR'
    version: number
    baseVersion?: number
    finalVersion?: number
    schemaVersion?: string
    error?: string
    msgId?: string
    aiProvider?: string
    generationRun?: MediaGenerationRunMeta
}

type ControlEnvelopeBase = DocCoordinate & {
    version: number
    subjectSeq: number
    msgId?: string
    aiProvider?: string
    generationRun?: MediaGenerationRunMeta
    origin: 'ai-stream'
}

type SubjectSequenceState = {
    subjectSeq: number
    streamSequence: number
    documentVersion: number
}

type PublishedEnvelope<T extends StepStreamEvent> = {
    envelope: T
    streamSequence: number
}

export class ProseMirrorStepTransport {
    constructor(
        private readonly natsService: NATS_Service,
        private readonly options: ProseMirrorStepTransportOptions = {},
    ) {}

    static fromSingleton(options: ProseMirrorStepTransportOptions = {}): ProseMirrorStepTransport {
        const natsService = NATS_Service.getInstance()
        if (!natsService) {
            throw new Error('NATS service is not initialized')
        }
        return new ProseMirrorStepTransport(natsService, options)
    }

    async ensureWorkspaceStream(workspaceId: string): Promise<string> {
        const streamName = getWorkspaceStepStreamName(workspaceId)
        await this.natsService.ensureJetStreamStream({
            name: streamName,
            subjects: [getWorkspaceStepStreamSubject(workspaceId)],
            retention: 'limits',
            storage: 'file',
            allow_rollup_hdrs: true,
            allow_direct: true,
            max_age: (this.options.maxAgeMs ?? DEFAULT_MAX_AGE_MS) * NANOS_PER_MS,
            max_bytes: this.options.maxBytes ?? DEFAULT_MAX_BYTES,
            max_msgs_per_subject: this.options.maxMsgsPerSubject ?? DEFAULT_MAX_MSGS_PER_SUBJECT,
        })
        return streamName
    }

    async submitStep(payload: SubmitStepPayload): Promise<SubmitResult> {
        try {
            const expectedSubjectSeq = this.expectedSubjectSeq(payload)
            const state = await this.getCurrentSubjectState(payload)
            if (state.subjectSeq !== expectedSubjectSeq) {
                return {
                    status: 'CONFLICT',
                    currentVersion: payload.baseVersion + state.subjectSeq,
                }
            }
            const envelope = await this.publishClientStep(payload, state.streamSequence, expectedSubjectSeq)
            return { status: 'ACCEPTED', version: envelope.version }
        } catch (error) {
            if (!this.isExpectationFailure(error)) throw error
            const currentSubjectSeq = await this.getCurrentSubjectSequence(payload)
            return {
                status: 'CONFLICT',
                currentVersion: payload.baseVersion + currentSubjectSeq,
            }
        }
    }

    async publishClientStep(
        payload: SubmitStepPayload,
        expectedLastStreamSequence?: number,
        expectedSubjectSeq = this.expectedSubjectSeq(payload),
    ): Promise<StepEnvelope> {
        const subjectSeq = expectedSubjectSeq + 1
        const envelope: StepEnvelope = {
            kind: 'STEP',
            workspaceId: payload.workspaceId,
            docType: payload.docType,
            docId: payload.docId,
            version: payload.baseVersion + subjectSeq,
            subjectSeq,
            step: payload.step,
            msgId: payload.msgId,
            clientId: payload.clientId,
            schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
            origin: payload.origin ?? 'client-edit',
        }
        await this.publishEnvelope(
            envelope,
            expectedLastStreamSequence ?? (await this.getCurrentSubjectState(payload)).streamSequence,
        )
        return envelope
    }

    async publishAiStreamStep(payload: PublishAiStreamStepPayload): Promise<PublishedEnvelope<StepEnvelope>> {
        const envelope: StepEnvelope = {
            kind: 'STEP',
            workspaceId: payload.workspaceId,
            docType: payload.docType,
            docId: payload.docId,
            version: payload.version,
            subjectSeq: payload.subjectSeq,
            step: payload.step,
            msgId: payload.msgId,
            schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
            aiProvider: payload.aiProvider,
            generationRun: payload.generationRun,
            origin: 'ai-stream',
        }
        const streamSequence = await this.publishEnvelope(envelope, payload.expectedLastStreamSequence)
        return { envelope, streamSequence }
    }

    async publishControlEvent(payload: PublishControlEventPayload): Promise<PublishedEnvelope<StepStreamControlEnvelope>> {
        const baseEnvelope = {
            workspaceId: payload.workspaceId,
            docType: payload.docType,
            docId: payload.docId,
            version: payload.version,
            subjectSeq: payload.subjectSeq,
            msgId: payload.msgId,
            aiProvider: payload.aiProvider,
            generationRun: payload.generationRun,
            origin: 'ai-stream' as const,
        }
        const envelope: StepStreamControlEnvelope = this.buildControlEnvelope(payload, baseEnvelope)
        const streamSequence = await this.publishStreamEvent(envelope, payload.expectedLastStreamSequence)
        return { envelope, streamSequence }
    }

    async publishEnvelope(envelope: StepEnvelope, expectedLastStreamSequence: number): Promise<number> {
        return await this.publishStreamEvent(envelope, expectedLastStreamSequence)
    }

    async publishStreamEvent(envelope: StepStreamEvent, expectedLastStreamSequence: number): Promise<number> {
        const streamName = await this.ensureWorkspaceStream(envelope.workspaceId)
        const subject = getDocumentStepSubject(envelope)
        const ack = await this.natsService.publishJetStream(subject, envelope, {
            msgID: envelope.msgId,
            expect: {
                streamName,
                lastSubjectSequence: expectedLastStreamSequence,
            },
        })
        return this.getPublishAckSequence(ack)
    }

    async getCurrentSubjectState(coordinate: DocCoordinate): Promise<SubjectSequenceState> {
        const streamName = await this.ensureWorkspaceStream(coordinate.workspaceId)
        const subject = getDocumentStepSubject(coordinate)
        const lastMessage = await this.natsService.getJetStreamMessage<StepStreamEvent>(streamName, {
            last_by_subj: subject,
        })
        if (!lastMessage) return { subjectSeq: 0, streamSequence: 0, documentVersion: 0 }
        const subjectSeq = typeof lastMessage.data.subjectSeq === 'number' ? lastMessage.data.subjectSeq : 0
        return {
            subjectSeq,
            streamSequence: lastMessage.seq,
            documentVersion: this.getDocumentVersion(lastMessage.data, subjectSeq),
        }
    }

    async getCurrentSubjectStateOrNull(coordinate: DocCoordinate): Promise<SubjectSequenceState | null> {
        const streamName = getWorkspaceStepStreamName(coordinate.workspaceId)
        const streamInfo = await this.natsService.getJetStreamStreamInfoOrNull(streamName)
        if (!streamInfo) return null

        const subject = getDocumentStepSubject(coordinate)
        const lastMessage = await this.natsService.getJetStreamMessage<StepStreamEvent>(streamName, {
            last_by_subj: subject,
        })
        if (!lastMessage) return { subjectSeq: 0, streamSequence: 0, documentVersion: 0 }
        const subjectSeq = typeof lastMessage.data.subjectSeq === 'number' ? lastMessage.data.subjectSeq : 0
        return {
            subjectSeq,
            streamSequence: lastMessage.seq,
            documentVersion: this.getDocumentVersion(lastMessage.data, subjectSeq),
        }
    }

    async getCurrentSubjectSequence(coordinate: DocCoordinate): Promise<number> {
        const state = await this.getCurrentSubjectState(coordinate)
        return state.subjectSeq
    }

    async replayDocumentSteps(options: ReplayDocumentStepsOptions): Promise<StepEnvelope[]> {
        const events = await this.replayDocumentStepEvents(options)
        return events.filter((event): event is LoggedStepStreamEvent & StepEnvelope => event.kind === 'STEP')
    }

    async replayDocumentStepEvents(options: ReplayDocumentStepsOptions): Promise<LoggedStepStreamEvent[]> {
        const streamName = getWorkspaceStepStreamName(options.workspaceId)
        const subject = getDocumentStepSubject(options)
        const lastMessage = await this.natsService.getJetStreamMessage<StepStreamEvent>(streamName, {
            last_by_subj: subject,
        })
        if (!lastMessage || lastMessage.seq < options.startStreamSeq) return []

        const events: LoggedStepStreamEvent[] = []
        const maxMessages = options.maxMessages ?? 100
        let nextSeq = options.startStreamSeq
        while (nextSeq <= lastMessage.seq && events.length < maxMessages) {
            const message = await this.natsService.getJetStreamMessage<StepStreamEvent>(streamName, {
                seq: nextSeq,
                next_by_subj: subject,
            })
            if (!message || message.seq > lastMessage.seq) break
            events.push({
                ...message.data,
                streamSequence: message.seq,
            })
            nextSeq = message.seq + 1
        }
        return events
    }

    async purgeDocumentSubject(coordinate: DocCoordinate): Promise<void> {
        const streamName = await this.ensureWorkspaceStream(coordinate.workspaceId)
        const subject = getDocumentStepSubject(coordinate)
        await this.natsService.purgeJetStreamSubject(streamName, subject)
    }

    private expectedSubjectSeq(payload: SubmitStepPayload): number {
        const subjectSeq = payload.expectedVersion - payload.baseVersion
        if (!Number.isInteger(subjectSeq) || subjectSeq < 0) {
            throw new Error(`Invalid ProseMirror expected version ${payload.expectedVersion} for base ${payload.baseVersion}`)
        }
        return subjectSeq
    }

    private getPublishAckSequence(ack: any): number {
        if (typeof ack?.seq === 'number') return ack.seq
        if (typeof ack?.sequence === 'number') return ack.sequence
        throw new Error('JetStream publish ack did not include a stream sequence')
    }

    private getDocumentVersion(event: StepStreamEvent, fallbackSubjectSeq: number): number {
        if (event.kind === 'END' && typeof event.finalVersion === 'number') return event.finalVersion
        if (typeof event.version === 'number') return event.version
        return fallbackSubjectSeq
    }

    private buildControlEnvelope(
        payload: PublishControlEventPayload,
        baseEnvelope: ControlEnvelopeBase,
    ): StepStreamControlEnvelope {
        if (payload.kind === 'START') {
            return {
                ...baseEnvelope,
                kind: 'START',
                baseVersion: payload.baseVersion ?? payload.version,
                schemaVersion: payload.schemaVersion ?? PROSEMIRROR_SCHEMA_VERSION,
            }
        }
        if (payload.kind === 'END') {
            return {
                ...baseEnvelope,
                kind: 'END',
                finalVersion: payload.finalVersion ?? payload.version,
            }
        }
        return {
            ...baseEnvelope,
            kind: 'ERROR',
            error: payload.error ?? 'AI stream failed',
        }
    }

    isExpectationFailure(error: unknown): boolean {
        const candidate = error as { code?: number; api_error?: { err_code?: number; description?: string }; message?: string }
        const message = `${candidate.message ?? ''} ${candidate.api_error?.description ?? ''}`.toLowerCase()
        return candidate.code === 400
            || candidate.api_error?.err_code === 10071
            || message.includes('wrong last sequence')
            || message.includes('last sequence')
            || message.includes('expect')
    }
}
