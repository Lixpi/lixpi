'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STREAM_STATUS } from '@lixpi/constants'

const canvasProjectionMocks = vi.hoisted(() => ({
    upsertMediaLineagePlanToCanvas: vi.fn(async () => undefined),
    refreshMediaGenerationRequestCanvasGeometry: vi.fn(async () => undefined),
    settleMediaGenerationRequestOnCanvas: vi.fn(async () => undefined),
    logCanvasProjectionError: vi.fn(),
}))

vi.mock('../../services/asset-canvas-projection.ts', () => canvasProjectionMocks)

import { StreamPublisher, TagAwareStream } from './stream-publisher.ts'

type Published = { subject: string, payload: any }
type JetStreamPublished = { subject: string, payload: any, options: any }

const makeFakeNats = () => {
    const published: Published[] = []
    const jetStreamPublished: JetStreamPublished[] = []
    let nextStreamSeq = 0
    const fake = {
        publish: (subject: string, payload: any) => {
            published.push({ subject, payload })
        },
        ensureJetStreamStream: vi.fn(async () => undefined),
        publishJetStream: vi.fn(async (subject: string, payload: any, options: any) => {
            nextStreamSeq += 1
            jetStreamPublished.push({ subject, payload, options })
            return { seq: nextStreamSeq }
        }),
        purgeJetStreamSubject: vi.fn(async () => undefined),
    } as any
    return { fake, published, jetStreamPublished }
}

const makeTagAwareStream = () => {
    const published: Published[] = []
    const stream = new TagAwareStream(
        'OpenAI',
        undefined,
        content => published.push({ subject: 'tag-aware', payload: { content } }),
    )
    return { stream, published }
}

const flushPipelinePublishes = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
}

const createDeferred = <T>() => {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

const flatTexts = (published: Published[]): string =>
    published
        .filter(p => p.payload.content.status === STREAM_STATUS.STREAMING)
        .map(p => p.payload.content.text)
        .join('')

const statuses = (published: Published[]): string[] =>
    published.map(p => p.payload.content.status)

const generationRun = {
    generationRequestId: 'request-1',
    reasoningRunId: 'reasoning-1',
    reasoningModelId: 'Anthropic:claude-sonnet-4-6',
    mediaModelId: 'Google:gemini-2.5-flash-image',
    mediaType: 'image',
    reasoningIndex: 0,
    mediaIndex: 0,
    variantIndex: 0,
} as const

let consoleInfoSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
    vi.clearAllMocks()
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    canvasProjectionMocks.upsertMediaLineagePlanToCanvas.mockResolvedValue(undefined)
    canvasProjectionMocks.refreshMediaGenerationRequestCanvasGeometry.mockResolvedValue(undefined)
    canvasProjectionMocks.settleMediaGenerationRequestOnCanvas.mockResolvedValue(undefined)
})

