'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STREAM_STATUS, type MediaGenerationRunMeta, type ProviderName } from '@lixpi/constants'

import * as debugTools from '@lixpi/debug-tools'

import { BaseProvider, type BaseProviderDeps } from './base-provider.ts'
import { StreamPublisher } from '../graph/stream-publisher.ts'
import type { AiModelMetaInfo, ProviderState } from '../graph/state.ts'
import { validateImagePrompt } from '../tools/image-generation.ts'

type Published = { subject: string, payload: any }

const makeFakeNats = () => {
    const published: Published[] = []
    let nextStreamSeq = 0
    const fake = {
        publish: (subject: string, payload: any) => {
            published.push({ subject, payload })
        },
        ensureJetStreamStream: vi.fn(async () => undefined),
        publishJetStream: vi.fn(async () => {
            nextStreamSeq += 1
            return { seq: nextStreamSeq }
        }),
        purgeJetStreamSubject: vi.fn(async () => undefined),
    } as any
    return { fake, published }
}

const flushPipelinePublishes = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
}

const makeImageModel = (model: string): AiModelMetaInfo => ({
    provider: 'Google',
    model,
    modelVersion: model,
})

let debugInfoSpy: ReturnType<typeof vi.spyOn> | null = null
let debugWarnSpy: ReturnType<typeof vi.spyOn> | null = null
let debugErrSpy: ReturnType<typeof vi.spyOn> | null = null
let consoleInfoSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
    debugInfoSpy = vi.spyOn(debugTools, 'info').mockImplementation(() => undefined)
    debugWarnSpy = vi.spyOn(debugTools, 'warn').mockImplementation(() => undefined)
    debugErrSpy = vi.spyOn(debugTools, 'err').mockImplementation(() => undefined)
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
    debugInfoSpy?.mockRestore()
    debugInfoSpy = null
    debugWarnSpy?.mockRestore()
    debugWarnSpy = null
    debugErrSpy?.mockRestore()
    debugErrSpy = null
    consoleInfoSpy?.mockRestore()
    consoleInfoSpy = null
})

const createFanoutState = (overrides: Partial<ProviderState> = {}): ProviderState => ({
    workspaceId: 'ws-1',
    aiChatThreadId: 'thread-1',
    instanceKey: 'ws-1:thread-1',
    provider: 'Anthropic',
    messages: [{ role: 'user', content: 'Create something with reference images.' }],
    aiModelMetaInfo: { provider: 'Anthropic', model: 'claude-sonnet-4-6', modelVersion: 'claude-sonnet-4-6' },
    eventMeta: {},
    modelVersion: 'claude-sonnet-4-6',
    temperature: 0.7,
    streamActive: false,
    aiRequestReceivedAt: 1,
    imageSize: 'auto',
    generatedImagePrompt: 'Paint a cat with brush texture.',
    generatedVideoPrompt: undefined,
    generationRun: {
        generationRequestId: 'request-1',
        reasoningRunId: 'reasoning-1',
        reasoningModelId: 'Anthropic:claude-sonnet-4-6',
        reasoningIndex: 0,
    },
    mediaFanoutPlan: {
        generationRequestId: 'request-1',
        imageModels: [
            { provider: 'Google', model: 'gemini-2.5-flash-image', modelVersion: 'gemini-2.5-flash-image' },
            { provider: 'Google', model: 'imagen-4.0-generate-001', modelVersion: 'imagen-4.0-generate-001' },
        ],
        videoModels: [
            { provider: 'Google', model: 'veo-3.1-generate-preview', modelVersion: 'veo-3.1-generate-preview' },
            { provider: 'Google', model: 'seedance-1', modelVersion: 'seedance-1' },
        ],
        imageSize: 'auto',
    },
    ...overrides,
})

class TestProvider extends BaseProvider {
    readonly providerName: ProviderName = 'Anthropic'

    protected async streamImpl(): Promise<Partial<ProviderState>> {
        return {}
    }

    async runImageGeneration(state: ProviderState): Promise<Partial<ProviderState>> {
        this.streamPublisher = new StreamPublisher(
            this.deps.natsService,
            state.workspaceId,
            state.aiChatThreadId,
            this.providerName,
            state.generationRun,
        )
        return this.executeImageGeneration(state)
    }
}

class FailingStreamProvider extends BaseProvider {
    readonly providerName: ProviderName = 'Anthropic'

    protected async streamImpl(): Promise<Partial<ProviderState>> {
        throw new Error('streamer exploded')
    }
}

