'use strict'

import { afterEach, describe, expect, it, vi } from 'vitest'

import * as debugTools from '@lixpi/debug-tools'

import * as AiModelModelModule from '../../models/ai-model.ts'
import * as capabilityStateResolver from '../../capability-system/capability-state-resolver.ts'
import * as mediaBranchResolver from '../graph/media-branch-resolver.ts'
import * as workspaceContextResolver from '../graph/workspace-context-resolver.ts'
import { buildMediaGenerationRequestGroupKey, buildMediaGenerationThreadGroupPrefix, MediaGenerationMatrixOrchestrator, type MatrixRequestData } from './media-generation-matrix.ts'

const generatedAssetStorageMocks = vi.hoisted(() => ({
    ensurePendingGeneratedAssets: vi.fn(),
}))
const assetModelMocks = vi.hoisted(() => ({
    getAssetRecord: vi.fn(),
}))
const canvasProjectionMocks = vi.hoisted(() => ({
    settleMediaGenerationRequestOnCanvas: vi.fn(),
}))
const aiChatStreamAssemblerMocks = vi.hoisted(() => ({
    settlePersistedAiChatGenerationRequest: vi.fn(),
}))
const mediaGenerationRequestServiceMocks = vi.hoisted(() => ({
    bindRunsToLineagePlan: vi.fn(),
    failUnfinishedRuns: vi.fn(),
}))

vi.mock('../../services/generated-asset-storage.ts', () => generatedAssetStorageMocks)
vi.mock('../../models/asset.ts', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../models/asset.ts')>(),
    getAssetRecord: assetModelMocks.getAssetRecord,
}))
vi.mock('../../services/asset-canvas-projection.ts', () => canvasProjectionMocks)
vi.mock('../../prosemirror/ai-chat-stream-assembler.ts', () => aiChatStreamAssemblerMocks)
vi.mock('../../services/media-generation-request-service.ts', () => ({
    MediaGenerationRequestService: class {
        async bindRunsToLineagePlan(args: unknown): Promise<unknown> {
            return mediaGenerationRequestServiceMocks.bindRunsToLineagePlan(args)
        }

        async failUnfinishedRuns(args: unknown): Promise<unknown> {
            return mediaGenerationRequestServiceMocks.failUnfinishedRuns(args)
        }
    },
}))

const natsService = { publish: vi.fn() } as any

const createRegistry = () => {
    const process = vi.fn(async () => ({ }))
    const preflightAdmission = vi.fn(async () => ({ metricsAdmissionApproved: true }))
    const getOrCreate = vi.fn(() => ({ preflightAdmission }))
    const remove = vi.fn()
    const stopGroup = vi.fn(async () => undefined)
    const stopGroupsWithPrefix = vi.fn(async () => undefined)
    const shutdown = vi.fn(async () => undefined)
    return {
        process,
        preflightAdmission,
        getOrCreate,
        remove,
        stopGroup,
        stopGroupsWithPrefix,
        shutdown,
        asRegistry: {
            process,
            getOrCreate,
            remove,
            stopGroup,
            stopGroupsWithPrefix,
            shutdown,
        },
    }
}

const createRequest = (overrides: Partial<MatrixRequestData> = {}): MatrixRequestData => ({
    workspaceId: 'ws-1',
    aiChatThreadId: 'thread-1',
    aiReasoningModels: ['Anthropic:claude-sonnet-4-6'],
    aiImageModels: ['Google:gemini-2.5-flash-image'],
    aiVideoModels: ['Google:veo-3.1-generate-preview'],
    eventMeta: { organizationId: 'organization-1', userId: 'user-1' },
    imageSize: '1024x1024',
    videoAspectRatio: '16:9',
    videoResolution: '720p',
    videoDuration: '8',
    ...overrides,
})

let debugInfoSpy: ReturnType<typeof vi.spyOn> | null = null
let debugWarnSpy: ReturnType<typeof vi.spyOn> | null = null
let debugErrSpy: ReturnType<typeof vi.spyOn> | null = null
let consoleInfoSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
    generatedAssetStorageMocks.ensurePendingGeneratedAssets.mockClear()
    canvasProjectionMocks.settleMediaGenerationRequestOnCanvas.mockClear()
    aiChatStreamAssemblerMocks.settlePersistedAiChatGenerationRequest.mockClear()
    mediaGenerationRequestServiceMocks.bindRunsToLineagePlan.mockClear()
    mediaGenerationRequestServiceMocks.failUnfinishedRuns.mockClear()
    generatedAssetStorageMocks.ensurePendingGeneratedAssets.mockResolvedValue(undefined)
    canvasProjectionMocks.settleMediaGenerationRequestOnCanvas.mockResolvedValue(null)
    aiChatStreamAssemblerMocks.settlePersistedAiChatGenerationRequest.mockResolvedValue({})
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
    vi.restoreAllMocks()
})

describe('MediaGenerationMatrixOrchestrator key helpers', () => {
    it('builds deterministic request grouping keys', () => {
        expect(buildMediaGenerationRequestGroupKey('ws-1', 'thread-1', 'request-1'))
            .toBe('ws-1:thread-1:request-1')
    })

    it('builds deterministic thread-scoped stop prefixes', () => {
        expect(buildMediaGenerationThreadGroupPrefix('ws-1', 'thread-1')).toBe('ws-1:thread-1:')
    })
})