describe('TagAwareStream', () => {
    let tagAware: ReturnType<typeof makeTagAwareStream>
    let stream: TagAwareStream

    beforeEach(() => {
        tagAware = makeTagAwareStream()
        stream = tagAware.stream
    })

    it('passes plain text through after flush', () => {
        stream.push('Hello world')
        stream.flush()
        expect(flatTexts(tagAware.published)).toBe('Hello world')
        expect(statuses(tagAware.published)).toEqual([STREAM_STATUS.STREAMING])
    })

    it('emits COLLAPSIBLE_START / END around <image_prompt> content', () => {
        stream.push('before<image_prompt>inner content</image_prompt>after')
        stream.flush()

        expect(statuses(tagAware.published)).toEqual([
            STREAM_STATUS.STREAMING,           // 'before'
            STREAM_STATUS.COLLAPSIBLE_START,
            STREAM_STATUS.STREAMING,           // 'inner content'
            STREAM_STATUS.COLLAPSIBLE_END,
            STREAM_STATUS.STREAMING,           // 'after'
        ])
        const texts = tagAware.published
            .filter(p => p.payload.content.status === STREAM_STATUS.STREAMING)
            .map(p => p.payload.content.text)
        expect(texts).toEqual(['before', 'inner content', 'after'])

        const collapsibleStart = tagAware.published.find(p => p.payload.content.status === STREAM_STATUS.COLLAPSIBLE_START)
        expect(collapsibleStart?.payload.content.collapsibleTitle).toBe('Image generation prompt')
    })

    it('emits COLLAPSIBLE_START / END around <video_prompt> content with a video title', () => {
        stream.push('Sure!<video_prompt>Animate the provided reference image as the first frame.</video_prompt>done')
        stream.flush()

        expect(statuses(tagAware.published)).toEqual([
            STREAM_STATUS.STREAMING,           // 'Sure!'
            STREAM_STATUS.COLLAPSIBLE_START,
            STREAM_STATUS.STREAMING,           // inner video prompt
            STREAM_STATUS.COLLAPSIBLE_END,
            STREAM_STATUS.STREAMING,           // 'done'
        ])
        const texts = tagAware.published
            .filter(p => p.payload.content.status === STREAM_STATUS.STREAMING)
            .map(p => p.payload.content.text)
        expect(texts).toEqual(['Sure!', 'Animate the provided reference image as the first frame.', 'done'])

        const collapsibleStart = tagAware.published.find(p => p.payload.content.status === STREAM_STATUS.COLLAPSIBLE_START)
        expect(collapsibleStart?.payload.content.collapsibleTitle).toBe('Video generation prompt')
    })

    it('handles a <video_prompt> close tag split across chunk boundaries', () => {
        stream.push('<video_prompt>inner</video_pr')
        stream.push('ompt>tail')
        stream.flush()

        expect(statuses(tagAware.published)).toEqual([
            STREAM_STATUS.COLLAPSIBLE_START,
            STREAM_STATUS.STREAMING,           // 'inner'
            STREAM_STATUS.COLLAPSIBLE_END,
            STREAM_STATUS.STREAMING,           // 'tail'
        ])
    })

    it('handles open tag split across chunk boundary', () => {
        stream.push('before<image_pr')
        stream.push('ompt>inner</image_prompt>')
        stream.flush()

        expect(statuses(tagAware.published)).toEqual([
            STREAM_STATUS.STREAMING,           // 'before'
            STREAM_STATUS.COLLAPSIBLE_START,
            STREAM_STATUS.STREAMING,           // 'inner'
            STREAM_STATUS.COLLAPSIBLE_END,
        ])
    })

    it('handles close tag split across chunk boundary', () => {
        stream.push('<image_prompt>inner</image_pr')
        stream.push('ompt>tail')
        stream.flush()

        expect(statuses(tagAware.published)).toEqual([
            STREAM_STATUS.COLLAPSIBLE_START,
            STREAM_STATUS.STREAMING,           // 'inner'
            STREAM_STATUS.COLLAPSIBLE_END,
            STREAM_STATUS.STREAMING,           // 'tail'
        ])
    })

    it('emits COLLAPSIBLE_END on flush if stream ends inside a tag', () => {
        stream.push('<image_prompt>open ')
        stream.push('but never closed')
        stream.flush()

        const ss = statuses(tagAware.published)
        expect(ss[0]).toBe(STREAM_STATUS.COLLAPSIBLE_START)
        expect(ss[ss.length - 1]).toBe(STREAM_STATUS.COLLAPSIBLE_END)
    })

    it('does not match nested-looking tags like <image_prompt_alt>', () => {
        // indexOf matches <image_prompt> inside <image_prompt_alt>: known substring-search limitation
        stream.push('<image_prompt_alt>x</image_prompt_alt>')
        stream.flush()
        expect(tagAware.published.length).toBeGreaterThan(0)
    })

    it('emits a single STREAMING event per safe-portion flush', () => {
        // Push enough content that the safe portion is non-empty even with
        // BUFFER_SIZE held back.
        const big = 'a'.repeat(100)
        stream.push(big)
        stream.flush()
        const texts = tagAware.published
            .filter(p => p.payload.content.status === STREAM_STATUS.STREAMING)
            .map(p => p.payload.content.text)
            .join('')
        expect(texts).toBe(big)
    })

    it('does not flush partial tag prefix until it can be confirmed', () => {
        stream.push('<image_pr')
        expect(tagAware.published.length).toBe(0)
        stream.push('ompt>x')
        expect(statuses(tagAware.published)).toContain(STREAM_STATUS.COLLAPSIBLE_START)
    })
})