describe('BaseProvider image fanout errors', () => {
    it('live-publishes mirrored media router content without duplicating the shared ProseMirror mirror', async () => {
        const nats = makeFakeNats()
        const deps = {
            natsService: nats.fake,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        } as unknown as BaseProviderDeps
        const provider = new TestProvider('ws1:thread1:request-1:reasoning:0', deps)
        const sharedMirror = vi.fn()
        const mediaRun: MediaGenerationRunMeta = {
            generationRequestId: 'request-1',
            reasoningRunId: 'request-1:reasoning:0',
            mediaRunId: 'request-1:reasoning:0:image:2',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            mediaModelId: 'OpenAI:gpt-image-2',
            mediaType: 'image',
            reasoningIndex: 0,
            mediaIndex: 2,
            variantIndex: 2,
        }
        ;(provider as any).streamPublisher = new StreamPublisher(
            nats.fake,
            'ws1',
            'thread1',
            'Anthropic',
            mediaRun,
            { proseMirrorContentMirror: sharedMirror },
        )
        ;(provider as any).pipelineProseMirrorContentHandler = sharedMirror

        ;(provider as any).publishPipelineProseMirrorContent({
            status: STREAM_STATUS.IMAGE_PARTIAL,
            aiProvider: 'Anthropic',
            imageUrl: 'partial.png',
            fileId: 'partial-file',
            partialIndex: 1,
            generationRun: mediaRun,
        })
        await (provider as any).streamPublisher.drainPendingWrites()

        expect(sharedMirror).toHaveBeenCalledTimes(1)
        expect(sharedMirror).toHaveBeenCalledWith(expect.objectContaining({
            status: STREAM_STATUS.IMAGE_PARTIAL,
            imageUrl: 'partial.png',
            generationRun: mediaRun,
        }))
        expect(nats.published).toHaveLength(1)
        expect(nats.published[0]?.payload.content).toMatchObject({
            status: STREAM_STATUS.IMAGE_PARTIAL,
            imageUrl: 'partial.png',
            fileId: 'partial-file',
            partialIndex: 1,
            generationRun: mediaRun,
        })
    })

    it('does not live-publish mirrored non-media content from matrix children', async () => {
        const nats = makeFakeNats()
        const deps = {
            natsService: nats.fake,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        } as unknown as BaseProviderDeps
        const provider = new TestProvider('ws1:thread1:request-1:reasoning:0', deps)
        const sharedMirror = vi.fn()
        ;(provider as any).streamPublisher = new StreamPublisher(
            nats.fake,
            'ws1',
            'thread1',
            'Anthropic',
        )
        ;(provider as any).pipelineProseMirrorContentHandler = sharedMirror

        ;(provider as any).publishPipelineProseMirrorContent({
            status: STREAM_STATUS.STREAMING,
            aiProvider: 'Anthropic',
            text: 'shared reasoning text',
        })
        await (provider as any).streamPublisher.drainPendingWrites()

        expect(sharedMirror).toHaveBeenCalledTimes(1)
        expect(nats.published).toHaveLength(0)
    })

    it('publishes IMAGE_ERROR for the failed media child while returning successful siblings', async () => {
        const nats = makeFakeNats()
        const runImageRouter = vi.fn(async (state: ProviderState): Promise<Partial<ProviderState>> => {
            if (state.generationRun?.mediaIndex === 0) {
                return { error: 'Google image model returned no inline image data.' }
            }
            return { generatedImages: ['final-image-base64'] }
        })
        const deps = {
            natsService: nats.fake,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter,
            runVideoRouter: vi.fn(),
        } as unknown as BaseProviderDeps
        const provider = new TestProvider('ws1:thread1', deps)
        const generationRun: MediaGenerationRunMeta = {
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            reasoningIndex: 0,
        }
        const state = {
            workspaceId: 'ws1',
            aiChatThreadId: 'thread1',
            instanceKey: 'ws1:thread1',
            provider: 'Anthropic',
            modelVersion: 'claude-sonnet-4-6',
            aiModelMetaInfo: makeImageModel('claude-sonnet-4-6'),
            messages: [{ role: 'user', content: 'Make an image.' }],
            generatedImagePrompt: 'Make an image.',
            imageSize: 'auto',
            generationRun,
            mediaFanoutPlan: {
                generationRequestId: 'request-1',
                imageModels: [
                    makeImageModel('gemini-2.5-flash-image'),
                    makeImageModel('gemini-2.5-flash-image-preview'),
                ],
                videoModels: [],
                imageSize: 'auto',
            },
            eventMeta: {},
        } as ProviderState

        const result = await provider.runImageGeneration(state)
        await flushPipelinePublishes()

        expect(result).toEqual({ generatedImages: ['final-image-base64'] })
        expect(runImageRouter).toHaveBeenCalledTimes(2)
        const imageErrorEvents = nats.published.filter((item) =>
            item.payload.content.status === STREAM_STATUS.IMAGE_ERROR
        )
        expect(imageErrorEvents).toHaveLength(1)
        expect(imageErrorEvents[0]?.payload.content).toMatchObject({
            status: STREAM_STATUS.IMAGE_ERROR,
            aiProvider: 'Anthropic',
            error: 'Google image model returned no inline image data.',
            generationRun: {
                generationRequestId: 'request-1',
                reasoningRunId: 'reasoning-1',
                mediaRunId: 'reasoning-1:image:0',
                mediaModelId: 'Google:gemini-2.5-flash-image',
                mediaType: 'image',
                mediaIndex: 0,
                variantIndex: 0,
            },
        })
    })
})

