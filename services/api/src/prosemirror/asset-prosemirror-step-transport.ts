'use strict'

import NATS_Service from '@lixpi/nats-service'
import {
    PROSEMIRROR_SCHEMA_VERSION,
    getAssetStepSubject,
    getOrganizationAssetStepStreamName,
    getOrganizationAssetStepStreamSubject,
    type AssetDocCoordinate,
    type AssetStepEnvelope,
    type AssetStepControlEnvelope,
    type AssetStepStreamEvent,
    type AssetSubmitStepsPayload,
    type SubmitResult,
} from '@lixpi/prosemirror'

const MAX_AGE_NANOS = 7 * 24 * 60 * 60 * 1_000_000_000

export type LoggedAssetStepEnvelope = AssetStepStreamEvent & { streamSequence: number }

type AssetSubjectState = {
    subjectSeq: number
    streamSequence: number
    documentVersion: number
}

export class AssetProseMirrorStepTransport {
    constructor(private readonly natsService: NATS_Service) {}

    isExpectationFailure(error: unknown): boolean {
        const message = String((error as { message?: string })?.message ?? error).toLowerCase()
        return message.includes('sequence') || message.includes('expect')
    }

    static fromSingleton(): AssetProseMirrorStepTransport {
        const natsService = NATS_Service.getInstance()
        if (!natsService) throw new Error('NATS service is not initialized')
        return new AssetProseMirrorStepTransport(natsService)
    }

    async ensureOrganizationStream(organizationId: string): Promise<string> {
        const streamName = getOrganizationAssetStepStreamName(organizationId)
        await this.natsService.ensureJetStreamStream({
            name: streamName,
            subjects: [getOrganizationAssetStepStreamSubject(organizationId)],
            retention: 'limits',
            storage: 'file',
            allow_rollup_hdrs: true,
            allow_direct: true,
            max_age: MAX_AGE_NANOS,
            max_bytes: 256 * 1024 * 1024,
            max_msgs_per_subject: 10_000,
        })
        return streamName
    }

    async getCurrentSubjectState(coordinate: AssetDocCoordinate): Promise<AssetSubjectState> {
        const streamName = await this.ensureOrganizationStream(coordinate.organizationId)
        const message = await this.natsService.getJetStreamMessage<AssetStepStreamEvent>(streamName, {
            last_by_subj: getAssetStepSubject(coordinate),
        })
        if (!message) return { subjectSeq: 0, streamSequence: 0, documentVersion: 0 }
        return {
            subjectSeq: message.data.subjectSeq,
            streamSequence: message.seq,
            documentVersion: message.data.version,
        }
    }

    async submitSteps(payload: AssetSubmitStepsPayload): Promise<SubmitResult> {
        try {
            const state = await this.getCurrentSubjectState(payload)
            const currentVersion = state.streamSequence === 0 ? payload.baseVersion : state.documentVersion
            if (currentVersion !== payload.expectedVersion) return { status: 'CONFLICT', currentVersion }
            let version = currentVersion
            let subjectSeq = state.subjectSeq
            let lastStreamSequence = state.streamSequence
            for (const step of payload.steps) {
                version += 1
                subjectSeq += 1
                const envelope: AssetStepEnvelope = {
                    organizationId: payload.organizationId,
                    assetId: payload.assetId,
                    role: payload.role,
                    kind: 'STEP',
                    version,
                    subjectSeq,
                    step: step.step,
                    msgId: step.msgId,
                    clientId: step.clientId,
                    schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
                    origin: 'client-edit',
                }
                const ack = await this.natsService.publishJetStream(getAssetStepSubject(payload), envelope, {
                    msgID: step.msgId,
                    expect: {
                        streamName: getOrganizationAssetStepStreamName(payload.organizationId),
                        lastSubjectSequence: lastStreamSequence,
                    },
                })
                const streamSequence = typeof ack?.seq === 'number' ? ack.seq : ack.sequence
                if (typeof streamSequence !== 'number') throw new Error('STEP_PUBLISH_ACK_MISSING_SEQUENCE')
                lastStreamSequence = streamSequence
            }
            return { status: 'ACCEPTED', version }
        } catch (error) {
            if (!this.isExpectationFailure(error)) throw error
            const state = await this.getCurrentSubjectState(payload)
            return { status: 'CONFLICT', currentVersion: state.documentVersion || payload.baseVersion }
        }
    }

