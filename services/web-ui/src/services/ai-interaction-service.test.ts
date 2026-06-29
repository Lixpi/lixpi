'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NATS_SUBJECTS, STREAM_STATUS } from '@lixpi/constants'
import AiInteractionService from '$src/services/ai-interaction-service.ts'

const { AI_INTERACTION_SUBJECTS } = NATS_SUBJECTS
const workspaceId = 'workspace-1'
const aiChatThreadId = 'thread-1'
const responseSubject = `${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${workspaceId}.${aiChatThreadId}`

const getDataMock = vi.hoisted(() => vi.fn())
const natsPublishMock = vi.hoisted(() => vi.fn())
const natsSubscribeMock = vi.hoisted(() => vi.fn())
const natsGetSubscriptionsMock = vi.hoisted(() => vi.fn())
const natsRequestMock = vi.hoisted(() => vi.fn())
const getTokenSilentlyMock = vi.hoisted(() => vi.fn())
const receiveSegmentMock = vi.hoisted(() => vi.fn())
const uuidMock = vi.hoisted(() => vi.fn(() => 'matrix-request-id'))
const organizationGetMock = vi.hoisted(() => vi.fn())
const userGetMock = vi.hoisted(() => vi.fn())

let consoleErrorSpy: { mockRestore: () => void } | null = null
let consoleLogSpy: { mockRestore: () => void } | null = null
let consoleWarnSpy: { mockRestore: () => void } | null = null
let consoleInfoSpy: { mockRestore: () => void } | null = null

const flushPromises = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 0))
}

vi.mock('uuid', () => ({ v4: uuidMock }))

vi.mock('$src/services/auth-service.ts', () => ({
    default: {
        getTokenSilently: getTokenSilentlyMock,
    },
}))

vi.mock('$src/services/segmentsReceiver-service.ts', () => ({
    default: {
        receiveSegment: receiveSegmentMock,
    },
}))

vi.mock('$src/stores/servicesStore.ts', () => ({
    servicesStore: {
        getData: getDataMock,
    },
}))

vi.mock('$src/stores/organizationStore.ts', () => ({
    organizationStore: {
        getData: organizationGetMock,
    },
}))

vi.mock('$src/stores/userStore.ts', () => ({
    userStore: {
        getData: userGetMock,
    },
}))

