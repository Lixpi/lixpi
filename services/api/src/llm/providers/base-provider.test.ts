'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STREAM_STATUS, type MediaGenerationRunMeta, type ProviderName } from '@lixpi/constants'

import * as debugTools from '@lixpi/debug-tools'

const capabilityOutputFinalizerMocks = vi.hoisted(() => ({
    finalize: vi.fn(),
    discard: vi.fn(),
}))

vi.mock('../../capability-system/capability-output-finalizer.ts', () => ({
    finalizePendingCapabilityOutputsForState: capabilityOutputFinalizerMocks.finalize,
    discardPendingCapabilityOutputsForState: capabilityOutputFinalizerMocks.discard,
}))

import { BaseProvider, type BaseProviderDeps } from './base-provider.ts'
import { ImagePublisher } from '../graph/image-publisher.ts'
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
    capabilityOutputFinalizerMocks.finalize.mockReset()
    capabilityOutputFinalizerMocks.discard.mockReset()
    capabilityOutputFinalizerMocks.discard.mockResolvedValue(undefined)
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
    it('requires an organization before constructing media publishers', async () => {
        const provider = new TestProvider('ws-1:thread-1', {
            natsService: makeFakeNats().fake,
            usageReporter: {} as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        } as BaseProviderDeps)

        await expect(provider.process({})).rejects.toThrow('Provider request is missing organizationId')
    })

    it('clears transient media in the provider terminal cleanup path', async () => {
        const nats = makeFakeNats()
        const provider = new TestProvider('ws-1:thread-1', {
            natsService: nats.fake,
            usageReporter: {} as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        } as BaseProviderDeps)
        const clearTransientMedia = vi.spyOn(ImagePublisher.prototype, 'clearTransientMedia').mockResolvedValue(undefined)
        ;(provider as any).app = {
            invoke: vi.fn(async (initialState: ProviderState) => initialState),
        }

        await provider.process({
            organizationId: 'organization-1',
            workspaceId: 'ws-1',
            aiChatThreadId: 'thread-1',
            aiModelMetaInfo: { provider: 'Anthropic', model: 'claude', modelVersion: 'claude' },
            messages: [],
        })

        expect(clearTransientMedia).toHaveBeenCalledOnce()
    })

    it('resolves typed image references once before every image-provider workflow', async () => {
        const nats = makeFakeNats()
        const provider = new TestProvider('ws-1:thread-1', {
            natsService: nats.fake,
            usageReporter: {} as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        } as BaseProviderDeps)
        const invoke = vi.fn(async (initialState: ProviderState) => initialState)
        ;(provider as any).app = { invoke }

        const result = await provider.process({
            organizationId: 'organization-1',
            workspaceId: 'ws-1',
            aiChatThreadId: 'thread-1',
            aiModelMetaInfo: {
                provider: 'OpenAI',
                model: 'gpt-image-1-mini',
                modelVersion: 'gpt-image-1-mini',
                imageReferenceCapabilities: {
                    maxReferenceImages: 16,
                    maxIdentityReferenceImages: 5,
                    conditioningModes: ['edit', 'identity', 'style'],
                    inputFidelity: 'standard',
                    supportsIterativeEdit: true,
                    supportsMask: true,
                    supportsStructureControl: false,
                    supportsPoseControl: false,
                    supportsDeterministicSeed: false,
                    maxOutputPixels: 1572864,
                    supportedAspectRatios: ['1:1', '3:2', '2:3'],
                },
            },
            messages: [{ role: 'user', content: 'Create a character sheet.' }],
            enableImageGeneration: true,
            imageGenerationReferences: [{
                url: 'data:image/png;base64,c291cmNl',
                role: 'original-source',
                fileName: 'original-source-1',
            }],
        })

        expect(invoke).toHaveBeenCalledOnce()
        expect(result.resolvedImageGenerationReferences).toEqual([
            expect.objectContaining({
                role: 'original-source',
                fileName: 'original-source-1.png',
                mediaType: 'image/png',
                byteLength: 6,
                bytes: Buffer.from('source'),
            }),
        ])
    })

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
            organizationId: 'organization-1',
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

    it('suppresses duplicate provider generation after a required Capability produced an output Asset', async () => {
        const provider = new TestProvider('ws-1:thread-1', {
            natsService: { publish: vi.fn() } as any,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        })
        const state = {
            capabilityOutputAssetIds: ['asset-character-sheet'],
            generationRun: {
                requestKind: 'single-media',
                generationRequestId: 'request-1',
            },
            generatedImagePrompt: 'duplicate image',
            generatedVideoPrompt: 'duplicate video',
            imageModelVersion: 'image-model',
            videoModelVersion: 'video-model',
        } as ProviderState
        const completeRequest = vi.fn()
        ;(provider as any).streamPublisher = {
            mediaGenerationRequestComplete: completeRequest,
        } as StreamPublisher

        expect((provider as any).routeAfterStream(state)).toBe('skip')
        expect(completeRequest).toHaveBeenCalledWith('request-1')
        expect((provider as any).shouldGenerateImage(state)).toBe('skip')
    })

    it('streams the assistant response but skips media lineage after a Capability Artifact owns the turn output', async () => {
        const provider = new TestProvider('ws-1:thread-1', {
            natsService: { publish: vi.fn() } as any,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        })
        const streamImpl = vi.spyOn(provider as any, 'streamImpl')
        const state = {
            capabilityOutputAssetIds: ['asset-action-timeline'],
            capabilityOutputMediaAssetIds: [],
            enableImageGeneration: false,
            enableVideoGeneration: false,
            imageModelVersion: 'image-model',
            videoModelVersion: 'video-model',
        } as ProviderState

        await expect((provider as any).streamTokens(state)).resolves.toMatchObject({
            streamActive: false,
        })
        await expect((provider as any).planMediaBranchLineage(state)).resolves.toEqual({})
        expect(streamImpl).toHaveBeenCalledOnce()
    })

    it('assigns a stable generation run before a model-required Capability Tool executes', async () => {
        const provider = new TestProvider('ws-1:thread-1', {
            natsService: { publish: vi.fn() } as any,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        })
        const setGenerationRun = vi.fn()
        ;(provider as any).streamPublisher = { setGenerationRun } as any
        const streamImpl = vi.spyOn(provider as any, 'streamImpl')
        const state = {
            workspaceId: 'ws-1',
            aiChatThreadId: 'thread-1',
            instanceKey: 'ws-1:thread-1',
            provider: 'Anthropic',
            modelVersion: 'claude-haiku-4-5',
            messages: [{ role: 'user', content: 'Create the timeline' }],
            aiModelMetaInfo: { model: 'claude-haiku-4-5' },
            eventMeta: {},
            resolvedCapabilityPlan: {
                serializable: { rootCapabilityIds: ['action-timeline'] },
                getManifest: () => ({
                    manifest: {
                        tool: {
                            executionPolicy: 'model-required',
                            modelAxisPolicy: { outputMode: 'capability-only' },
                        },
                    },
                }),
            },
        } as ProviderState

        const update = await (provider as any).streamTokens(state)

        expect(state.generationRun).toMatchObject({
            requestKind: 'single-media',
            reasoningModelId: 'Anthropic:claude-haiku-4-5',
            reasoningIndex: 0,
        })
        expect(state.generationRun?.generationRequestId).toMatch(/^media-/)
        expect(state.generationRun?.reasoningRunId).toBe(
            `${state.generationRun?.generationRequestId}:reasoning:0`,
        )
        expect(setGenerationRun).toHaveBeenCalledWith(state.generationRun)
        expect(streamImpl).toHaveBeenCalledWith(expect.objectContaining({
            generationRun: state.generationRun,
        }))
        expect(update).toMatchObject({ generationRun: state.generationRun })
    })

    it('publishes a staged Capability Artifact only after the response stream has drained', async () => {
        const provider = new TestProvider('ws-1:thread-1', {
            natsService: { publish: vi.fn() } as any,
            usageReporter: {} as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        })
        const order: string[] = []
        capabilityOutputFinalizerMocks.finalize.mockImplementation(async () => {
            order.push('finalize')
            return [{
                canvasGeometry: { layoutRevision: 2, nodes: [] },
                generationRun: { generationRequestId: 'request-1' },
            }]
        })
        ;(provider as any).streamPublisher = {
            drainPendingWrites: vi.fn(async () => { order.push('drain') }),
            finishProseMirrorConversation: vi.fn(async () => { order.push('finish-conversation') }),
            canvasGeometryResolved: vi.fn(() => { order.push('publish') }),
            end: vi.fn(() => { order.push('end') }),
        }
        const state = {
            workspaceId: 'ws-1',
            aiChatThreadId: 'thread-1',
            eventMeta: { userId: 'user-1', organizationId: 'organization-1' },
            pendingCapabilityOutputFinalizations: [{
                capabilityId: 'action-timeline',
                capabilityRunId: 'run-1',
                assetId: 'artifact-1',
                input: {},
                variant: { axis: 'reasoning-model' },
                generationRun: { generationRequestId: 'request-1' },
            }],
        } as ProviderState

        await (provider as any).streamTokens(state)

        expect(order).toEqual([
            'drain',
            'end',
            'drain',
            'finish-conversation',
            'finalize',
            'publish',
            'drain',
        ])
        expect(state.pendingCapabilityOutputFinalizations).toEqual([])
    })

    it('discards a staged Capability Artifact when the response continuation fails', async () => {
        const provider = new FailingStreamProvider('ws-1:thread-1', {
            natsService: { publish: vi.fn() } as any,
            usageReporter: {} as any,
            runImageRouter: vi.fn(),
            runVideoRouter: vi.fn(),
        })
        ;(provider as any).streamPublisher = {
            error: vi.fn(),
            end: vi.fn(),
            drainPendingWrites: vi.fn(),
            completeKnownMediaGenerationRequests: vi.fn(),
        }
        const state = {
            pendingCapabilityOutputFinalizations: [{
                capabilityId: 'action-timeline',
                capabilityRunId: 'run-1',
                assetId: 'artifact-1',
                input: {},
                variant: { axis: 'reasoning-model' },
                generationRun: { generationRequestId: 'request-1' },
            }],
        } as ProviderState

        await (provider as any).streamTokens(state)

        expect(capabilityOutputFinalizerMocks.discard).toHaveBeenCalledWith(state)
        expect(capabilityOutputFinalizerMocks.finalize).not.toHaveBeenCalled()
        expect(state.pendingCapabilityOutputFinalizations).toEqual([])
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
    it('rejects an over-limit prompt unchanged without invoking another model', async () => {
        const nats = makeFakeNats()
        const deps = {
            natsService: nats.fake,
            storeWorkspaceImage: vi.fn(),
            storeWorkspaceVideo: vi.fn(),
            usageReporter: {} as any,
            runImageRouter: vi.fn(async () => ({ generatedImages: ['ok'] })),
            runVideoRouter: vi.fn(),
        } as BaseProviderDeps
        const provider = new TestProvider('ws1:thread1', deps)

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
        expect((provider as any).rewriteImagePromptToFitLimit).toBeUndefined()
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
                organizationId: 'organization-1',
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
