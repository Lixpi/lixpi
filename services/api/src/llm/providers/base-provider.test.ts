'use strict'

import { describe, expect, it, vi } from 'vitest'
import { STREAM_STATUS, type MediaGenerationRunMeta, type ProviderName } from '@lixpi/constants'

import { BaseProvider, type BaseProviderDeps } from './base-provider.ts'
import { StreamPublisher } from '../graph/stream-publisher.ts'
import type { AiModelMetaInfo, ProviderState } from '../graph/state.ts'

type Published = { subject: string, payload: any }

const makeFakeNats = () => {
    const published: Published[] = []
    const fake = {
        publish: (subject: string, payload: any) => {
            published.push({ subject, payload })
        },
    } as any
    return { fake, published }
}

const makeImageModel = (model: string): AiModelMetaInfo => ({
    provider: 'Google',
    model,
    modelVersion: model,
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

describe('BaseProvider image fanout errors', () => {
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

        expect(result).toEqual({ generatedVideos: ['final-video-url'] })
        expect(runVideoRouter).toHaveBeenCalledTimes(2)
        const videoErrorEvents = nats.published.filter((item) => item.payload.content.status === STREAM_STATUS.ERROR)
        expect(videoErrorEvents).toHaveLength(0)
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

    it('routes to video fanout when both image and video prompts are present', async () => {
        const deps = {
            natsService: { publish: vi.fn() } as any,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(async () => ({ generatedImages: ['should-not-run'] })),
            runVideoRouter: vi.fn(async () => ({ generatedVideos: ['only-video'] })),
        } as BaseProviderDeps
        const provider = new TestProvider('ws1:thread1', deps)

        const result = await provider.runImageGeneration(createFanoutState({
            generatedVideoPrompt: 'Animate this in motion.',
            generatedImagePrompt: 'Paint this reference.',
        }))

        expect(result).toEqual({ generatedVideos: ['only-video', 'only-video'] })
        expect((deps.runVideoRouter as any)).toHaveBeenCalledTimes(2)
        expect((deps.runImageRouter as any)).not.toHaveBeenCalled()
    })
})