describe('BaseProvider request validation', () => {
    it('denies metrics admission before resolving or persisting media lineage', async () => {
        const nats = makeFakeNats()
        const metricsCheck = vi.fn().mockResolvedValue({ approved: false, reason: 'metrics_unreachable' })
        const provider = new TestProvider('ws-1:thread-1', {
            natsService: nats.fake,
            usageReporter: {} as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
            metrics: { enabled: true, check: metricsCheck },
        } as BaseProviderDeps)
        const planMediaBranchLineage = vi.spyOn(provider as any, 'planMediaBranchLineage')
        const streamTokens = vi.spyOn(provider as any, 'streamTokens')

        const result = await provider.process({
            workspaceId: 'ws-1',
            aiChatThreadId: 'thread-1',
            aiModelMetaInfo: { provider: 'Anthropic', model: 'claude', modelVersion: 'claude' },
            messages: [{ role: 'user', content: 'make a picture' }],
            enableImageGeneration: true,
            eventMeta: { userId: 'user-1', organizationId: 'organization-1' },
        })

        expect(metricsCheck).toHaveBeenCalledOnce()
        expect(planMediaBranchLineage).not.toHaveBeenCalled()
        expect(streamTokens).not.toHaveBeenCalled()
        expect(result.error).toContain('metrics_unreachable')
    })

    it('validates required model and thread identity fields', async () => {
        const deps = {
            natsService: { publish: vi.fn() } as any,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {
                reportTokensUsage: vi.fn(),
                reportImageUsage: vi.fn(),
                reportVideoUsage: vi.fn(),
            } as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        } as BaseProviderDeps

        const provider = new TestProvider('ws-1:thread-1', deps)
        const baseState = {
            messages: [{ role: 'user', content: 'make it blue' }],
            aiModelMetaInfo: {},
            eventMeta: {},
            workspaceId: '',
            aiChatThreadId: '',
            instanceKey: 'ws-1:thread-1',
            provider: 'Anthropic',
            modelVersion: '',
            temperature: 0.7,
            streamActive: false,
            aiRequestReceivedAt: Date.now(),
        } as ProviderState

        await expect((provider as any).validateRequest(baseState)).rejects.toThrow('modelVersion is required')
        await expect((provider as any).validateRequest({
            ...baseState,
            modelVersion: 'claude',
            workspaceId: 'ws-1',
        })).rejects.toThrow('aiChatThreadId is required')
    })

    it('returns provider state with validation errors without throwing from process', async () => {
        const deps = {
            natsService: { publish: vi.fn() } as any,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {
                reportTokensUsage: vi.fn(),
                reportImageUsage: vi.fn(),
                reportVideoUsage: vi.fn(),
            } as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        } as BaseProviderDeps

        const provider = new TestProvider('ws-1:thread-1', deps)
        const result = await provider.process({
            workspaceId: 'ws-1',
            aiChatThreadId: '',
            aiModelMetaInfo: { provider: 'Anthropic', model: 'Claude', modelVersion: 'claude' },
            messages: [{ role: 'user', content: 'make it green' }],
        })

        expect(result.error).toBe('aiChatThreadId is required')
        expect(result.streamActive).toBe(false)
    })
})