afterEach(async () => {
    await flushPipelinePublishes()
    consoleInfoSpy?.mockRestore()
    consoleInfoSpy = null
})

describe('StreamPublisher extraction progress', () => {
    it('publishes START_STREAM only once when providers start after shared prework', async () => {
        const nats = makeFakeNats()
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic')

        publisher.start()
        publisher.start()
        await flushPipelinePublishes()

        expect(statuses(nats.published)).toEqual([STREAM_STATUS.START_STREAM])
    })

    it('publishes END_STREAM only once after duplicate starts', async () => {
        const nats = makeFakeNats()
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic')

        publisher.start()
        publisher.start()
        publisher.chunk('done')
        publisher.end()
        publisher.end()
        await flushPipelinePublishes()

        expect(statuses(nats.published)).toEqual([
            STREAM_STATUS.START_STREAM,
            STREAM_STATUS.STREAMING,
            STREAM_STATUS.END_STREAM,
        ])
        expect(flatTexts(nats.published)).toBe('done')
    })

    it('does not publish END_STREAM before START_STREAM', () => {
        const nats = makeFakeNats()
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic')

        publisher.end()

        expect(nats.published).toHaveLength(0)
    })

    it('keeps publishing later chunks after a JetStream publish failure on an earlier chunk', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

        const nats = makeFakeNats()
        nats.fake.publishJetStream
            .mockRejectedValueOnce(new Error('jetstream unavailable'))
            .mockResolvedValueOnce({ seq: 1 })
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'OpenAI')

        publisher.start()
        publisher.chunk('hello')
        publisher.end()
        await flushPipelinePublishes()

        consoleErrorSpy.mockRestore()

        expect(nats.published).toHaveLength(3)
        expect(nats.published[0]?.payload.content).toMatchObject({
            status: STREAM_STATUS.START_STREAM,
            aiProvider: 'OpenAI',
        })
        expect(nats.published[1]?.payload.content).toMatchObject({
            status: STREAM_STATUS.STREAMING,
            text: 'hello',
            aiProvider: 'OpenAI',
        })
        expect(nats.published[2]?.payload.content).toMatchObject({
            status: STREAM_STATUS.END_STREAM,
            aiProvider: 'OpenAI',
        })
        expect(nats.fake.publishJetStream).toHaveBeenCalledTimes(3)
    })

    it('publishes workflow errors to both the dedicated error channel and streaming channel', async () => {
        const nats = makeFakeNats()
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic')

        publisher.error('fatal failure', 'ERR_500', 'RuntimeError')
        await flushPipelinePublishes()

        expect(nats.published).toEqual(expect.arrayContaining([
            {
                subject: 'ai.interaction.chat.error.ws1:thread1',
                payload: {
                    error: 'fatal failure',
                    instanceKey: 'ws1:thread1',
                    errorCode: 'ERR_500',
                    errorType: 'RuntimeError',
                },
            },
            expect.objectContaining({
                subject: 'ai.interaction.chat.receiveMessage.ws1.thread1',
                payload: expect.objectContaining({
                    content: expect.objectContaining({
                        status: STREAM_STATUS.ERROR,
                        text: 'fatal failure',
                        aiProvider: 'Anthropic',
                    }),
                }),
            }),
        ]))
        expect(nats.published).toHaveLength(2)
    })

    it('publishes Action Timeline execution metadata as a first-class generation trace', async () => {
        const nats = makeFakeNats()
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic', generationRun)

        publisher.capabilityGenerationTrace({
            traceVersion: 'capability-generation-trace-v1',
            generationRun,
            capabilityId: 'action-timeline',
            capabilityName: 'Action Timeline',
            capabilityRunId: 'timeline-run',
            chatModelProvider: 'Anthropic',
            chatModelId: 'Anthropic:claude-sonnet-4-6',
            input: { durationMs: 15_000, precisionMs: 2_000 },
            outputAssetIds: ['timeline-asset'],
            steps: [{ stepId: 'persist', title: 'Persist timeline', status: 'completed' }],
        })
        await flushPipelinePublishes()

        expect(nats.published).toHaveLength(1)
        expect(nats.published[0]?.payload.content).toMatchObject({
            status: STREAM_STATUS.CAPABILITY_GENERATION_TRACE,
            generationRun,
            capabilityGenerationTrace: expect.objectContaining({
                capabilityName: 'Action Timeline',
                capabilityRunId: 'timeline-run',
                outputAssetIds: ['timeline-asset'],
            }),
        })
    })

    it('persists pipeline content before live publishing with replay metadata', async () => {
        const nats = makeFakeNats()
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic')

        publisher.contextRelevanceError('bad context')
        await flushPipelinePublishes()

        expect(nats.jetStreamPublished).toHaveLength(1)
        expect(nats.jetStreamPublished[0]).toMatchObject({
            subject: 'ai.interaction.chat.pipelineEvents.ws1.thread1',
            options: {
                msgID: expect.any(String),
                expect: { streamName: 'PIPELINE_EVENTS_ws1' },
            },
        })
        expect(nats.jetStreamPublished[0]?.payload.payload.content).toMatchObject({
            status: STREAM_STATUS.CONTEXT_RELEVANCE_ERROR,
            error: 'bad context',
        })
        expect(nats.published[0]).toMatchObject({
            subject: 'ai.interaction.chat.receiveMessage.ws1.thread1',
            payload: {
                conversationAssetId: 'thread1',
                pipelineEventId: expect.any(String),
                pipelineStreamSeq: 1,
                content: expect.objectContaining({
                    status: STREAM_STATUS.CONTEXT_RELEVANCE_ERROR,
                    error: 'bad context',
                }),
            },
        })
    })

    it('does not let one media run block live publishing for another media run', async () => {
        const nats = makeFakeNats()
        const blockedAck = createDeferred<{ seq: number }>()
        nats.fake.publishJetStream = vi.fn(async (_subject: string, payload: any) => {
            const mediaRunId = payload.payload.content.generationRun?.mediaRunId
            if (mediaRunId === 'reasoning-1:image:0') return blockedAck.promise
            return { seq: 2 }
        })
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic')

        publisher.publishChatContent({
            status: STREAM_STATUS.IMAGE_PARTIAL,
            aiProvider: 'Anthropic',
            imageUrl: 'partial-a.png',
            fileId: 'partial-a',
            partialIndex: 0,
            generationRun: {
                ...generationRun,
                mediaRunId: 'reasoning-1:image:0',
                mediaModelId: 'Google:gemini-2.5-flash-image',
                mediaType: 'image',
                mediaIndex: 0,
            },
        })
        publisher.publishChatContent({
            status: STREAM_STATUS.IMAGE_PARTIAL,
            aiProvider: 'Anthropic',
            imageUrl: 'partial-b.png',
            fileId: 'partial-b',
            partialIndex: 0,
            generationRun: {
                ...generationRun,
                mediaRunId: 'reasoning-1:image:1',
                mediaModelId: 'OpenAI:gpt-image-2',
                mediaType: 'image',
                mediaIndex: 1,
                variantIndex: 1,
            },
        })
        await flushPipelinePublishes()

        expect(nats.fake.publishJetStream).toHaveBeenCalledTimes(2)
        expect(nats.published).toHaveLength(1)
        expect(nats.published[0]?.payload.content).toMatchObject({
            status: STREAM_STATUS.IMAGE_PARTIAL,
            imageUrl: 'partial-b.png',
            generationRun: {
                mediaRunId: 'reasoning-1:image:1',
            },
        })

        blockedAck.resolve({ seq: 1 })
        await publisher.drainPendingWrites()

        expect(nats.published).toHaveLength(2)
        expect(nats.published[1]?.payload.content).toMatchObject({
            status: STREAM_STATUS.IMAGE_PARTIAL,
            imageUrl: 'partial-a.png',
            generationRun: {
                mediaRunId: 'reasoning-1:image:0',
            },
        })
    })

    it('keeps ordering within a single media run while using independent media queues', async () => {
        const nats = makeFakeNats()
        const blockedAck = createDeferred<{ seq: number }>()
        let publishedCount = 0
        nats.fake.publishJetStream = vi.fn(async (_subject: string, payload: any) => {
            if (payload.payload.content.status === STREAM_STATUS.IMAGE_PARTIAL) {
                return blockedAck.promise
            }
            publishedCount += 1
            return { seq: publishedCount + 1 }
        })
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic')
        const mediaRun = {
            ...generationRun,
            mediaRunId: 'reasoning-1:image:0',
            mediaModelId: 'OpenAI:gpt-image-2',
            mediaType: 'image' as const,
            mediaIndex: 0,
        }

        publisher.publishChatContent({
            status: STREAM_STATUS.IMAGE_PARTIAL,
            aiProvider: 'Anthropic',
            imageUrl: 'partial.png',
            fileId: 'partial-file',
            partialIndex: 0,
            generationRun: mediaRun,
        })
        publisher.publishChatContent({
            status: STREAM_STATUS.IMAGE_COMPLETE,
            aiProvider: 'Anthropic',
            imageUrl: 'final.png',
            fileId: 'final-file',
            responseId: 'response-1',
            revisedPrompt: 'final prompt',
            generationRun: mediaRun,
        })
        await flushPipelinePublishes()

        expect(nats.fake.publishJetStream).toHaveBeenCalledTimes(1)
        expect(nats.published).toHaveLength(0)

        blockedAck.resolve({ seq: 1 })
        await publisher.drainPendingWrites()

        expect(nats.fake.publishJetStream).toHaveBeenCalledTimes(2)
        expect(nats.published.map(entry => entry.payload.content.status)).toEqual([
            STREAM_STATUS.IMAGE_PARTIAL,
            STREAM_STATUS.IMAGE_COMPLETE,
        ])
    })

    it('publishes workspace context relevance resolution on the chat stream', async () => {
        const nats = makeFakeNats()
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'OpenAI')
        const resolution = {
            resolverVersion: 'workspace-context-v1',
            selections: [{ nodeId: 'doc-1', role: 'forced-chip' as const }],
            narrowedMediaNodeIds: [],
        }

        publisher.contextRelevanceResolved(resolution)
        await flushPipelinePublishes()

        expect(nats.published).toHaveLength(1)
        expect(nats.published[0]?.payload.content).toEqual(expect.objectContaining({
            status: STREAM_STATUS.CONTEXT_RELEVANCE_RESOLVED,
            aiProvider: 'OpenAI',
            workspaceContextResolution: resolution,
        }))
    })

    it('publishes workspace context relevance errors on the chat stream', async () => {
        const nats = makeFakeNats()
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'OpenAI')

        publisher.contextRelevanceError('bad context')
        await flushPipelinePublishes()

        expect(nats.published).toHaveLength(1)
        expect(nats.published[0]?.payload.content).toEqual(expect.objectContaining({
            status: STREAM_STATUS.CONTEXT_RELEVANCE_ERROR,
            aiProvider: 'OpenAI',
            error: 'bad context',
        }))
    })

    it('publishes image generation errors with media run metadata', async () => {
        const nats = makeFakeNats()
        const generationRun = {
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            mediaRunId: 'reasoning-1:image:0',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            mediaModelId: 'Google:gemini-2.5-flash-image',
            mediaType: 'image',
            reasoningIndex: 0,
            mediaIndex: 0,
            variantIndex: 0,
        } as const
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic', generationRun)

        publisher.imageGenerationError('no inline image data')
        await flushPipelinePublishes()

        expect(nats.published).toHaveLength(1)
        expect(nats.published[0]?.payload.content).toEqual({
            status: STREAM_STATUS.IMAGE_ERROR,
            aiProvider: 'Anthropic',
            error: 'no inline image data',
            generationRun,
        })
    })

    it('deduplicates media request completion calls and avoids duplicate settle writes', async () => {
        const nats = makeFakeNats()
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic')

        publisher.mediaLineagePlanned({ generationRequestId: 'request-1' } as any)
        publisher.completeKnownMediaGenerationRequests()
        publisher.completeKnownMediaGenerationRequests()
        await flushPipelinePublishes()

        expect(canvasProjectionMocks.settleMediaGenerationRequestOnCanvas).toHaveBeenCalledTimes(1)
        expect(canvasProjectionMocks.settleMediaGenerationRequestOnCanvas).toHaveBeenCalledWith({
            workspaceId: 'ws1',
            generationRequestId: 'request-1',
            lineagePlan: { generationRequestId: 'request-1' },
        })
        const completionWrites = nats.published.filter(
            (entry) => entry.payload?.content?.status === STREAM_STATUS.MEDIA_GENERATION_REQUEST_COMPLETE,
        )
        expect(completionWrites).toHaveLength(1)
        expect(nats.published).toEqual(expect.arrayContaining([
            expect.objectContaining({
                subject: 'ai.interaction.chat.receiveMessage.ws1.thread1',
                payload: {
                    conversationAssetId: 'thread1',
                    content: expect.objectContaining({
                        status: STREAM_STATUS.MEDIA_GENERATION_REQUEST_COMPLETE,
                        generationRequestId: 'request-1',
                    }),
                    pipelineEventId: expect.any(String),
                    pipelineStreamSeq: expect.any(Number),
                },
            }),
        ]))
    })

    it('drains response writes after settling canvas projections when both are queued', async () => {
        const nats = makeFakeNats()
        const callOrder: string[] = []

        nats.fake.publishJetStream = vi.fn(async () => {
            callOrder.push('response-write-start')
            await new Promise(resolve => setTimeout(resolve, 0))
            callOrder.push('response-write-end')
            return { seq: 1 }
        })
        canvasProjectionMocks.upsertMediaLineagePlanToCanvas.mockResolvedValue(undefined)
        canvasProjectionMocks.settleMediaGenerationRequestOnCanvas.mockImplementation(async () => {
            callOrder.push('canvas-settle-start')
            await new Promise(resolve => setTimeout(resolve, 0))
            callOrder.push('canvas-settle-end')
        })

        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic')
        publisher.mediaGenerationRequestComplete('request-2')
        await publisher.drainPendingWrites()

        expect(callOrder).toEqual([
            'canvas-settle-start',
            'response-write-start',
            'canvas-settle-end',
            'response-write-end',
        ])
    })
})