    async publishAiStep(payload: Omit<AssetStepEnvelope, 'kind' | 'origin' | 'schemaVersion'> & {
        expectedLastStreamSequence: number
    }): Promise<number> {
        const streamName = await this.ensureOrganizationStream(payload.organizationId)
        const envelope: AssetStepEnvelope = {
            organizationId: payload.organizationId,
            assetId: payload.assetId,
            role: payload.role,
            kind: 'STEP',
            version: payload.version,
            subjectSeq: payload.subjectSeq,
            step: payload.step,
            msgId: payload.msgId,
            clientId: payload.clientId,
            schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
            aiProvider: payload.aiProvider,
            generationRun: payload.generationRun,
            origin: 'ai-stream',
        }
        const ack = await this.natsService.publishJetStream(getAssetStepSubject(payload), envelope, {
            msgID: payload.msgId,
            expect: { streamName, lastSubjectSequence: payload.expectedLastStreamSequence },
        })
        const sequence = typeof ack?.seq === 'number' ? ack.seq : ack.sequence
        if (typeof sequence !== 'number') throw new Error('STEP_PUBLISH_ACK_MISSING_SEQUENCE')
        return sequence
    }

    async publishAiStreamStep(payload: Omit<AssetStepEnvelope, 'kind' | 'origin' | 'schemaVersion'> & {
        expectedLastStreamSequence: number
    }): Promise<{ envelope: AssetStepEnvelope; streamSequence: number }> {
        const streamSequence = await this.publishAiStep(payload)
        return {
            envelope: {
                organizationId: payload.organizationId,
                assetId: payload.assetId,
                role: payload.role,
                kind: 'STEP',
                version: payload.version,
                subjectSeq: payload.subjectSeq,
                step: payload.step,
                msgId: payload.msgId,
                clientId: payload.clientId,
                schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
                aiProvider: payload.aiProvider,
                generationRun: payload.generationRun,
                origin: 'ai-stream',
            },
            streamSequence,
        }
    }

    async publishControlEvent(payload: Omit<AssetStepControlEnvelope, 'origin'> & {
        expectedLastStreamSequence: number
    }): Promise<{ envelope: AssetStepControlEnvelope; streamSequence: number }> {
        const streamName = await this.ensureOrganizationStream(payload.organizationId)
        const envelope: AssetStepControlEnvelope = {
            organizationId: payload.organizationId,
            assetId: payload.assetId,
            role: payload.role,
            kind: payload.kind,
            version: payload.version,
            subjectSeq: payload.subjectSeq,
            baseVersion: payload.baseVersion,
            finalVersion: payload.finalVersion,
            schemaVersion: payload.schemaVersion,
            error: payload.error,
            msgId: payload.msgId,
            aiProvider: payload.aiProvider,
            generationRun: payload.generationRun,
            origin: 'ai-stream',
        }
        const ack = await this.natsService.publishJetStream(getAssetStepSubject(payload), envelope, {
            msgID: payload.msgId,
            expect: { streamName, lastSubjectSequence: payload.expectedLastStreamSequence },
        })
        const streamSequence = typeof ack?.seq === 'number' ? ack.seq : ack.sequence
        if (typeof streamSequence !== 'number') throw new Error('CONTROL_PUBLISH_ACK_MISSING_SEQUENCE')
        return { envelope, streamSequence }
    }

    async replay(coordinate: AssetDocCoordinate, startStreamSeq: number, maxMessages = 1000): Promise<LoggedAssetStepEnvelope[]> {
        const streamName = getOrganizationAssetStepStreamName(coordinate.organizationId)
        const subject = getAssetStepSubject(coordinate)
        const last = await this.natsService.getJetStreamMessage<AssetStepStreamEvent>(streamName, { last_by_subj: subject })
        if (!last || last.seq < startStreamSeq) return []
        const events: LoggedAssetStepEnvelope[] = []
        let nextSeq = startStreamSeq
        while (nextSeq <= last.seq && events.length < maxMessages) {
            const message = await this.natsService.getJetStreamMessage<AssetStepStreamEvent>(streamName, {
                seq: nextSeq,
                next_by_subj: subject,
            })
            if (!message || message.seq > last.seq) break
            events.push({ ...message.data, streamSequence: message.seq })
            nextSeq = message.seq + 1
        }
        return events
    }

    async replayDocumentStepEvents(payload: AssetDocCoordinate & { startStreamSeq: number; maxMessages?: number }): Promise<LoggedAssetStepEnvelope[]> {
        return await this.replay(payload, payload.startStreamSeq, payload.maxMessages)
    }

    async purge(coordinate: AssetDocCoordinate): Promise<void> {
        await this.natsService.purgeJetStreamSubject(
            getOrganizationAssetStepStreamName(coordinate.organizationId),
            getAssetStepSubject(coordinate),
        )
    }

    async purgeThrough(coordinate: AssetDocCoordinate, streamSequence: number): Promise<void> {
        await this.natsService.purgeJetStreamSubject(
            getOrganizationAssetStepStreamName(coordinate.organizationId),
            getAssetStepSubject(coordinate),
            { throughSequence: streamSequence },
        )
    }

    async purgeDocumentSubject(coordinate: AssetDocCoordinate): Promise<void> {
        await this.purge(coordinate)
    }
}