describe('BaseProvider routing', () => {
    it('prioritizes generate_video over generate_image when both prompts exist', async () => {
        const provider = new TestProvider('ws-1:thread-1', {
            natsService: { publish: vi.fn() } as any,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        })

        expect((provider as any).routeAfterStream({ generatedImagePrompt: 'paint', generatedVideoPrompt: 'animate' } as any))
            .toBe('generate_video')
        expect((provider as any).routeAfterStream({ generatedImagePrompt: 'paint' } as any)).toBe('generate_image')
        expect((provider as any).routeAfterStream({} as any)).toBe('skip')
    })

    it('emits MEDIA_GENERATION_SKIPPED when lineage is planned but no media prompt was generated', () => {
        const nats = makeFakeNats()
        const provider = new TestProvider('ws-1:thread-1', {
            natsService: nats.fake,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        })
        ;(provider as any).streamPublisher = new StreamPublisher(
            nats.fake,
            'ws-1',
            'thread-1',
            'Anthropic',
        )
        const skippedSpy = vi.spyOn((provider as any).streamPublisher, 'mediaGenerationSkipped')

        expect((provider as any).routeAfterStream({
            mediaBranchLineagePlan: { generationRequestId: 'request-matrix-1' },
        } as any)).toBe('skip')

        expect(skippedSpy).toHaveBeenCalledTimes(1)
        expect(skippedSpy).toHaveBeenCalledWith('request-matrix-1')
    })

    it('does not emit MEDIA_GENERATION_SKIPPED when no lineage plan is available', () => {
        const provider = new TestProvider('ws-1:thread-1', {
            natsService: { publish: vi.fn() } as any,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        })

        expect((provider as any).routeAfterStream({} as any)).toBe('skip')
        expect((provider as any).streamPublisher).toBeUndefined()
    })

    it('does not call MEDIA_GENERATION_SKIPPED when lineage is not available', () => {
        const nats = makeFakeNats()
        const provider = new TestProvider('ws-1:thread-1', {
            natsService: nats.fake,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        })
        ;(provider as any).streamPublisher = new StreamPublisher(
            nats.fake,
            'ws-1',
            'thread-1',
            'Anthropic',
        )
        const skippedSpy = vi.spyOn((provider as any).streamPublisher, 'mediaGenerationSkipped')

        expect((provider as any).routeAfterStream({} as any)).toBe('skip')
        expect(skippedSpy).not.toHaveBeenCalled()
    })
})

