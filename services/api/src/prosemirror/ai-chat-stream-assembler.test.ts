'use strict'

import { describe, expect, it, vi } from 'vitest'
import { STREAM_STATUS, type CapabilityGenerationTrace, type MediaGenerationRunMeta } from '@lixpi/constants'

import { AiChatProseMirrorStreamAssembler } from './ai-chat-stream-assembler.ts'

type JsonNode = {
    type?: string
    attrs?: Record<string, any>
    text?: string
    content?: JsonNode[]
}

function findNode(root: JsonNode, predicate: (node: JsonNode) => boolean): JsonNode | undefined {
    if (predicate(root)) return root
    for (const child of root.content ?? []) {
        const found = findNode(child, predicate)
        if (found) return found
    }
    return undefined
}

function createTransport() {
    let subjectSeq = 0
    let streamSequence = 0
    return {
        getCurrentSubjectState: vi.fn(async () => ({ subjectSeq, streamSequence })),
        replayDocumentStepEvents: vi.fn(async () => []),
        purgeDocumentSubject: vi.fn(async () => {
            subjectSeq = 0
            streamSequence = 0
        }),
        publishAiStreamStep: vi.fn(async (event: { subjectSeq: number }) => {
            subjectSeq = event.subjectSeq
            streamSequence += 1
            return { envelope: { subjectSeq }, streamSequence }
        }),
        publishControlEvent: vi.fn(async (event: { subjectSeq: number }) => {
            subjectSeq = event.subjectSeq
            streamSequence += 1
            return { envelope: { subjectSeq }, streamSequence }
        }),
        isExpectationFailure: vi.fn(() => false),
    }
}

describe('AiChatProseMirrorStreamAssembler Capability generation history', () => {
    it('persists the capability trace and the reasoning model response in the same reasoning section', async () => {
        const generationRun: MediaGenerationRunMeta = {
            requestKind: 'media-generation-matrix',
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            reasoningModelId: 'Google:gemini-2.5-flash',
            reasoningIndex: 0,
        }
        const trace: CapabilityGenerationTrace = {
            traceVersion: 'capability-generation-trace-v1',
            generationRun,
            capabilityId: 'action-timeline',
            capabilityName: 'Action Timeline',
            capabilityRunId: 'timeline-run',
            chatModelProvider: 'Google',
            chatModelId: 'Google:gemini-2.5-flash',
            input: { durationMs: 15000, precisionMs: 2000 },
            outputAssetIds: ['timeline-asset'],
            steps: [{ stepId: 'persist', title: 'Persist timeline', status: 'completed' }],
        }
        const assembler = new AiChatProseMirrorStreamAssembler({
            organizationId: 'organization-1',
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            leaseId: 'lease-1',
            leaseHolderId: 'holder-1',
            provider: 'Google',
            generationRun,
            transport: createTransport() as any,
        })

        assembler.handleContent({
            status: STREAM_STATUS.START_STREAM,
            aiProvider: 'Google',
            generationRun,
        })
        assembler.handleContent({
            status: STREAM_STATUS.CAPABILITY_GENERATION_TRACE,
            aiProvider: 'Google',
            generationRun,
            capabilityGenerationTrace: trace,
        })
        assembler.handleContent({
            status: STREAM_STATUS.STREAMING,
            aiProvider: 'Google',
            generationRun,
            text: 'The action timeline is ready.',
        })
        await assembler.finishTextPhase()
        await assembler.flushPendingWork()

        const snapshot = assembler.snapshotForProjection() as JsonNode
        const reasoningSection = findNode(snapshot, node => (
            node.type === 'aiReasoningSection' && node.attrs?.reasoningRunId === 'reasoning-1'
        ))
        const traceBlock = findNode(reasoningSection!, node => node.type === 'aiCollapsibleBlock')

        expect(reasoningSection).toBeDefined()
        expect(traceBlock?.attrs).toMatchObject({
            title: 'Action Timeline generation details',
            isStreaming: false,
            capabilityGenerationTrace: expect.objectContaining({
                capabilityRunId: 'timeline-run',
                outputAssetIds: ['timeline-asset'],
            }),
        })
        expect(JSON.stringify(reasoningSection)).toContain('The action timeline is ready.')
    })
})