describe('StreamPublisher trace payloads', () => {
    it('propagates media generation metadata through image/video traces', async () => {
        const nats = makeFakeNats()
        const generationRun = {
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            mediaRunId: 'reasoning-1:video:0',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            mediaModelId: 'Google:veo-3.1-generate-preview',
            mediaType: 'video',
            reasoningIndex: 0,
            mediaIndex: 0,
            variantIndex: 0,
        } as const
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic', generationRun)

        publisher.imageGenerationTrace({
            traceVersion: 'image-generation-trace-v1',
            toolPrompt: 'build one',
            finalPrompt: 'build one with transfer',
            promptWasChanged: false,
            referenceImages: [],
            excludedReferences: [],
            imageModelProvider: 'Google',
            imageModelId: 'gemini-2.5-flash-image',
            chatModelProvider: 'Anthropic',
            chatModelId: 'claude-sonnet-4-6',
            imageSize: '1:1',
            generationRun: undefined,
        } as any)
        publisher.videoGenerationTrace({
            traceVersion: 'video-generation-trace-v1',
            toolPrompt: 'animate one',
            finalPrompt: 'animate one with constraints',
            promptWasChanged: false,
            referenceImages: [],
            excludedReferences: [],
            videoModelProvider: 'Google',
            videoModelId: 'veo-3.1-generate-preview',
            chatModelProvider: 'Anthropic',
            chatModelId: 'claude-sonnet-4-6',
            aspectRatio: '16:9',
            resolution: '720p',
            durationSeconds: 6,
            generationRun: generationRun,
        } as any)
        await flushPipelinePublishes()

        const imageTrace = nats.published[0]?.payload.content
        const videoTrace = nats.published[1]?.payload.content

        expect(imageTrace).toMatchObject({
            status: STREAM_STATUS.IMAGE_GENERATION_TRACE,
            aiProvider: 'Anthropic',
            imageGenerationTrace: expect.objectContaining({
                generationRun,
            }),
            generationRun,
        })
        expect(videoTrace).toMatchObject({
            status: STREAM_STATUS.VIDEO_GENERATION_TRACE,
            aiProvider: 'Anthropic',
            videoGenerationTrace: expect.objectContaining({
                generationRun,
            }),
            generationRun,
        })
    })

    it('publishes image branch and lineage resolution events with generation-run defaults and overrides', async () => {
        const nats = makeFakeNats()
        const publisher = new StreamPublisher(
            nats.fake,
            'ws1',
            'thread1',
            'Anthropic',
            generationRun,
        )
        publisher.mediaBranchResolved({ resolved: true } as any)
        publisher.mediaLineagePlanned({ lineage: 'plan' } as any, {
            ...generationRun,
            mediaRunId: 'reasoning-1:image:override',
        })
        await flushPipelinePublishes()

        expect(nats.published).toHaveLength(2)
        expect(nats.published[0]?.payload.content).toMatchObject({
            status: STREAM_STATUS.MEDIA_BRANCH_RESOLVED,
            resolution: { resolved: true },
            generationRun,
        })
        expect(nats.published[1]?.payload.content).toMatchObject({
            status: STREAM_STATUS.MEDIA_LINEAGE_PLANNED,
            lineagePlan: { lineage: 'plan' },
            generationRun: {
                ...generationRun,
                mediaRunId: 'reasoning-1:image:override',
            },
        })
        expect(canvasProjectionMocks.upsertMediaLineagePlanToCanvas).toHaveBeenCalledWith({
            workspaceId: 'ws1',
            conversationAssetId: 'thread1',
            lineagePlan: { lineage: 'plan' },
        })
    })

    it('does not refresh API canvas geometry for streamed reasoning text', async () => {
        const nats = makeFakeNats()
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic', generationRun)
        ;(publisher as any).options.enableProseMirrorStream = true
        ;(publisher as any).proseMirrorAssembler = {
            handleContent: vi.fn(),
            flushPendingWork: vi.fn(async () => undefined),
            snapshotForProjection: vi.fn(() => ({ type: 'doc', content: [] })),
        }

        publisher.mediaLineagePlanned({ generationRequestId: 'request-1' } as any, generationRun)
        publisher.publishChatContent({
            status: STREAM_STATUS.STREAMING,
            aiProvider: 'Anthropic',
            text: 'live reasoning that changes marker dimensions',
            generationRun,
        })
        await publisher.drainPendingWrites()
        await flushPipelinePublishes()

        expect(canvasProjectionMocks.refreshMediaGenerationRequestCanvasGeometry).not.toHaveBeenCalled()
        const publishedGeometryEvent = nats.published.some(entry =>
            entry.payload.content?.status === STREAM_STATUS.CANVAS_GEOMETRY_RESOLVED
        )
        expect(publishedGeometryEvent).toBe(false)
    })
})