describe('BaseProvider fanout', () => {
    it('returns successful image fanout results while emitting an image error event for failures', async () => {
        const nats = makeFakeNats()
        const runImageRouter = vi.fn(async (state: ProviderState): Promise<Partial<ProviderState>> => {
            if (state.generationRun?.mediaIndex === 0) {
                return { error: 'Google image model returned no inline image data.' }
            }
            return { generatedImages: ['final-image-base64'] }
        })
        const deps = {
            natsService: nats.fake,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter,
            runVideoRouter: vi.fn(),
        } as unknown as BaseProviderDeps
        const provider = new TestProvider('ws1:thread1', deps)

        const result = await provider.runImageGeneration(createFanoutState())
        await flushPipelinePublishes()

        expect(result).toEqual({ generatedImages: ['final-image-base64'] })
        expect(runImageRouter).toHaveBeenCalledTimes(2)
        const imageErrorEvents = nats.published.filter((item) => item.payload.content.status === STREAM_STATUS.IMAGE_ERROR)
        expect(imageErrorEvents).toHaveLength(1)
        expect(imageErrorEvents[0]?.payload.content).toMatchObject({
            status: STREAM_STATUS.IMAGE_ERROR,
            aiProvider: 'Anthropic',
            error: 'Google image model returned no inline image data.',
            generationRun: {
                generationRequestId: 'request-1',
                reasoningRunId: 'reasoning-1',
                mediaRunId: 'reasoning-1:image:0',
                mediaModelId: 'Google:gemini-2.5-flash-image',
                mediaType: 'image',
                mediaIndex: 0,
                variantIndex: 0,
            },
        })
    })

    it('keeps successful fanout results when a sibling model throws and does not emit top-level error', async () => {
        const nats = makeFakeNats()
        const runImageRouter = vi.fn(async (state: ProviderState): Promise<Partial<ProviderState>> => {
            if (state.generationRun?.mediaIndex === 0) {
                throw new Error('image provider crashed')
            }
            return { generatedImages: ['final-image-base64'] }
        })

        const deps = {
            natsService: nats.fake,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter,
            runVideoRouter: vi.fn(),
        } as unknown as BaseProviderDeps
        const provider = new TestProvider('ws1:thread1', deps)

        const result = await provider.runImageGeneration(createFanoutState())
        await flushPipelinePublishes()

        expect(result).toEqual({ generatedImages: ['final-image-base64'] })
        expect(runImageRouter).toHaveBeenCalledTimes(2)
        const topLevelErrors = nats.published.filter((item) =>
            item.payload?.content?.status === STREAM_STATUS.ERROR,
        )
        expect(topLevelErrors).toHaveLength(0)
    })

    it('returns successful video fanout results while emitting a video error event for failures', async () => {
        const nats = makeFakeNats()
        const runVideoRouter = vi.fn(async (state: ProviderState): Promise<Partial<ProviderState>> => {
            if (state.generationRun?.mediaIndex === 0) {
                return { error: 'Google video provider timed out.' }
            }
            return { generatedVideos: ['final-video-url'] }
        })
        const deps = {
            natsService: nats.fake,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(),
            runVideoRouter,
        } as unknown as BaseProviderDeps
        const provider = new TestProvider('ws1:thread1', deps)

        const result = await provider.runImageGeneration(createFanoutState({
            generatedImagePrompt: undefined,
            generatedVideoPrompt: 'Animate this cat in a loop.',
        }))
        await flushPipelinePublishes()

        expect(result).toEqual({ generatedVideos: ['final-video-url'] })
        expect(runVideoRouter).toHaveBeenCalledTimes(2)
        const videoErrorEvents = nats.published.filter((item) => item.payload.content.status === STREAM_STATUS.ERROR)
        expect(videoErrorEvents).toHaveLength(0)
    })

    it('returns an aggregated error when every media fanout attempt fails', async () => {
        const nats = makeFakeNats()
        const runImageRouter = vi.fn(async (): Promise<Partial<ProviderState>> => ({
            error: 'Image model unavailable',
        }))

        const deps = {
            natsService: nats.fake,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter,
            runVideoRouter: vi.fn(),
        } as unknown as BaseProviderDeps
        const provider = new TestProvider('ws1:thread1', deps)

        const result = await provider.runImageGeneration(createFanoutState({
            generatedVideoPrompt: undefined,
            generatedImagePrompt: 'Render with all models failing',
        }))
        await flushPipelinePublishes()

        expect(result).toMatchObject({ error: 'Image model unavailable' })
        expect(runImageRouter).toHaveBeenCalledTimes(2)

        const topLevelErrors = nats.published.filter((item) =>
            item.payload?.content?.status === STREAM_STATUS.ERROR,
        )
        expect(topLevelErrors).toHaveLength(1)
        expect(topLevelErrors[0]?.payload.content).toMatchObject({
            status: STREAM_STATUS.ERROR,
            aiProvider: 'Anthropic',
            text: 'Image model unavailable',
            generationRun: expect.objectContaining({
                generationRequestId: 'request-1',
                reasoningRunId: 'reasoning-1',
                reasoningModelId: 'Anthropic:claude-sonnet-4-6',
                reasoningIndex: 0,
            }),
        })
    })

    it('does not fan out when generationRun is missing, even if fanout plans exist', async () => {
        const deps = {
            natsService: { publish: vi.fn() } as any,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(async () => ({ generatedImages: ['fallback-image'] })),
            runVideoRouter: vi.fn(),
        } as BaseProviderDeps
        const provider = new TestProvider('ws1:thread1', deps)

        const result = await provider.runImageGeneration(createFanoutState({
            generationRun: undefined,
            generatedVideoPrompt: undefined,
        }))

        expect(result).toEqual({ generatedImages: ['fallback-image'] })
        expect((deps.runImageRouter as any)).toHaveBeenCalledTimes(1)
        expect((deps.runVideoRouter as any)).not.toHaveBeenCalled()
    })

    it('fans out to both selected media modalities when both prompts are present', async () => {
        const deps = {
            natsService: { publish: vi.fn() } as any,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(async () => ({ generatedImages: ['image-result'] })),
            runVideoRouter: vi.fn(async () => ({ generatedVideos: ['only-video'] })),
        } as BaseProviderDeps
        const provider = new TestProvider('ws1:thread1', deps)

        const result = await provider.runImageGeneration(createFanoutState({
            generatedVideoPrompt: 'Animate this in motion.',
            generatedImagePrompt: 'Paint this reference.',
        }))

        expect(result).toEqual({
            generatedImages: ['image-result', 'image-result'],
            generatedVideos: ['only-video', 'only-video'],
            error: undefined,
            errorCode: undefined,
            errorType: undefined,
        })
        expect((deps.runVideoRouter as any)).toHaveBeenCalledTimes(2)
        expect((deps.runImageRouter as any)).toHaveBeenCalledTimes(2)
    })
})

