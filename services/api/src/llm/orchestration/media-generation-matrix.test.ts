'use strict'

import { afterEach, describe, expect, it, vi } from 'vitest'

import * as AiModelModelModule from '../../models/ai-model.ts'
import * as featureResolver from '../graph/feature-resolver.ts'
import * as imageBranchResolver from '../graph/image-branch-resolver.ts'
import * as workspaceContextResolver from '../graph/workspace-context-resolver.ts'
import { buildMediaGenerationRequestGroupKey, MediaGenerationMatrixOrchestrator, type MatrixRequestData } from './media-generation-matrix.ts'

const natsService = { publish: vi.fn() } as any

const createRegistry = () => {
    const process = vi.fn(async () => ({ }))
    const stopGroup = vi.fn(async () => undefined)
    const stopGroupsWithPrefix = vi.fn(async () => undefined)
    const shutdown = vi.fn(async () => undefined)
    return {
        process,
        stopGroup,
        stopGroupsWithPrefix,
        shutdown,
        asRegistry: {
            process,
            stopGroup,
            stopGroupsWithPrefix,
            shutdown,
        },
    }
}

const createRequest = (overrides: Partial<MatrixRequestData> = {}): MatrixRequestData => ({
    workspaceId: 'ws-1',
    aiChatThreadId: 'thread-1',
    aiModel: 'Anthropic:claude-sonnet-4-6',
    aiImageModel: 'Google:gemini-2.5-flash-image',
    aiVideoModel: 'Google:veo-3.1-generate-preview',
    imageSize: '1024x1024',
    videoAspectRatio: '16:9',
    videoResolution: '720p',
    videoDuration: '8',
    ...overrides,
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('MediaGenerationMatrixOrchestrator key helpers', () => {
    it('builds deterministic request grouping keys', () => {
        expect(buildMediaGenerationRequestGroupKey('ws-1', 'thread-1', 'request-1'))
            .toBe('ws-1:thread-1:request-1')
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
        const resolveFeaturesSpy = vi.spyOn(featureResolver, 'resolveFeatures')
        const resolveImageBranchSpy = vi.spyOn(imageBranchResolver, 'resolveImageBranch')

        workspaceContextSpy.mockResolvedValue({})
        resolveFeaturesSpy.mockResolvedValue({})
        resolveImageBranchSpy.mockResolvedValue({})

        await orchestrator.process(createRequest({
            aiModel: undefined,
            aiImageModel: 'Google:gemini-2.5-flash-image',
            aiVideoModel: undefined,
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
        expect(state0.mediaFanoutPlan.imageModels).toHaveLength(1)
        expect(state0.mediaFanoutPlan.videoModels).toHaveLength(0)
        expect(state0.generationRun.reasoningRunId).toBe('request-2:reasoning:0')
        expect(state0.generationRun.reasoningIndex).toBe(0)
        expect(state1.generationRun.reasoningRunId).toBe('request-2:reasoning:1')
        expect(state1.generationRun.reasoningIndex).toBe(1)
        expect(state0.generationRun.lineageAssignment?.reasoningRunId).toBe('request-2:reasoning:0')
        expect(state1.generationRun.lineageAssignment?.reasoningRunId).toBe('request-2:reasoning:1')
        expect(state0.generationRun.lineageAssignment?.branchForkNodeId).toBe('branch-fork-request-2-reasoning-0')
    })

    it('rejects requests that resolve to neither image nor video generation models', async () => {
        const registry = createRegistry()
        const orchestrator = new MediaGenerationMatrixOrchestrator(registry.asRegistry as any, natsService)

        await expect(
            orchestrator.process(
                createRequest({
                    aiModel: 'Anthropic:claude-sonnet-4-6',
                    aiImageModel: undefined,
                    aiVideoModel: undefined,
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
        const resolveFeaturesSpy = vi.spyOn(featureResolver, 'resolveFeatures')
        const resolveImageBranchSpy = vi.spyOn(imageBranchResolver, 'resolveImageBranch')

        workspaceContextSpy.mockResolvedValue({})
        resolveFeaturesSpy.mockResolvedValue({})
        resolveImageBranchSpy.mockResolvedValue({})

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