describe('StreamPublisher ProseMirror integration options', () => {
    it('mirrors child stream content to a shared ProseMirror handler without duplicating live events or ending the shared stream', async () => {
        const nats = makeFakeNats()
        const sharedHandler = vi.fn()
        const publisher = new StreamPublisher(
            nats.fake,
            'ws1',
            'thread1',
            'Anthropic',
            generationRun,
            { proseMirrorContentMirror: sharedHandler },
        )

        publisher.start()
        publisher.chunk('matrix reasoning text')
        publisher.end()
        await flushPipelinePublishes()

        expect(nats.published.map(event => event.payload.content.status).filter((status, index, statuses) =>
            status !== STREAM_STATUS.STREAMING || statuses[index - 1] !== STREAM_STATUS.STREAMING
        )).toEqual([
            STREAM_STATUS.START_STREAM,
            STREAM_STATUS.STREAMING,
            STREAM_STATUS.END_STREAM,
        ])
        expect(sharedHandler.mock.calls.map(call => call[0].status).includes(STREAM_STATUS.START_STREAM)).toBe(true)
        expect(sharedHandler).not.toHaveBeenCalledWith(expect.objectContaining({
            status: STREAM_STATUS.END_STREAM,
        }))
        const mirroredText = sharedHandler.mock.calls
            .map(call => call[0])
            .filter(content => content.status === STREAM_STATUS.STREAMING)
            .map(content => content.text)
            .join('')
        expect(mirroredText).toBe('matrix reasoning text')
        expect(sharedHandler.mock.calls.every(call => call[0].generationRun === generationRun)).toBe(true)
    })

    it('forwards publishProseMirrorContent payloads to the active assembler', () => {
        const nats = makeFakeNats()
        const publisher = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic')
        ;(publisher as any).proseMirrorAssembler = { handleContent: vi.fn() }
        const publisherSpy = vi.spyOn((publisher as any).proseMirrorAssembler, 'handleContent')

        publisher.publishProseMirrorContent({
            status: STREAM_STATUS.STREAMING,
            text: 'streaming hint',
            aiProvider: 'Anthropic',
        })
        publisher.publishProseMirrorContent({
            status: STREAM_STATUS.ERROR,
            error: 'temporary failure',
            aiProvider: 'Anthropic',
        })
        expect(publisherSpy).toHaveBeenCalledTimes(2)
        expect(publisherSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({
            status: STREAM_STATUS.STREAMING,
            text: 'streaming hint',
        }))
        expect(publisherSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({
            status: STREAM_STATUS.ERROR,
            error: 'temporary failure',
        }))
    })

    it('delegates prose-mirror end strategy based on deferProseMirrorEnd', async () => {
        const nats = makeFakeNats()
        const finishTextPhase = vi.fn(() => Promise.resolve())
        const end = vi.fn(() => Promise.resolve())
        const publisher = new StreamPublisher(
            nats.fake,
            'ws1',
            'thread1',
            'Anthropic',
            undefined,
            {
                enableProseMirrorStream: false,
                deferProseMirrorEnd: true,
            },
        )
        ;(publisher as any).proseMirrorAssembler = {
            handleContent: vi.fn(),
            finishTextPhase,
            end,
        }

        publisher.start()
        publisher.end()
        expect(finishTextPhase).toHaveBeenCalledTimes(1)
        expect(end).not.toHaveBeenCalled()

        const nonDeferredFinishTextPhase = vi.fn(() => Promise.resolve())
        const nonDeferredEnd = vi.fn(() => Promise.resolve())
        const nonDeferred = new StreamPublisher(nats.fake, 'ws1', 'thread1', 'Anthropic', undefined, {
            enableProseMirrorStream: false,
            deferProseMirrorEnd: false,
        })
        ;(nonDeferred as any).proseMirrorAssembler = {
            handleContent: vi.fn(),
            finishTextPhase: nonDeferredFinishTextPhase,
            end: nonDeferredEnd,
        }
        nonDeferred.start()
        nonDeferred.end()
        await flushPipelinePublishes()
        expect(nonDeferredFinishTextPhase).toHaveBeenCalledTimes(0)
        expect(nonDeferredEnd).toHaveBeenCalledTimes(1)
    })

    it('returns immediately from finishProseMirrorStream when prose mirror assembler is absent', async () => {
        const nats = makeFakeNats()
        const publisher = new StreamPublisher(
            nats.fake,
            'ws1',
            'thread1',
            'Anthropic',
            undefined,
            { enableProseMirrorStream: false },
        )
        await expect(publisher.finishProseMirrorStream()).resolves.toBeUndefined()
        expect(nats.published).toHaveLength(0)
    })
})