describe('BaseProvider image fanout prompt validation', () => {
    class FanoutRewriteProvider extends TestProvider {
        readonly providerName = 'Anthropic' as const

        constructor(instanceKey: string, deps: BaseProviderDeps, private readonly rewrittenImage: string | undefined) {
            super(instanceKey, deps)
        }

        protected override async rewriteImagePromptToFitLimit(
            _state: ProviderState,
            prompt: string,
            maxChars: number,
        ): Promise<string | undefined> {
            if (this.rewrittenImage !== undefined) {
                return this.rewrittenImage
            }
            return `${prompt.slice(0, maxChars)}`
        }
    }

    it('uses a successful rewritten prompt when a fanout prompt exceeds limits', async () => {
        const nats = makeFakeNats()
        const deps = {
            natsService: nats.fake,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(async () => ({ generatedImages: ['ok'] })),
            runVideoRouter: vi.fn(),
        } as BaseProviderDeps
        const provider = new FanoutRewriteProvider('ws1:thread1', deps, 'short')

        const state = createFanoutState({
            generatedImagePrompt: 'this prompt is intentionally and clearly too long for this model',
            imageModelMetaInfo: {
                provider: 'Anthropic',
                model: 'claude-sonnet-4-6',
                modelVersion: 'claude-sonnet-4-6',
                imagePromptMaxChars: 5,
            } as any,
            imageModelVersion: 'claude-sonnet-4-6',
            imageProviderName: 'Anthropic',
        } as any)

        const result = await (provider as any).validateImageFanoutPrompt(state)

        expect(result).toEqual({ generatedImagePrompt: 'short' })
    })

    it('returns validation error when rewritten fanout prompt still violates provider constraints', async () => {
        const nats = makeFakeNats()
        const deps = {
            natsService: nats.fake,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(async () => ({ generatedImages: ['ok'] })),
            runVideoRouter: vi.fn(),
        } as BaseProviderDeps
        const provider = new FanoutRewriteProvider('ws1:thread1', deps, 'this rewritten prompt is still too long')

        const state = createFanoutState({
            generatedImagePrompt: 'this prompt is intentionally and clearly too long for this model',
            imageModelMetaInfo: {
                provider: 'Anthropic',
                model: 'claude-sonnet-4-6',
                modelVersion: 'claude-sonnet-4-6',
                imagePromptMaxChars: 5,
            } as any,
            imageModelVersion: 'claude-sonnet-4-6',
            imageProviderName: 'Anthropic',
        } as any)

        const result = await (provider as any).validateImageFanoutPrompt(state)
        const expectedError = validateImagePrompt(
            'this rewritten prompt is still too long',
            state.imageModelMetaInfo,
            state.imageProviderName,
        )

        expect(result).toEqual({ error: expectedError })
    })

    it('falls back to the original validation error if rewrite throws', async () => {
        class ThrowingRewriteProvider extends TestProvider {
            readonly providerName = 'Anthropic' as const

            protected override async rewriteImagePromptToFitLimit(
                _state: ProviderState,
                _prompt: string,
                _maxChars: number,
            ): Promise<string | undefined> {
                throw new Error('rewrite service unavailable')
            }
        }

        const nats = makeFakeNats()
        const deps = {
            natsService: nats.fake,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(async () => ({ generatedImages: ['ok'] })),
            runVideoRouter: vi.fn(),
        } as BaseProviderDeps
        const provider = new ThrowingRewriteProvider('ws1:thread1', deps)

        const state = createFanoutState({
            generatedImagePrompt: 'this prompt is intentionally and clearly too long for this model',
            imageModelMetaInfo: {
                provider: 'Anthropic',
                model: 'claude-sonnet-4-6',
                modelVersion: 'claude-sonnet-4-6',
                imagePromptMaxChars: 5,
            } as any,
            imageModelVersion: 'claude-sonnet-4-6',
            imageProviderName: 'Anthropic',
        } as any)

        const result = await (provider as any).validateImageFanoutPrompt(state)
        const expectedError = validateImagePrompt(
            'this prompt is intentionally and clearly too long for this model',
            state.imageModelMetaInfo,
            state.imageProviderName,
        )

        expect(result).toEqual({
            error: expectedError,
        })
        expect(debugWarnSpy).toHaveBeenCalledWith(
            '[BaseProvider] Image fanout prompt rewrite failed for ws1:thread1: rewrite service unavailable',
        )
    })

    it('falls back to the original validation error when rewrite returns undefined', async () => {
        class MissingRewriteProvider extends TestProvider {
            readonly providerName = 'Anthropic' as const

            protected override async rewriteImagePromptToFitLimit(
                _state: ProviderState,
                _prompt: string,
                _maxChars: number,
            ): Promise<string | undefined> {
                return undefined
            }
        }

        const nats = makeFakeNats()
        const deps = {
            natsService: nats.fake,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(async () => ({ generatedImages: ['ok'] })),
            runVideoRouter: vi.fn(),
        } as BaseProviderDeps
        const provider = new MissingRewriteProvider('ws1:thread1', deps)

        const state = createFanoutState({
            generatedImagePrompt: 'this prompt is intentionally and clearly too long for this model',
            imageModelMetaInfo: {
                provider: 'Anthropic',
                model: 'claude-sonnet-4-6',
                modelVersion: 'claude-sonnet-4-6',
                imagePromptMaxChars: 5,
            } as any,
            imageModelVersion: 'claude-sonnet-4-6',
            imageProviderName: 'Anthropic',
        } as any)

        const result = await (provider as any).validateImageFanoutPrompt(state)
        const expectedError = validateImagePrompt(
            'this prompt is intentionally and clearly too long for this model',
            state.imageModelMetaInfo,
            state.imageProviderName,
        )

        expect(result).toEqual({ error: expectedError })
    })
})