describe('MediaGenerationMatrixOrchestrator', () => {
    it('dispatches one child per reasoning model and propagates shared lineage assignments', async () => {
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)
        const getAiModel = vi.spyOn(AiModelModelModule.default, 'getAiModel')

        getAiModel.mockImplementation(async ({ model }: { provider: string; model: string }) => {
            if (model === 'claude-3-opus-20240229') {
                return {
                    provider: 'Anthropic',
                    model: 'claude-3-opus-20240229',
                    modelVersion: 'claude-3-opus-20240229',
                    modalities: [{ modality: 'text' }],
                } as any
            }
            if (model === 'claude-3-sonnet-20240229') {
                return {
                    provider: 'Anthropic',
                    model: 'claude-3-sonnet-20240229',
                    modelVersion: 'claude-3-sonnet-20240229',
                    modalities: [{ modality: 'text' }],
                } as any
            }
            if (model === 'gemini-2.5-flash-image') {
                return {
                    provider: 'Google',
                    model: 'gemini-2.5-flash-image',
                    modelVersion: 'gemini-2.5-flash-image',
                    modalities: [{ modality: 'image_generation' }],
                    maxCompletionSize: 4096,
                } as any
            }
            return {
                provider: 'Google',
                model: 'veo-3.1-generate-preview',
                modelVersion: 'veo-3.1-generate-preview',
                modalities: [{ modality: 'video_generation' }],
            } as any
        })

        const workspaceContextSpy = vi.spyOn(workspaceContextResolver, 'resolveWorkspaceContext')
        const resolveCapabilitiesSpy = vi.spyOn(capabilityStateResolver, 'executeRequiredCapabilitiesForState')
        const resolveMediaBranchSpy = vi.spyOn(mediaBranchResolver, 'resolveMediaBranch')

        workspaceContextSpy.mockResolvedValue({})
        resolveCapabilitiesSpy.mockResolvedValue({})
        resolveMediaBranchSpy.mockResolvedValue({})

        await orchestrator.process(createRequest({
            aiReasoningModels: undefined,
            aiImageModels: ['Google:gemini-2.5-flash-image'],
            aiVideoModels: undefined,
            durableGenerationRequestId: 'durable-request-2',
            mediaGenerationRequest: {
                requestVersion: 'media-generation-matrix-v1',
                generationRequestId: 'request-2',
                reasoningModelIds: [
                    'Anthropic:claude-3-opus-20240229',
                    'Anthropic:claude-3-sonnet-20240229',
                ],
                imageModelIds: ['Google:gemini-2.5-flash-image'],
                videoModelIds: [],
                imageOptions: { imageSize: '1024x1024' },
                videoOptions: {},
            },
        }))

        expect(registry.process).toHaveBeenCalledTimes(2)
        const state0 = registry.process.mock.calls[0]?.[2] as any
        const state1 = registry.process.mock.calls[1]?.[2] as any

        expect(state0.preflightResolved).toBe(true)
        expect(state0.metricsAdmissionApproved).toBe(true)
        expect(state0.mediaFanoutPlan.imageModels).toHaveLength(1)
        expect(state0.mediaFanoutPlan.videoModels).toHaveLength(0)
        expect(state0.generationRun.reasoningRunId).toBe('request-2:reasoning:0')
        expect(state0.generationRun.reasoningIndex).toBe(0)
        expect(state1.generationRun.reasoningRunId).toBe('request-2:reasoning:1')
        expect(state1.generationRun.reasoningIndex).toBe(1)
        expect(state0.generationRun.lineageAssignment?.reasoningRunId).toBe('request-2:reasoning:0')
        expect(state1.generationRun.lineageAssignment?.reasoningRunId).toBe('request-2:reasoning:1')
        expect(state0.generationRun.lineageAssignment?.branchForkNodeId).toBe('branch-fork-request-2-reasoning-0')
        expect(mediaGenerationRequestServiceMocks.failUnfinishedRuns).toHaveBeenCalledWith({
            generationRequestId: 'durable-request-2',
            workspaceId: 'ws-1',
        })
    })

    it('does not create video fanout assignments from stale scalar video defaults in structured image matrices', async () => {
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)
        const getAiModel = vi.spyOn(AiModelModelModule.default, 'getAiModel')

        getAiModel.mockImplementation(async ({ model }: { provider: string; model: string }) => {
            if (model === 'claude-sonnet-4-6') {
                return {
                    provider: 'Anthropic',
                    model: 'claude-sonnet-4-6',
                    modelVersion: 'claude-sonnet-4-6',
                    modalities: [{ modality: 'text' }],
                } as any
            }
            if (model === 'veo-3.1-generate-preview') {
                return {
                    provider: 'Google',
                    model,
                    modelVersion: model,
                    modalities: [{ modality: 'video_generation' }],
                } as any
            }
            return {
                provider: 'Google',
                model,
                modelVersion: model,
                modalities: [{ modality: 'image_generation' }],
            } as any
        })

        vi.spyOn(workspaceContextResolver, 'resolveWorkspaceContext').mockResolvedValue({})
        vi.spyOn(capabilityStateResolver, 'executeRequiredCapabilitiesForState').mockResolvedValue({})
        vi.spyOn(mediaBranchResolver, 'resolveMediaBranch').mockResolvedValue({})

        await orchestrator.process(createRequest({
            aiReasoningModels: undefined,
            aiImageModels: undefined,
            aiVideoModels: ['Google:veo-3.1-generate-preview'],
            mediaGenerationRequest: {
                requestVersion: 'media-generation-matrix-v1',
                generationRequestId: 'request-image-only',
                reasoningModelIds: ['Anthropic:claude-sonnet-4-6'],
                imageModelIds: ['Google:image-a', 'Google:image-b'],
                videoModelIds: [],
                useMultipleImageModels: true,
                useMultipleVideoModels: false,
                imageOptions: { imageSize: '1024x1024' },
            },
        }))

        expect(registry.process).toHaveBeenCalledOnce()
        const state = registry.process.mock.calls[0]?.[2] as any
        expect(state.mediaFanoutPlan.imageModels).toHaveLength(2)
        expect(state.mediaFanoutPlan.videoModels).toHaveLength(0)
        expect(state.mediaBranchLineagePlan.runAssignments).toHaveLength(2)
        expect(state.mediaBranchLineagePlan.runAssignments.every((assignment: any) => assignment.mediaType === 'image')).toBe(true)
    })

    it('uses the latest structured image model selection when multiple-image mode stays enabled', async () => {
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)
        const getAiModel = vi.spyOn(AiModelModelModule.default, 'getAiModel')

        getAiModel.mockImplementation(async ({ model }: { provider: string; model: string }) => {
            if (model === 'claude-sonnet-4-6') {
                return {
                    provider: 'Anthropic',
                    model: 'claude-sonnet-4-6',
                    modelVersion: 'claude-sonnet-4-6',
                    modalities: [{ modality: 'text' }],
                } as any
            }
            return {
                provider: 'Google',
                model,
                modelVersion: model,
                modalities: [{ modality: 'image_generation' }],
                imageSizes: [{ value: '1024x1024' }, { value: '512x512' }],
            } as any
        })

        vi.spyOn(workspaceContextResolver, 'resolveWorkspaceContext').mockResolvedValue({})
        vi.spyOn(capabilityStateResolver, 'executeRequiredCapabilitiesForState').mockResolvedValue({})
        vi.spyOn(mediaBranchResolver, 'resolveMediaBranch').mockResolvedValue({})

        await orchestrator.process(createRequest({
            aiReasoningModels: undefined,
            // Deliberately stale outer fallback: the latest structured matrix has
            // already unselected image-a, so this must never produce a second fork.
            aiImageModels: ['Google:image-a', 'Google:image-b'],
            aiVideoModels: undefined,
            mediaGenerationRequest: {
                requestVersion: 'media-generation-matrix-v1',
                generationRequestId: 'request-current-image-selection',
                reasoningModelIds: ['Anthropic:claude-sonnet-4-6'],
                imageModelIds: ['Google:image-b'],
                videoModelIds: [],
                useMultipleImageModels: true,
                useMultipleVideoModels: false,
                imageOptions: {
                    imageSize: '1024x1024',
                    configGroups: [
                        {
                            groupId: 'stale-image-a',
                            modelIds: ['Google:image-a'],
                            values: { imageSize: '512x512' },
                        },
                        {
                            groupId: 'current-image-b',
                            modelIds: ['Google:image-b'],
                            values: { imageSize: '1024x1024' },
                        },
                    ],
                },
                videoOptions: {},
            },
        }))

        const lookedUpModels = getAiModel.mock.calls.map((call) => call?.[0]?.model)
        expect(lookedUpModels).toEqual(['claude-sonnet-4-6', 'image-b'])
        expect(lookedUpModels).not.toContain('image-a')
        expect(registry.process).toHaveBeenCalledOnce()

        const state = registry.process.mock.calls[0]?.[2] as any
        expect(state.mediaFanoutPlan.imageModels.map((model: any) => `${model.provider}:${model.model}`)).toEqual(['Google:image-b'])
        expect(state.mediaFanoutPlan.imageConfigGroups).toEqual([
            {
                groupId: 'current-image-b',
                modelIds: ['Google:image-b'],
                values: { imageSize: '1024x1024' },
            },
        ])
        expect(state.mediaBranchLineagePlan.runAssignments).toHaveLength(1)
        expect(state.mediaBranchLineagePlan.runAssignments[0]).toMatchObject({
            mediaType: 'image',
            mediaModelId: 'Google:image-b',
            mediaIndex: 0,
        })
    })

    it('rejects requests that resolve to neither image nor video generation models', async () => {
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)

        await expect(
            orchestrator.process(
                createRequest({
                    aiReasoningModels: ['Anthropic:claude-sonnet-4-6'],
                    aiImageModels: undefined,
                    aiVideoModels: undefined,
                    mediaGenerationRequest: {
                        requestVersion: 'media-generation-matrix-v1',
                        generationRequestId: 'request-3',
                        reasoningModelIds: ['Anthropic:claude-sonnet-4-6'],
                        imageModelIds: [],
                        videoModelIds: [],
                        imageOptions: { imageSize: '1024x1024' },
                        videoOptions: {},
                    },
                } as any),
            ),
        ).rejects.toThrow('requires at least one image or video generation model')

        expect(registry.process).not.toHaveBeenCalled()
    })

    it('dispatches a reasoning child for Capability-only output so the assistant response is persisted', async () => {
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)
        vi.spyOn(AiModelModelModule.default, 'getAiModel').mockResolvedValue({
            provider: 'Anthropic',
            model: 'claude-sonnet-4-6',
            modelVersion: 'claude-sonnet-4-6',
            modalities: [{ modality: 'text' }],
        } as any)
        vi.spyOn(workspaceContextResolver, 'resolveWorkspaceContext').mockResolvedValue({})
        vi.spyOn(capabilityStateResolver, 'resolveCapabilitiesForState').mockResolvedValue({})
        vi.spyOn(capabilityStateResolver, 'executeRequiredCapabilitiesForState').mockResolvedValue({
            capabilityOutputAssetIds: ['asset-action-timeline'],
            capabilityOutputMediaAssetIds: [],
            capabilityToolResults: [{
                capabilityId: 'global.action-timeline',
                runId: 'run-action-timeline',
                output: {
                    outputKind: 'capabilityArtifact',
                    assetId: 'asset-action-timeline',
                },
            }],
            enableImageGeneration: false,
            enableVideoGeneration: false,
        })
        const resolveMediaBranchSpy = vi.spyOn(mediaBranchResolver, 'resolveMediaBranch')

        await orchestrator.process(createRequest({
            aiReasoningModels: undefined,
            aiImageModels: undefined,
            aiVideoModels: undefined,
            capabilityReferences: [{
                kind: 'tool',
                capabilityId: 'global.action-timeline',
            }],
            enableImageGeneration: false,
            enableVideoGeneration: false,
            mediaGenerationRequest: {
                requestVersion: 'media-generation-matrix-v1',
                generationRequestId: 'request-action-timeline',
                reasoningModelIds: ['Anthropic:claude-sonnet-4-6'],
                imageModelIds: [],
                videoModelIds: [],
                imageOptions: { imageSize: '1024x1024' },
                videoOptions: {},
            },
        } as any))

        expect(resolveMediaBranchSpy).not.toHaveBeenCalled()
        expect(generatedAssetStorageMocks.ensurePendingGeneratedAssets).not.toHaveBeenCalled()
        expect(registry.process).toHaveBeenCalledOnce()
        expect(registry.process.mock.calls[0]?.[2]).toMatchObject({
            preflightResolved: true,
            capabilityOutputAssetIds: ['asset-action-timeline'],
            capabilityOutputMediaAssetIds: [],
            enableImageGeneration: false,
            enableVideoGeneration: false,
            mediaFanoutPlan: {
                imageModels: [],
                videoModels: [],
            },
        })
    })

    it('rejects requests with no reasoning model ids', async () => {
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)
        const request = { workspaceId: 'ws-1', aiChatThreadId: 'thread-1' } as MatrixRequestData

        await expect(orchestrator.process(request)).rejects.toThrow('at least one reasoning model')
        expect(registry.process).not.toHaveBeenCalled()
    })

    it('rejects non-reasoning models returned by model registry', async () => {
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)
        const getAiModel = vi.spyOn(AiModelModelModule.default, 'getAiModel')

        getAiModel.mockResolvedValue({
            provider: 'Anthropic',
            model: 'bad',
            modelVersion: 'bad',
            modalities: [{ modality: 'image_generation' }],
        } as any)

        await expect(
            orchestrator.process(createRequest()),
        ).rejects.toThrow('Model is not a reasoning model')
        expect(registry.process).not.toHaveBeenCalled()
    })

    it('resolves model metadata, runs shared preflight, and dispatches one reasoning child', async () => {
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)
        const getAiModel = vi.spyOn(AiModelModelModule.default, 'getAiModel')

        getAiModel.mockImplementation(async ({ model }: { provider: string; model: string }) => {
            if (model === 'claude-sonnet-4-6') {
                return {
                    provider: 'Anthropic',
                    model: 'claude-sonnet-4-6',
                    modelVersion: 'claude-sonnet-4-6',
                    modalities: [{ modality: 'text' }],
                } as any
            }
            if (model === 'gemini-2.5-flash-image') {
                return {
                    provider: 'Google',
                    model: 'gemini-2.5-flash-image',
                    modelVersion: 'gemini-2.5-flash-image',
                    modalities: [{ modality: 'image_generation' }],
                } as any
            }
            return {
                provider: 'Google',
                model: 'veo-3.1-generate-preview',
                modelVersion: 'veo-3.1-generate-preview',
                modalities: [{ modality: 'video_generation' }],
                videoAspectRatios: [{ value: '16:9' }],
                videoResolutions: [{ value: '720p' }],
                videoDurations: [{ value: '8' }],
            } as any
        })

        const workspaceContextSpy = vi.spyOn(workspaceContextResolver, 'resolveWorkspaceContext')
        const resolveCapabilitiesSpy = vi.spyOn(capabilityStateResolver, 'executeRequiredCapabilitiesForState')
        const resolveMediaBranchSpy = vi.spyOn(mediaBranchResolver, 'resolveMediaBranch')

        workspaceContextSpy.mockResolvedValue({})
        resolveCapabilitiesSpy.mockResolvedValue({})
        resolveMediaBranchSpy.mockResolvedValue({})

        await orchestrator.process(createRequest())

        expect(registry.process).toHaveBeenCalledOnce()
        const [instanceKey, providerName, state] = registry.process.mock.calls[0] as any[]
        expect(instanceKey).toContain(':reasoning:0')
        expect(providerName).toBe('Anthropic')
        expect(state.preflightResolved).toBe(true)
        expect(state.imageSize).toBe('1024x1024')
        expect(state.videoAspectRatio).toBe('16:9')
        expect(state.videoResolution).toBe('720p')
        expect(state.videoDurationSeconds).toBe(8)
        expect(state.workspaceId).toBe('ws-1')
        expect(state.aiChatThreadId).toBe('thread-1')
        expect(state.mediaFanoutPlan.imageSize).toBe('1024x1024')
        expect(state.mediaFanoutPlan.videoAspectRatio).toBe('16:9')
        expect(state.mediaFanoutPlan.videoResolution).toBe('720p')
        expect(state.mediaFanoutPlan.videoDuration).toBe('8')
        expect(state.mediaFanoutPlan.imageModels).toBeInstanceOf(Array)
        expect(state.mediaFanoutPlan.videoModels).toBeInstanceOf(Array)
        expect(state.generationRun.reasoningRunId).toContain('reasoning:0')
        expect(state.generationRun.reasoningIndex).toBe(0)
        expect(state.generationRun.reasoningModelId).toBe('Anthropic:claude-sonnet-4-6')
    })

    it('forwards every shared-preflight resolution field (incl. video reference images) to each fanout child', async () => {
        // Regression guard: matrix children run with preflightResolved=true and
        // never re-run the resolver, so any reference the shared preflight selected
        // must be forwarded here or the video model silently runs as text-to-video
        // (and image references would depend on a single fragile path). This asserts
        // the whole resolved patch — video AND image side — rides along to the child.
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)
        const getAiModel = vi.spyOn(AiModelModelModule.default, 'getAiModel')

        getAiModel.mockImplementation(async ({ model }: { provider: string; model: string }) => {
            if (model === 'claude-sonnet-4-6') {
                return {
                    provider: 'Anthropic',
                    model: 'claude-sonnet-4-6',
                    modelVersion: 'claude-sonnet-4-6',
                    modalities: [{ modality: 'text' }],
                } as any
            }
            if (model === 'gemini-2.5-flash-image') {
                return {
                    provider: 'Google',
                    model: 'gemini-2.5-flash-image',
                    modelVersion: 'gemini-2.5-flash-image',
                    modalities: [{ modality: 'image_generation' }],
                } as any
            }
            return {
                provider: 'Google',
                model: 'veo-3.1-generate-preview',
                modelVersion: 'veo-3.1-generate-preview',
                modalities: [{ modality: 'video_generation' }],
                videoAspectRatios: [{ value: '16:9' }],
                videoResolutions: [{ value: '720p' }],
                videoDurations: [{ value: '8' }],
            } as any
        })

        vi.spyOn(workspaceContextResolver, 'resolveWorkspaceContext').mockResolvedValue({})
        vi.spyOn(capabilityStateResolver, 'executeRequiredCapabilitiesForState').mockResolvedValue({
            referenceImages: ['data:image/png;base64,IMG-REF'],
            capabilityReferenceImages: ['data:image/png;base64,CAPABILITY-REF'],
        } as any)
        vi.spyOn(mediaBranchResolver, 'resolveMediaBranch').mockResolvedValue({
            mediaBranchResolution: { mode: 'fresh-branch', referenceCandidateIds: ['node-a', 'node-b'] },
            videoReferenceImages: ['data:image/png;base64,VIDEO-REF-1', 'data:image/png;base64,VIDEO-REF-2'],
        } as any)

        await orchestrator.process(createRequest())

        expect(registry.process).toHaveBeenCalledOnce()
        const childState = registry.process.mock.calls[0]?.[2] as any
        // Video conditioning references survive the preflight → fanout hop (the bug).
        expect(childState.videoReferenceImages).toEqual([
            'data:image/png;base64,VIDEO-REF-1',
            'data:image/png;base64,VIDEO-REF-2',
        ])
        // Image-side + visual-capability resolution ride along too (covers all media types).
        expect(childState.referenceImages).toEqual(['data:image/png;base64,IMG-REF'])
        expect(childState.capabilityReferenceImages).toEqual(['data:image/png;base64,CAPABILITY-REF'])
        expect(childState.mediaBranchResolution?.referenceCandidateIds).toEqual(['node-a', 'node-b'])
        // Per-child identity still wins over the spread; preflight stays marked done.
        expect(childState.preflightResolved).toBe(true)
        expect(childState.videoModelMetaInfo?.model).toBe('veo-3.1-generate-preview')
    })

    it('keeps existing media-field values when preflight resolvers return undefined for those fields', async () => {
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)
        const getAiModel = vi.spyOn(AiModelModelModule.default, 'getAiModel')

        getAiModel.mockImplementation(async ({ model }: { provider: string; model: string }) => {
            if (model === 'claude-sonnet-4-6') {
                return {
                    provider: 'Anthropic',
                    model: 'claude-sonnet-4-6',
                    modelVersion: 'claude-sonnet-4-6',
                    modalities: [{ modality: 'text' }],
                } as any
            }
            if (model === 'gemini-2.5-flash-image') {
                return {
                    provider: 'Google',
                    model: 'gemini-2.5-flash-image',
                    modelVersion: 'gemini-2.5-flash-image',
                    modalities: [{ modality: 'image_generation' }],
                } as any
            }
            return {
                provider: 'Google',
                model: 'veo-3.1-generate-preview',
                modelVersion: 'veo-3.1-generate-preview',
                modalities: [{ modality: 'video_generation' }],
                videoAspectRatios: [{ value: '16:9' }],
                videoResolutions: [{ value: '720p' }],
                videoDurations: [{ value: '8' }],
            } as any
        })

        vi.spyOn(workspaceContextResolver, 'resolveWorkspaceContext').mockResolvedValue({})
        vi.spyOn(capabilityStateResolver, 'executeRequiredCapabilitiesForState').mockResolvedValue({
            capabilityReferenceImages: undefined,
            capabilityUsagePrompt: undefined,
        } as any)
        vi.spyOn(mediaBranchResolver, 'resolveMediaBranch').mockResolvedValue({
            mediaBranchResolution: { mode: 'fresh-branch' },
            videoReferenceImages: undefined as any,
            __futureMediaConditioning: undefined as any,
        } as any)

        await orchestrator.process(createRequest({
            ...createRequest(),
            videoReferenceImages: ['request-video-reference'],
            capabilityReferenceImages: ['request-capability-reference'],
        } as any))

        expect(registry.process).toHaveBeenCalledOnce()
        const childState = registry.process.mock.calls[0]?.[2] as any
        expect(childState.videoReferenceImages).toEqual(['request-video-reference'])
        expect(childState.capabilityReferenceImages).toEqual(['request-capability-reference'])
        // Undefined from shared-resolvers must stay absent from the resolved patch.
        expect((childState as Record<string, any>).__futureMediaConditioning).toBeUndefined()
    })

    it('projects one preassigned Tool output through standard lineage without selected-model fanout', async () => {
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)
        const getAiModel = vi.spyOn(AiModelModelModule.default, 'getAiModel')
        const resolveMediaBranchSpy = vi.spyOn(mediaBranchResolver, 'resolveMediaBranch')

        getAiModel.mockImplementation(async ({ model }: { provider: string; model: string }) => {
            if (model === 'claude-sonnet-4-6') {
                return {
                    provider: 'Anthropic',
                    model,
                    modelVersion: model,
                    modalities: [{ modality: 'text' }],
                } as any
            }
            if (model === 'gemini-2.5-flash-image') {
                return {
                    provider: 'Google',
                    model,
                    modelVersion: model,
                    modalities: [{ modality: 'image_generation' }],
                } as any
            }
            return {
                provider: 'Google',
                model,
                modelVersion: model,
                modalities: [{ modality: 'video_generation' }],
                videoAspectRatios: [{ value: '16:9' }],
                videoResolutions: [{ value: '720p' }],
                videoDurations: [{ value: '8' }],
            } as any
        })

        vi.spyOn(workspaceContextResolver, 'resolveWorkspaceContext').mockResolvedValue({})
        resolveMediaBranchSpy.mockResolvedValue({})
        assetModelMocks.getAssetRecord.mockResolvedValue({
            assetId: 'asset-character-sheet',
            media: { kind: 'image' },
            lineage: {
                generationRequestId: 'request-matrix-1',
                reasoningRunId: 'capability-run-1',
                reasoningModelId: 'capability:character-creator',
                mediaRunId: 'capability-run-1:image:0',
                mediaModelId: 'Google:imagen',
            },
        })
        vi.spyOn(capabilityStateResolver, 'executeRequiredCapabilitiesForState').mockResolvedValue({
            capabilityOutputAssetIds: ['asset-character-sheet'],
            capabilityToolResults: [{
                capabilityId: 'global.character-creator',
                runId: 'run-1',
                output: { assetId: 'asset-character-sheet' },
            }],
            enableImageGeneration: false,
            enableVideoGeneration: false,
        })

        await orchestrator.process(createRequest())

        expect(resolveMediaBranchSpy).toHaveBeenCalledOnce()
        expect(generatedAssetStorageMocks.ensurePendingGeneratedAssets).toHaveBeenCalledWith(expect.objectContaining({
            lineagePlan: expect.objectContaining({
                runAssignments: [expect.objectContaining({
                    assetId: 'asset-character-sheet',
                    reasoningRunId: 'capability-run-1',
                    mediaRunId: 'capability-run-1:image:0',
                    mediaType: 'image',
                })],
            }),
        }))
        expect(registry.process).toHaveBeenCalledOnce()
        expect(registry.process.mock.calls[0]?.[2]).toMatchObject({
            capabilityOutputAssetIds: ['asset-character-sheet'],
            enableImageGeneration: false,
            enableVideoGeneration: false,
            preflightResolved: true,
        })
        expect(registry.process.mock.calls[0]?.[2].mediaBranchLineagePlan.runAssignments).toHaveLength(1)
    })

    it('rejects matrix requests when shared preflight fails and does not dispatch child processes', async () => {
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)
        const getAiModel = vi.spyOn(AiModelModelModule.default, 'getAiModel')
        const workspaceContextSpy = vi.spyOn(workspaceContextResolver, 'resolveWorkspaceContext')
        const resolveCapabilitiesSpy = vi.spyOn(capabilityStateResolver, 'executeRequiredCapabilitiesForState')
        const resolveMediaBranchSpy = vi.spyOn(mediaBranchResolver, 'resolveMediaBranch')

        getAiModel.mockImplementation(async ({ model }: { provider: string; model: string }) => {
            if (model === 'claude-sonnet-4-6') {
                return {
                    provider: 'Anthropic',
                    model: 'claude-sonnet-4-6',
                    modelVersion: 'claude-sonnet-4-6',
                    modalities: [{ modality: 'text' }],
                } as any
            }
            if (model === 'gemini-2.5-flash-image') {
                return {
                    provider: 'Google',
                    model: 'gemini-2.5-flash-image',
                    modelVersion: 'gemini-2.5-flash-image',
                    modalities: [{ modality: 'image_generation' }],
                } as any
            }
            return {
                provider: 'Google',
                model: 'veo-3.1-generate-preview',
                modelVersion: 'veo-3.1-generate-preview',
                modalities: [{ modality: 'video_generation' }],
                videoAspectRatios: [{ value: '16:9' }],
                videoResolutions: [{ value: '720p' }],
                videoDurations: [{ value: '8' }],
            } as any
        })

        workspaceContextSpy.mockRejectedValue(new Error('workspace context resolver failed'))
        resolveCapabilitiesSpy.mockResolvedValue({})
        resolveMediaBranchSpy.mockResolvedValue({})

        await expect(
            orchestrator.process(createRequest()),
        ).rejects.toThrow('workspace context resolver failed')

        expect(workspaceContextSpy).toHaveBeenCalledOnce()
        expect(resolveCapabilitiesSpy).not.toHaveBeenCalled()
        expect(resolveMediaBranchSpy).not.toHaveBeenCalled()
        expect(registry.process).not.toHaveBeenCalled()
    })

    it('rejects metrics admission before shared preflight persists pending media lineage', async () => {
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)
        const getAiModel = vi.spyOn(AiModelModelModule.default, 'getAiModel')
        const workspaceContextSpy = vi.spyOn(workspaceContextResolver, 'resolveWorkspaceContext')

        getAiModel.mockImplementation(async ({ model }: { provider: string; model: string }) => {
            if (model === 'claude-sonnet-4-6') {
                return { provider: 'Anthropic', model, modelVersion: model, modalities: [{ modality: 'text' }] } as any
            }
            if (model === 'gemini-2.5-flash-image') {
                return { provider: 'Google', model, modelVersion: model, modalities: [{ modality: 'image_generation' }] } as any
            }
            return { provider: 'Google', model, modelVersion: model, modalities: [{ modality: 'video_generation' }] } as any
        })
        registry.preflightAdmission.mockRejectedValueOnce(new Error('Metrics: balance does not cover this workflow'))

        await expect(orchestrator.process(createRequest())).rejects.toThrow('Metrics: balance does not cover this workflow')

        expect(workspaceContextSpy).not.toHaveBeenCalled()
        expect(generatedAssetStorageMocks.ensurePendingGeneratedAssets).not.toHaveBeenCalled()
        expect(registry.process).not.toHaveBeenCalled()
        expect(registry.remove).toHaveBeenCalledOnce()
    })

    it('propagates every preflight-resolved field — including a future media field — to every fanout child', async () => {
        // Higher-level enforcement of the fix: the fanout spreads the WHOLE resolved
        // patch from runSharedPreflight(), so any field a resolver emits reaches every
        // reasoning child. `__futureMediaConditioning` stands in for a media modality
        // that does not exist yet — it has no bespoke handling anywhere, yet it must
        // still ride along. If this fails, the fanout was reverted to an enumerated
        // allow-list and a media reference will be silently dropped (the text-to-video
        // regression). This guards images, video, AND future media uniformly.
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)
        const getAiModel = vi.spyOn(AiModelModelModule.default, 'getAiModel')

        getAiModel.mockImplementation(async ({ model }: { provider: string; model: string }) => {
            if (model === 'claude-3-opus-20240229') {
                return { provider: 'Anthropic', model: 'claude-3-opus-20240229', modelVersion: 'claude-3-opus-20240229', modalities: [{ modality: 'text' }] } as any
            }
            if (model === 'claude-3-sonnet-20240229') {
                return { provider: 'Anthropic', model: 'claude-3-sonnet-20240229', modelVersion: 'claude-3-sonnet-20240229', modalities: [{ modality: 'text' }] } as any
            }
            return { provider: 'Google', model: 'gemini-2.5-flash-image', modelVersion: 'gemini-2.5-flash-image', modalities: [{ modality: 'image_generation' }] } as any
        })

        vi.spyOn(workspaceContextResolver, 'resolveWorkspaceContext').mockResolvedValue({
            workspaceContextResolution: { rationale: 'ctx' },
        } as any)
        vi.spyOn(capabilityStateResolver, 'executeRequiredCapabilitiesForState').mockResolvedValue({
            capabilityReferenceImages: ['data:image/png;base64,CAPABILITY'],
            capabilityUsagePrompt: 'USE THIS VISUAL CAPABILITY',
            referenceImages: ['data:image/png;base64,CAPABILITY'],
        } as any)
        vi.spyOn(mediaBranchResolver, 'resolveMediaBranch').mockResolvedValue({
            mediaBranchResolution: { mode: 'fresh-branch' },
            videoReferenceImages: ['data:image/png;base64,VID-1', 'data:image/png;base64,VID-2'],
            __futureMediaConditioning: ['data:image/png;base64,FUTURE'],
        } as any)

        await orchestrator.process(createRequest({
            aiReasoningModels: undefined,
            aiImageModels: ['Google:gemini-2.5-flash-image'],
            aiVideoModels: undefined,
            mediaGenerationRequest: {
                requestVersion: 'media-generation-matrix-v1',
                generationRequestId: 'req-probe',
                reasoningModelIds: ['Anthropic:claude-3-opus-20240229', 'Anthropic:claude-3-sonnet-20240229'],
                imageModelIds: ['Google:gemini-2.5-flash-image'],
                videoModelIds: [],
                imageOptions: { imageSize: '1024x1024' },
                videoOptions: {},
            },
        }))

        expect(registry.process).toHaveBeenCalledTimes(2)
        for (const call of registry.process.mock.calls) {
            const childState = call[2] as any
            expect(childState.videoReferenceImages).toEqual(['data:image/png;base64,VID-1', 'data:image/png;base64,VID-2'])
            expect(childState.referenceImages).toEqual(['data:image/png;base64,CAPABILITY'])
            expect(childState.capabilityReferenceImages).toEqual(['data:image/png;base64,CAPABILITY'])
            expect(childState.capabilityUsagePrompt).toBe('USE THIS VISUAL CAPABILITY')
            expect(childState.mediaBranchResolution).toEqual({ mode: 'fresh-branch' })
            expect(childState.workspaceContextResolution).toEqual({ rationale: 'ctx' })
            // A modality with no bespoke handling anywhere still rides along — future-proofing.
            expect(childState.__futureMediaConditioning).toEqual(['data:image/png;base64,FUTURE'])
            expect(childState.preflightResolved).toBe(true)
        }
    })

    it('normalizes malformed model identifiers and deduplicates model ids before lookup', async () => {
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)
        const getAiModel = vi.spyOn(AiModelModelModule.default, 'getAiModel')

        getAiModel.mockImplementation(async ({ model }: { provider: string; model: string }) => {
            if (model === 'claude-sonnet-4-6') {
                return {
                    provider: 'Anthropic',
                    model: 'claude-sonnet-4-6',
                    modelVersion: 'claude-sonnet-4-6',
                    modalities: [{ modality: 'text' }],
                } as any
            }
            if (model === 'gemini-image-a') {
                return {
                    provider: 'Google',
                    model: 'gemini-image-a',
                    modelVersion: 'gemini-image-a',
                    modalities: [{ modality: 'image_generation' }],
                    imageSizes: [{ value: '1024x1024' }, { value: '768x768' }],
                } as any
            }
            return {
                provider: 'Google',
                model: 'gemini-image-b',
                modelVersion: 'gemini-image-b',
                modalities: [{ modality: 'image_generation' }],
                imageSizes: [{ value: '640x480' }, { value: '800x600' }],
            } as any
        })

        vi.spyOn(workspaceContextResolver, 'resolveWorkspaceContext').mockResolvedValue({})
        vi.spyOn(capabilityStateResolver, 'executeRequiredCapabilitiesForState').mockResolvedValue({})
        vi.spyOn(mediaBranchResolver, 'resolveMediaBranch').mockResolvedValue({})

        await orchestrator.process(createRequest({
            aiReasoningModels: undefined,
            aiImageModels: undefined,
            aiVideoModels: undefined,
            mediaGenerationRequest: {
                requestVersion: 'media-generation-matrix-v1',
                generationRequestId: 'request-normalize',
                reasoningModelIds: ['Anthropic:claude-sonnet-4-6'],
                imageModelIds: [' Google:gemini-image-a ', 'Google:gemini-image-a', 'Google:gemini-image-b '],
                videoModelIds: [],
                imageOptions: {
                    imageSize: '1024x1024',
                    configGroups: [],
                },
                videoOptions: {},
                useMultipleImageModels: true,
            },
        }))

        const lookedUpModels = getAiModel.mock.calls.map((call) => call?.[0]?.model)
        expect(getAiModel).toHaveBeenCalledTimes(3)
        expect(lookedUpModels).toEqual([
            'claude-sonnet-4-6',
            'gemini-image-a',
            'gemini-image-b',
        ])
    })

    it('applies model-specific config groups and normalizes invalid option values', async () => {
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)
        const getAiModel = vi.spyOn(AiModelModelModule.default, 'getAiModel')

        getAiModel.mockImplementation(async ({ model }: { provider: string; model: string }) => {
            if (model === 'claude-sonnet-4-6') {
                return {
                    provider: 'Anthropic',
                    model: 'claude-sonnet-4-6',
                    modelVersion: 'claude-sonnet-4-6',
                    modalities: [{ modality: 'text' }],
                } as any
            }
            if (model === 'gemini-image-a') {
                return {
                    provider: 'Google',
                    model: 'gemini-image-a',
                    modelVersion: 'gemini-image-a',
                    modalities: [{ modality: 'image_generation' }],
                    imageSizes: [{ value: '256x256' }, { value: '512x512' }],
                } as any
            }
            if (model === 'gemini-image-b') {
                return {
                    provider: 'Google',
                    model: 'gemini-image-b',
                    modelVersion: 'gemini-image-b',
                    modalities: [{ modality: 'image_generation' }],
                    imageSizes: [{ value: '1024x1024' }, { value: '2048x2048' }],
                } as any
            }
            return {
                provider: 'Google',
                model: 'veo-3.1-generate-preview',
                modelVersion: 'veo-3.1-generate-preview',
                modalities: [{ modality: 'video_generation' }],
                videoAspectRatios: [{ value: '16:9' }, { value: '4:3' }],
                videoResolutions: [{ value: '720p' }, { value: '1080p' }],
                videoDurations: [{ value: '8' }, { value: '12' }],
            } as any
        })

        vi.spyOn(workspaceContextResolver, 'resolveWorkspaceContext').mockResolvedValue({})
        vi.spyOn(capabilityStateResolver, 'executeRequiredCapabilitiesForState').mockResolvedValue({})
        vi.spyOn(mediaBranchResolver, 'resolveMediaBranch').mockResolvedValue({})

        await orchestrator.process(createRequest({
            aiReasoningModels: undefined,
            aiImageModels: undefined,
            aiVideoModels: undefined,
            mediaGenerationRequest: {
                requestVersion: 'media-generation-matrix-v1',
                generationRequestId: 'request-options',
                reasoningModelIds: ['Anthropic:claude-sonnet-4-6'],
                imageModelIds: ['Google:gemini-image-a', 'Google:gemini-image-b'],
                videoModelIds: ['Google:veo-3.1-generate-preview'],
                useMultipleImageModels: true,
                useMultipleVideoModels: true,
                imageOptions: {
                    imageSize: '1024x1024',
                    configGroups: [
                        {
                            groupId: 'img-a',
                            modelIds: ['Google:gemini-image-a'],
                            values: { imageSize: 'invalid-size' },
                        },
                        {
                            groupId: 'img-b',
                            modelIds: ['Google:gemini-image-b'],
                            values: { imageSize: '1024x1024' },
                        },
                        {
                            groupId: 'ignore-me',
                            modelIds: ['Google:does-not-exist'],
                            values: { imageSize: '128x128' },
                        },
                    ],
                },
                videoOptions: {
                    aspectRatio: '16:9',
                    configGroups: [
                        {
                            groupId: 'vid-only',
                            modelIds: ['Google:veo-3.1-generate-preview'],
                            values: { aspectRatio: '4:3', duration: '12', resolution: '1080p' },
                        },
                    ],
                },
            },
        }))

        const state = registry.process.mock.calls[0]?.[2] as any
        expect(state.mediaFanoutPlan.imageConfigGroups).toHaveLength(2)
        expect(state.mediaFanoutPlan.imageConfigGroups.some((group: any) => group.groupId === 'img-a')).toBe(true)
        expect(state.mediaFanoutPlan.imageConfigGroups.some((group: any) => group.groupId === 'img-b')).toBe(true)
        expect(state.mediaFanoutPlan.imageModelOptions?.['Google:gemini-image-a']).toMatchObject({
            imageSize: '256x256',
        })
        expect(state.mediaFanoutPlan.imageModelOptions?.['Google:gemini-image-b']).toMatchObject({
            imageSize: '1024x1024',
        })
        expect(state.mediaFanoutPlan.videoModelOptions?.['Google:veo-3.1-generate-preview']).toMatchObject({
            aspectRatio: '4:3',
            resolution: '1080p',
            duration: '12',
        })
        expect(state.videoDurationSeconds).toBe(12)
    })

    it('throws on malformed model ids before any model metadata fetch', async () => {
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)
        const getAiModel = vi.spyOn(AiModelModelModule.default, 'getAiModel')

        await expect(
            orchestrator.process({
                workspaceId: 'ws-1',
                aiChatThreadId: 'thread-1',
                mediaGenerationRequest: {
                    requestVersion: 'media-generation-matrix-v1',
                    generationRequestId: 'request-invalid-id',
                    reasoningModelIds: ['BadReasoningId'],
                    imageModelIds: ['Google:gemini-2.5-flash-image'],
                    videoModelIds: ['Google:veo-3.1-generate-preview'],
                    imageOptions: { imageSize: '1024x1024' },
                    videoOptions: {},
                },
            } as any),
        ).rejects.toThrow('Invalid AI model id: BadReasoningId')

        expect(getAiModel).toHaveBeenCalled()
        expect(registry.process).not.toHaveBeenCalled()
    })

    it('forwards stop calls to the provider registry', async () => {
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)

        await orchestrator.stop({ workspaceId: 'ws-1', aiChatThreadId: 'thread-1', generationRequestId: 'request-1' })

        expect(registry.stopGroup).toHaveBeenCalledWith(buildMediaGenerationRequestGroupKey('ws-1', 'thread-1', 'request-1'))
        expect(registry.stopGroupsWithPrefix).not.toHaveBeenCalled()
    })

    it('forwards stop-all-thread to the provider registry when no generation request id is present', async () => {
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)

        await orchestrator.stop({ workspaceId: 'ws-1', aiChatThreadId: 'thread-1' })

        expect(registry.stopGroupsWithPrefix).toHaveBeenCalledWith('ws-1:thread-1:')
        expect(registry.stopGroup).not.toHaveBeenCalled()
    })

    it('bubbles an AI-model-not-found error during model resolution', async () => {
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)
        const getAiModel = vi.spyOn(AiModelModelModule.default, 'getAiModel')

        getAiModel.mockResolvedValue(undefined)

        await expect(
            orchestrator.process(createRequest()),
        ).rejects.toThrow('AI model not found: Anthropic:claude-sonnet-4-6')
        expect(registry.process).not.toHaveBeenCalled()
    })
})
