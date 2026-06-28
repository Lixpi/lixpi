'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'
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
const getTokenSilentlyMock = vi.hoisted(() => vi.fn())
const receiveSegmentMock = vi.hoisted(() => vi.fn())
const uuidMock = vi.hoisted(() => vi.fn(() => 'matrix-request-id'))
const organizationGetMock = vi.hoisted(() => vi.fn())
const userGetMock = vi.hoisted(() => vi.fn())

let parserTokenCallback: ((segment: unknown, unsubscribe: () => void) => void) | undefined
let parserSubscribeMock = vi.fn()
let parserStartParsingMock = vi.fn()
let parserParseTokenMock = vi.fn()
let parserStopParsingMock = vi.fn()
let parserRemoveInstanceMock = vi.fn()
let parserInstance: {
    subscribeToTokenParse: typeof parserSubscribeMock
    startParsing: typeof parserStartParsingMock
    parseToken: typeof parserParseTokenMock
    stopParsing: typeof parserStopParsingMock
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

vi.mock('@lixpi/markdown-stream-parser', () => ({
    MarkdownStreamParser: {
        getInstance: vi.fn(() => parserInstance),
        removeInstance: (...args: unknown[]) => parserRemoveInstanceMock(...args),
    },
}))

describe('AiInteractionService', () => {
    let service: AiInteractionService

    beforeEach(async () => {
        vi.clearAllMocks()

        parserTokenCallback = undefined
        parserSubscribeMock = vi.fn((callback: (segment: unknown, unsubscribe: () => void) => void) => {
            parserTokenCallback = callback
            return undefined
        })
        parserStartParsingMock = vi.fn()
        parserParseTokenMock = vi.fn()
        parserStopParsingMock = vi.fn()
        parserRemoveInstanceMock = vi.fn()
        parserInstance = {
            subscribeToTokenParse: parserSubscribeMock,
            startParsing: parserStartParsingMock,
            parseToken: parserParseTokenMock,
            stopParsing: parserStopParsingMock,
        }

        getDataMock.mockReturnValue({
            publish: natsPublishMock,
            subscribe: natsSubscribeMock,
            getSubscriptions: natsGetSubscriptionsMock,
        })
        getTokenSilentlyMock.mockResolvedValue('auth-token')
        organizationGetMock.mockReturnValue('org-1')
        userGetMock.mockReturnValue({ userId: 'user-1' })
        natsGetSubscriptionsMock.mockReturnValue([])

        service = new AiInteractionService({
            workspaceId,
            aiChatThreadId,
        })

        await Promise.resolve()
    })

    it('subscribes to the thread response subject when initialized', () => {
        expect(getDataMock).toHaveBeenCalledWith('nats')
        expect(natsGetSubscriptionsMock).toHaveBeenCalledWith([responseSubject])
        expect(natsSubscribeMock).toHaveBeenCalledWith(responseSubject, expect.any(Function))
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

    it('routes markdown token streaming through the parser lifecycle', () => {
        service.onChatMessageResponse({
            content: {
                status: STREAM_STATUS.START_STREAM,
                aiProvider: 'provider-stream',
                generationRun: { reasoningRunId: 'run-stream' },
            },
        })
        expect(parserStartParsingMock).toHaveBeenCalled()

        service.onChatMessageResponse({
            content: {
                status: STREAM_STATUS.STREAMING,
                text: 'hello',
                generationRun: { reasoningRunId: 'run-stream' },
            },
        })
        expect(parserParseTokenMock).toHaveBeenCalledWith('hello')

        expect(parserTokenCallback).toBeDefined()
        service.onChatMessageResponse({
            content: {
                status: STREAM_STATUS.END_STREAM,
                generationRun: { reasoningRunId: 'run-stream' },
            },
        })
        expect(parserStopParsingMock).toHaveBeenCalled()

        const callbackUnsubscribe = vi.fn()
        expect(parserTokenCallback).toBeDefined()
        parserTokenCallback?.({ status: STREAM_STATUS.END_STREAM }, callbackUnsubscribe)
        expect(callbackUnsubscribe).toHaveBeenCalled()
        expect(parserRemoveInstanceMock).toHaveBeenCalledWith(`${aiChatThreadId}:run-stream`)
        expect(service.markdownParserContexts.has('run-stream')).toBe(false)
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

    it('stops markdown streams with a stop message on request', async () => {
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

    it('disconnects parser contexts and response subscriptions', () => {
        const unsubscribeMock = vi.fn()
        natsGetSubscriptionsMock.mockReturnValue([{ unsubscribe: unsubscribeMock }])

        service.initMarkdownParser({ reasoningRunId: 'disconnect-run' }, 'provider-x')
        service.disconnect()

        expect(unsubscribeMock).toHaveBeenCalled()
        expect(parserRemoveInstanceMock).toHaveBeenCalledWith(`${aiChatThreadId}:disconnect-run`)
        expect(service.currentAiProvider).toBeNull()
        expect(service.markdownParserContexts.size).toBe(0)
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