describe('BaseProvider streamTokens failure path', () => {
    it('returns terminal error metadata and marks stream as finished when streamImpl throws', async () => {
        const provider = new FailingStreamProvider('ws1:thread1', {
            natsService: { publish: vi.fn() } as any,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        } as BaseProviderDeps)

        const streamError = vi.fn()
        const streamEnd = vi.fn()
        ;(provider as any).streamPublisher = {
            error: streamError,
            end: streamEnd,
        } as any

        const update = await (provider as any).streamTokens({
            workspaceId: 'ws1',
            aiChatThreadId: 'thread1',
            instanceKey: 'ws1:thread1',
            provider: 'Anthropic',
            modelVersion: 'claude-sonnet-4-6',
            messages: [{ role: 'user', content: 'make fire' }],
            streamActive: false,
            aiRequestReceivedAt: 1,
            aiModelMetaInfo: { provider: 'Anthropic', model: 'claude', modelVersion: 'claude' },
            eventMeta: {},
            temperature: 0.7,
            imageSize: 'auto',
        } as any)

        expect(update).toMatchObject({
            streamActive: false,
            error: 'streamer exploded',
            aiRequestFinishedAt: expect.any(Number),
        })
        expect(streamError).toHaveBeenCalledWith('streamer exploded')
        expect(streamEnd).toHaveBeenCalledTimes(0)
        expect(debugErrSpy).toHaveBeenCalledWith('Streaming error (Anthropic): streamer exploded')
    })
})

describe('BaseProvider process failure path', () => {
    it('calls media-request completion and drainage hooks when process-level graph execution fails', async () => {
        const completeKnownMediaGenerationRequests = vi.spyOn(
            StreamPublisher.prototype as any,
            'completeKnownMediaGenerationRequests',
        )
        const end = vi.spyOn(StreamPublisher.prototype as any, 'end')
        const drainPendingWrites = vi
            .spyOn(StreamPublisher.prototype as any, 'drainPendingWrites')
            .mockResolvedValue(undefined)
        const finishProseMirrorStream = vi
            .spyOn(StreamPublisher.prototype as any, 'finishProseMirrorStream')
            .mockResolvedValue(undefined)
        const error = vi.spyOn(StreamPublisher.prototype as any, 'error')

        try {
            const provider = new TestProvider('ws1:thread1', {
                natsService: { publish: vi.fn() } as any,
                storeWorkspaceImage: vi.fn(),
                storeWorkspaceVideo: vi.fn(),
                usageReporter: {} as any,
                runImageRouter: vi.fn(),
                runVideoRouter: vi.fn(),
            } as BaseProviderDeps)

            const result = await provider.process({
                workspaceId: 'ws1',
                aiChatThreadId: 'thread1',
                aiModelMetaInfo: { provider: 'Anthropic', model: 'claude' },
                messages: [{ role: 'user', content: 'make it fail' }],
            } as any)

            expect(completeKnownMediaGenerationRequests).toHaveBeenCalledOnce()
            expect(end).toHaveBeenCalledOnce()
            expect(drainPendingWrites).toHaveBeenCalledOnce()
            expect(finishProseMirrorStream).toHaveBeenCalledTimes(2)
            expect(error).toHaveBeenCalledWith('modelVersion is required')
            expect(result).toMatchObject({
                error: 'modelVersion is required',
                streamActive: false,
            })
        } finally {
            completeKnownMediaGenerationRequests.mockRestore()
            end.mockRestore()
            drainPendingWrites.mockRestore()
            finishProseMirrorStream.mockRestore()
            error.mockRestore()
        }
    })
})