describe('AiInteractionService', () => {
    let service: AiInteractionService

    beforeEach(async () => {
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        vi.clearAllMocks()

        getDataMock.mockReturnValue({
            publish: natsPublishMock,
            subscribe: natsSubscribeMock,
            getSubscriptions: natsGetSubscriptionsMock,
            request: natsRequestMock,
        })
        getTokenSilentlyMock.mockResolvedValue('auth-token')
        organizationGetMock.mockReturnValue('org-1')
        userGetMock.mockReturnValue({ userId: 'user-1' })
        natsGetSubscriptionsMock.mockReturnValue([])
        natsRequestMock.mockResolvedValue({ events: [] })

        service = new AiInteractionService({
            workspaceId,
            aiChatThreadId,
        })

        await flushPromises()
    })

    afterEach(() => {
        consoleErrorSpy?.mockRestore()
        consoleWarnSpy?.mockRestore()
        consoleInfoSpy?.mockRestore()
        consoleLogSpy?.mockRestore()
        consoleErrorSpy = null
        consoleWarnSpy = null
        consoleInfoSpy = null
        consoleLogSpy = null
    })

    it('subscribes to the thread response subject when initialized', () => {
        expect(getDataMock).toHaveBeenCalledWith('nats')
        expect(natsGetSubscriptionsMock).toHaveBeenCalledWith([responseSubject])
        expect(natsSubscribeMock).toHaveBeenCalledWith(responseSubject, expect.any(Function))
        expect(natsRequestMock).toHaveBeenCalledWith(
            AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_RESUME,
            {
                token: 'auth-token',
                workspaceId,
                aiChatThreadId,
                localStreamSeq: 0,
            },
        )
    })

    it('resolves run keys and selected metadata consistently', () => {
        expect(service.getRunKey({ reasoningRunId: 'reasoning-run' } as any)).toBe('reasoning-run')
        expect(service.getRunKey()).toBe(aiChatThreadId)

        expect(service.getGenerationRun({ reasoningRunId: 'legacy' } as any)).toBeUndefined()
        expect(service.getGenerationRun({ generationRun: { reasoningRunId: 'trace-run' } as any })).toEqual({ reasoningRunId: 'trace-run' })
        expect(service.getGenerationRun({ imageGenerationTrace: { generationRun: { reasoningRunId: 'image-run' } } } as any)).toEqual({ reasoningRunId: 'image-run' })
        expect(service.getGenerationRun({ videoGenerationTrace: { generationRun: { reasoningRunId: 'video-run' } } } as any)).toEqual({ reasoningRunId: 'video-run' })
    })

    it('tracks and falls back provider state for run keys', () => {
        expect(service.updateRunProvider(aiChatThreadId, 'reasoning-provider')).toBe('reasoning-provider')
        expect(service.updateRunProvider(aiChatThreadId)).toBe('reasoning-provider')
    })

    it('emits context relevance resolved chunks as dedicated segment types', () => {
        service.onChatMessageResponse({
            content: {
            status: STREAM_STATUS.CONTEXT_RELEVANCE_RESOLVED,
            workspaceContextResolution: {
                selections: [{ nodeId: 'node-1', mediaKind: 'image' }],
                improvedDescriptors: {},
                narrowedMediaNodeIds: ['node-1'],
            },
            },
        })

        expect(receiveSegmentMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'context_relevance_resolved',
                workspaceContextResolution: expect.objectContaining({
                    selections: [{ nodeId: 'node-1', mediaKind: 'image' }],
                }),
                aiChatThreadId,
                aiProvider: null,
            }),
        )
    })

    it('forwards context relevance errors as chat segments', () => {
        service.onChatMessageResponse({
            content: {
                status: STREAM_STATUS.CONTEXT_RELEVANCE_ERROR,
                error: 'context failed',
            },
        })

        expect(receiveSegmentMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'context_relevance_error',
                error: 'context failed',
                aiChatThreadId,
            }),
        )
    })

    it('emits image completion segments with trace metadata', () => {
        service.onChatMessageResponse({
            content: {
                status: STREAM_STATUS.IMAGE_COMPLETE,
                imageUrl: 'https://images.example/one.png',
                fileId: 'file-1',
                responseId: 'response-1',
                revisedPrompt: 'sunset by the sea',
                imageModelProvider: 'provider-image',
                generationRun: { reasoningRunId: 'reasoning-run' },
                aiProvider: 'provider-text',
            },
        })

        expect(receiveSegmentMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'image_complete',
                imageUrl: 'https://images.example/one.png',
                fileId: 'file-1',
                responseId: 'response-1',
                revisedPrompt: 'sunset by the sea',
                aiProvider: 'provider-text',
                imageModelProvider: 'provider-image',
                aiChatThreadId,
                generationRun: { reasoningRunId: 'reasoning-run' },
            }),
        )
    })

    it('deduplicates persisted and live pipeline events by pipelineEventId while advancing stream sequence', () => {
        const first = {
            pipelineEventId: 'event-1',
            pipelineStreamSeq: 3,
            content: {
                status: STREAM_STATUS.CONTEXT_RELEVANCE_ERROR,
                error: 'context failed once',
            },
        }

        service.onChatMessageResponse(first)
        service.onChatMessageResponse({
            ...first,
            content: {
                status: STREAM_STATUS.CONTEXT_RELEVANCE_ERROR,
                error: 'duplicate should be ignored',
            },
        })

        expect(receiveSegmentMock).toHaveBeenCalledTimes(1)
        expect(receiveSegmentMock).toHaveBeenCalledWith(expect.objectContaining({
            type: 'context_relevance_error',
            error: 'context failed once',
        }))
        expect(service.pipelineLocalStreamSeq).toBe(3)
    })

    it('replays pipeline events through the same response handler and updates local stream sequence', async () => {
        natsRequestMock.mockResolvedValueOnce({
            events: [
                {
                    eventId: 'event-4',
                    streamSequence: 4,
                    payload: {
                        pipelineEventId: 'event-4',
                        content: {
                            status: STREAM_STATUS.IMAGE_BRANCH_RESOLVED,
                            resolution: { resolved: true },
                            aiProvider: 'Anthropic',
                        },
                    },
                },
                {
                    eventId: 'event-7',
                    streamSequence: 7,
                    payload: {
                        pipelineEventId: 'event-7',
                        content: {
                            status: STREAM_STATUS.MEDIA_LINEAGE_PLANNED,
                            lineagePlan: {
                                generationRequestId: 'request-1',
                                branchForks: [],
                                runAssignments: [],
                            },
                            aiProvider: 'Anthropic',
                        },
                    },
                },
            ],
        })

        await service.resumePipelineEventStream()

        expect(natsRequestMock).toHaveBeenLastCalledWith(
            AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_RESUME,
            {
                token: 'auth-token',
                workspaceId,
                aiChatThreadId,
                localStreamSeq: 0,
            },
        )
        expect(receiveSegmentMock).toHaveBeenCalledWith(expect.objectContaining({
            type: 'image_branch_resolved',
            imageBranchResolution: { resolved: true },
            aiChatThreadId,
        }))
        expect(receiveSegmentMock).toHaveBeenCalledWith(expect.objectContaining({
            type: 'media_lineage_planned',
            mediaBranchLineagePlan: {
                generationRequestId: 'request-1',
                branchForks: [],
                runAssignments: [],
            },
            aiChatThreadId,
        }))
        expect(service.pipelineLocalStreamSeq).toBe(7)
    })

    it('ignores raw text stream statuses because text arrives through ProseMirror authority', () => {
        service.onChatMessageResponse({
            content: {
                status: STREAM_STATUS.START_STREAM,
                aiProvider: 'provider-stream',
                generationRun: {
                    requestKind: 'media-generation-matrix',
                    reasoningRunId: 'run-stream',
                },
            },
        })

        service.onChatMessageResponse({
            content: {
                status: STREAM_STATUS.STREAMING,
                text: 'hello',
                generationRun: { requestKind: 'media-generation-matrix', reasoningRunId: 'run-stream' },
            },
        })

        service.onChatMessageResponse({
            content: {
                status: STREAM_STATUS.END_STREAM,
                generationRun: { requestKind: 'media-generation-matrix', reasoningRunId: 'run-stream' },
            },
        })

        expect(receiveSegmentMock).not.toHaveBeenCalled()
    })

    it('sends rich payloads and matrix metadata for multi-model requests', async () => {
        await service.sendChatMessage({
            messages: [{ role: 'user', content: 'paint me' }],
            aiReasoningModels: ['reasoner-a', 'reasoner-b'],
            aiImageModels: ['img-a', 'img-b'],
            aiVideoModels: ['video-model'],
            videoDuration: '12',
            videoResolution: '1080p',
            imageSize: '1024x1024',
            referencedFeatureIds: ['feature-a'],
            imageBranchCandidateSnapshot: {
                resolverVersion: 'image-branch-v1',
                threadId: aiChatThreadId,
                regionNodeId: 'node-1',
                promptText: 'paint me',
                candidates: [],
                promptFingerprint: 'abc',
                transcriptContext: 'transcript',
            },
            workspaceContextSnapshot: {
                resolverVersion: 'workspace-context-v1',
                workspaceId,
                threadId: aiChatThreadId,
                promptText: 'paint me',
                nodes: [],
            },
        })

        const [subject, payload] = natsPublishMock.mock.calls.at(-1) ?? []
        expect(subject).toBe(AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE)
        expect(payload).toMatchObject({
            token: 'auth-token',
            workspaceId,
            aiChatThreadId,
            aiReasoningModels: ['reasoner-a', 'reasoner-b'],
            imageSize: '1024x1024',
            referencedFeatureIds: ['feature-a'],
            aiImageModels: ['img-a', 'img-b'],
            aiVideoModels: ['video-model'],
            videoResolution: '1080p',
            videoDuration: '12',
            imageBranchCandidateSnapshot: {
                regionNodeId: 'node-1',
            },
            workspaceContextSnapshot: {
                workspaceId,
            },
            mediaGenerationRequest: {
                requestVersion: 'media-generation-matrix-v1',
                generationRequestId: 'matrix-request-id',
                reasoningModelIds: ['reasoner-a', 'reasoner-b'],
                imageModelIds: ['img-a', 'img-b'],
                videoModelIds: ['video-model'],
                imageOptions: { imageSize: '1024x1024' },
                videoOptions: {
                    duration: '12',
                    resolution: '1080p',
                },
            },
        })
    })

    it('omits matrix payload when only single models are used', async () => {
        await service.sendChatMessage({
            messages: [{ role: 'user', content: 'hello' }],
            aiReasoningModels: ['reasoner'],
            aiImageModels: ['img-model'],
            aiVideoModels: ['video-model'],
        })

        const payload = natsPublishMock.mock.calls.at(-1)?.[1] as Record<string, unknown>
        expect(payload).not.toHaveProperty('mediaGenerationRequest')
    })

    it('sends a stop message on request', async () => {
        await service.stopChatMessage()

        expect(natsPublishMock).toHaveBeenCalledWith(
            AI_INTERACTION_SUBJECTS.CHAT_STOP_MESSAGE,
            {
                token: 'auth-token',
                workspaceId,
                aiChatThreadId,
            },
        )
    })

    it('disconnects response subscriptions and clears pipeline/client state', () => {
        const unsubscribeMock = vi.fn()
        natsGetSubscriptionsMock.mockReturnValue([{ unsubscribe: unsubscribeMock }])

        service.updateRunProvider(aiChatThreadId, 'provider-x')
        service.shouldProcessPipelinePayload({
            pipelineEventId: 'event-1',
            pipelineStreamSeq: 12,
        })
        service.disconnect()

        expect(unsubscribeMock).toHaveBeenCalled()
        expect(natsGetSubscriptionsMock).toHaveBeenCalledWith([responseSubject])
        expect(service.currentAiProvider).toBeNull()
        expect(service.providersByRunKey.size).toBe(0)
        expect(service.pipelineEventIds.size).toBe(0)
    })

    it('ignores malformed response payloads without dispatching segments', () => {
        service.onChatMessageResponse({} as any)
        service.onChatMessageResponse({ content: null } as any)

        expect(receiveSegmentMock).not.toHaveBeenCalled()
    })

    it('emits image and video non-text statuses with generated run metadata', () => {
        service.onChatMessageResponse({
            content: {
                status: STREAM_STATUS.IMAGE_PARTIAL,
                imageUrl: 'https://images.example/partial.png',
                fileId: 'partial-file',
                partialIndex: 4,
                generationRun: { reasoningRunId: 'reasoning-run' },
            },
        })

        expect(receiveSegmentMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'image_partial',
                imageUrl: 'https://images.example/partial.png',
                fileId: 'partial-file',
                partialIndex: 4,
                generationRun: { reasoningRunId: 'reasoning-run' },
            }),
        )

        service.onChatMessageResponse({
            content: {
                status: STREAM_STATUS.VIDEO_PENDING,
                generationRun: { reasoningRunId: 'video-run' },
            },
        })

        expect(receiveSegmentMock).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'video_pending',
                generationRun: { reasoningRunId: 'video-run' },
                aiChatThreadId,
            }),
        )

        service.onChatMessageResponse({
            content: {
                status: STREAM_STATUS.ERROR,
                text: 'backend failed',
            },
        })

        expect(receiveSegmentMock).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'ERROR',
                error: 'backend failed',
                aiChatThreadId,
            }),
        )
    })
})
