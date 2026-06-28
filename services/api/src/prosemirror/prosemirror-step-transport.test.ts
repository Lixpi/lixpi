'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import NATS_Service from '@lixpi/nats-service'
import {
    getWorkspaceStepStreamName,
    getWorkspaceStepStreamSubject,
    getDocumentStepSubject,
    PROSEMIRROR_SCHEMA_VERSION,
} from '@lixpi/prosemirror'

import { ProseMirrorStepTransport } from './prosemirror-step-transport.ts'

const createNatsService = () => ({
    ensureJetStreamStream: vi.fn(async () => undefined),
    publishJetStream: vi.fn(async () => ({ seq: 1 })),
    getJetStreamMessage: vi.fn(async () => ({ seq: 0, data: { subjectSeq: 0, version: 0 } })),
    ensureJetStreamConsumer: vi.fn(async () => undefined),
    consumeJetStreamMessages: vi.fn(async () => []),
})

describe('ProseMirrorStepTransport', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('throws from singleton factory when no NATS service is available', () => {
        const getInstance = vi.spyOn(NATS_Service as any, 'getInstance').mockReturnValue(undefined)
        expect(() => ProseMirrorStepTransport.fromSingleton()).toThrow('NATS service is not initialized')
        getInstance.mockRestore()
    })

    it('passes JetStream stream options through to ensureWorkspaceStream', async () => {
        const natsService = createNatsService()
        const transport = new ProseMirrorStepTransport(natsService as any)

        await transport.ensureWorkspaceStream('workspace-1')

        const expectedStreamName = getWorkspaceStepStreamName('workspace-1')
        const expectedSubject = getWorkspaceStepStreamSubject('workspace-1')
        expect(natsService.ensureJetStreamStream).toHaveBeenCalledWith({
            name: expectedStreamName,
            subjects: [expectedSubject],
            retention: 'limits',
            storage: 'file',
            allow_rollup_hdrs: true,
            allow_direct: true,
            max_age: 24 * 60 * 60 * 1000 * 1_000_000,
            max_bytes: 64 * 1024 * 1024,
            max_msgs_per_subject: 10000,
        })
    })

    it('returns ACCEPTED for a valid step submit and publishes the expected STEP envelope', async () => {
        const natsService = createNatsService()
        natsService.getJetStreamMessage.mockResolvedValue({
            seq: 11,
            data: { subjectSeq: 3 },
        })
        natsService.publishJetStream.mockResolvedValue({ seq: 19 })
        const transport = new ProseMirrorStepTransport(natsService as any)
        const stepPayload = {
            workspaceId: 'workspace-1',
            docType: 'ai_chat_thread',
            docId: 'thread-1',
            baseVersion: 0,
            expectedVersion: 3,
            step: { type: 'replace' },
            msgId: 'msg-1',
            clientId: 'client-1',
            origin: 'client-edit',
            schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
        }

        const result = await transport.submitStep(stepPayload as any)

        expect(result).toEqual({ status: 'ACCEPTED', version: 4 })
        expect(natsService.publishJetStream).toHaveBeenCalledWith(
            getDocumentStepSubject(stepPayload),
            expect.objectContaining({
                kind: 'STEP',
                version: 4,
                subjectSeq: 4,
                step: { type: 'replace' },
                msgId: 'msg-1',
                clientId: 'client-1',
                schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
            }),
            {
                msgID: 'msg-1',
                expect: {
                    streamName: getWorkspaceStepStreamName('workspace-1'),
                    lastSubjectSequence: 11,
                },
            },
        )
    })

    it('returns CONFLICT when the next subject sequence does not match the expected version', async () => {
        const natsService = createNatsService()
        natsService.getJetStreamMessage.mockResolvedValue({
            seq: 9,
            data: { subjectSeq: 1 },
        })
        const transport = new ProseMirrorStepTransport(natsService as any)

        const result = await transport.submitStep({
            workspaceId: 'workspace-1',
            docType: 'ai_chat_thread',
            docId: 'thread-1',
            baseVersion: 0,
            expectedVersion: 3,
            step: { type: 'replace' },
        } as any)

        expect(result).toEqual({ status: 'CONFLICT', currentVersion: 1 })
        expect(natsService.publishJetStream).not.toHaveBeenCalled()
    })

    it('treats publish failures that indicate sequence mismatch as CONFLICT', async () => {
        const natsService = createNatsService()
        natsService.getJetStreamMessage.mockResolvedValue({
            seq: 31,
            data: { subjectSeq: 3 },
        })
        natsService.publishJetStream.mockRejectedValue({ message: 'wrong last sequence' })
        const transport = new ProseMirrorStepTransport(natsService as any)

        const result = await transport.submitStep({
            workspaceId: 'workspace-1',
            docType: 'ai_chat_thread',
            docId: 'thread-1',
            baseVersion: 0,
            expectedVersion: 3,
            step: { type: 'replace' },
        } as any)

        expect(result).toEqual({ status: 'CONFLICT', currentVersion: 3 })
        expect(natsService.publishJetStream).toHaveBeenCalledOnce()
    })

    it('publishes AI stream steps through JetStream with expected sequence and stream options', async () => {
        const natsService = createNatsService()
        natsService.publishJetStream.mockResolvedValue({ seq: 42 })
        const transport = new ProseMirrorStepTransport(natsService as any)

        const result = await transport.publishAiStreamStep({
            workspaceId: 'workspace-1',
            docType: 'ai_chat_thread',
            docId: 'thread-1',
            expectedLastStreamSequence: 5,
            subjectSeq: 7,
            version: 9,
            step: { type: 'replace' },
            msgId: 'ai-step-1',
        } as any)

        expect(result).toEqual({
            envelope: expect.objectContaining({
                kind: 'STEP',
                version: 9,
                subjectSeq: 7,
            }),
            streamSequence: 42,
        })
        expect(natsService.publishJetStream).toHaveBeenCalledWith(
            getDocumentStepSubject({
                workspaceId: 'workspace-1',
                docType: 'ai_chat_thread',
                docId: 'thread-1',
            }),
            expect.objectContaining({
                kind: 'STEP',
                version: 9,
                subjectSeq: 7,
                aiProvider: undefined,
                generationRun: undefined,
            }),
            {
                msgID: 'ai-step-1',
                expect: {
                    streamName: getWorkspaceStepStreamName('workspace-1'),
                    lastSubjectSequence: 5,
                },
            },
        )
    })
})