describe('BaseProvider usage lifecycle', () => {
    it('skips usage reporter calls when the workflow failed upstream', async () => {
        const reportTokensUsage = vi.fn()
        const reportImageUsage = vi.fn()
        const reportVideoUsage = vi.fn()
        const provider = new TestProvider('ws1:thread1', {
            natsService: { publish: vi.fn() } as any,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {
                reportTokensUsage,
                reportImageUsage,
                reportVideoUsage,
            },
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        } as BaseProviderDeps)

        await (provider as any).calculateUsage({
            workspaceId: 'ws1',
            aiChatThreadId: 'thread1',
            instanceKey: 'ws1:thread1',
            provider: 'Anthropic',
            modelVersion: 'claude-sonnet-4-6',
            aiModelMetaInfo: { provider: 'Anthropic', model: 'claude-sonnet-4-6' },
            temperature: 0.7,
            streamActive: false,
            aiRequestReceivedAt: 10,
            error: 'provider failed',
            usage: { promptTokens: 4 },
            eventMeta: {},
        } as any)

        expect(reportTokensUsage).not.toHaveBeenCalled()
        expect(reportImageUsage).not.toHaveBeenCalled()
        expect(reportVideoUsage).not.toHaveBeenCalled()
    })

    it('reports token, image, and video usage with generated metadata', async () => {
        const reportTokensUsage = vi.fn()
        const reportImageUsage = vi.fn()
        const reportVideoUsage = vi.fn()
        const provider = new TestProvider('ws1:thread1', {
            natsService: { publish: vi.fn() } as any,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {
                reportTokensUsage,
                reportImageUsage,
                reportVideoUsage,
            },
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        } as BaseProviderDeps)

        await (provider as any).calculateUsage({
            workspaceId: 'ws1',
            aiChatThreadId: 'thread1',
            instanceKey: 'ws1:thread1',
            provider: 'Anthropic',
            modelVersion: 'claude-sonnet-4.6',
            aiModelMetaInfo: { provider: 'Anthropic', model: 'claude-sonnet-4.6', modelVersion: 'claude-sonnet-4.6' },
            videoModelMetaInfo: { provider: 'Google', model: 'veo-3.1-generate-preview', modelVersion: 'veo-3.1-generate-preview' },
            temperature: 0.7,
            streamActive: false,
            aiRequestReceivedAt: 10,
            usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
            imageUsage: { size: '1024x1024', quality: 'high' },
            videoUsage: {
                durationSeconds: 8,
                resolution: '720p',
                aspectRatio: '16:9',
                totalTokens: 456,
                completionTokens: 123,
            },
            eventMeta: { requestId: 'req-1' },
        } as any)

        expect(reportTokensUsage).toHaveBeenCalledOnce()
        expect(reportImageUsage).toHaveBeenCalledOnce()
        expect(reportVideoUsage).toHaveBeenCalledOnce()
    })

    it('finishes prose-mirror stream during cleanup', async () => {
        const finishProseMirrorStream = vi.fn().mockResolvedValue(undefined)
        const provider = new TestProvider('ws1:thread1', {
            natsService: { publish: vi.fn() } as any,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        } as BaseProviderDeps)
        ;(provider as any).streamPublisher = {
            completeKnownMediaGenerationRequests: vi.fn(),
            drainPendingWrites: vi.fn().mockResolvedValue(undefined),
            finishProseMirrorStream,
        } as StreamPublisher

        const result = await (provider as any).cleanup({} as any)

        expect((provider as any).streamPublisher.completeKnownMediaGenerationRequests).toHaveBeenCalledOnce()
        expect((provider as any).streamPublisher.drainPendingWrites).toHaveBeenCalledOnce()
        expect(finishProseMirrorStream).toHaveBeenCalledOnce()
        expect(result).toEqual({})
    })
})
