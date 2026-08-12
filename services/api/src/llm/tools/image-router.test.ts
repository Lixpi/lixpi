'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as debugTools from '@lixpi/debug-tools'

import { ImageRouter } from './image-router.ts'
import { ImagePublisher } from '../graph/image-publisher.ts'
import type { ProviderState } from '../graph/state.ts'

function createState(overrides: Partial<ProviderState> = {}): ProviderState {
    return {
        messages: [{ role: 'user', content: 'paint this cat' }],
        aiModelMetaInfo: {
            provider: 'Anthropic',
            model: 'claude-sonnet-4-6',
            modelVersion: 'claude-sonnet-4-6',
            maxCompletionSize: 4096,
        },
        eventMeta: { organizationId: 'org-1', userId: 'user-1' },
        workspaceId: 'workspace-1',
        aiChatThreadId: 'thread-1',
        instanceKey: 'workspace-1:thread-1',
        provider: 'Anthropic',
        modelVersion: 'claude-sonnet-4-6',
        temperature: 0.7,
        streamActive: false,
        aiRequestReceivedAt: 1,
        enableImageGeneration: true,
        imageSize: '1024x1024',
        imageModelMetaInfo: {
            provider: 'Google',
            model: 'Gemini Image',
            modelVersion: 'gemini-2.5-flash-image',
            imageReferenceCapabilities: {
                maxReferenceImages: 14,
                maxIdentityReferenceImages: 5,
                conditioningModes: ['edit', 'identity', 'style', 'structure', 'pose'],
                inputFidelity: 'provider-managed',
                supportsIterativeEdit: true,
                supportsMask: false,
                supportsStructureControl: true,
                supportsPoseControl: true,
                supportsDeterministicSeed: false,
                maxOutputPixels: 4194304,
                supportedAspectRatios: ['1:1', '3:2', '2:3'],
            },
        },
        imageModelVersion: 'gemini-2.5-flash-image',
        imageProviderName: 'Google',
        generatedImagePrompt: 'Paint a cat in watercolor with the new style.',
        referenceImages: ['data:image/png;base64,cat-ref'],
        imagePromptRetryCount: 0,
        ...overrides,
    }
}

type ProcessResult = { generatedImages?: string[]; error?: string; imageUsage?: ProviderState['imageUsage'] }

const createRouter = (
    processResult: ProcessResult | ProcessResult[] = { generatedImages: ['nats-obj://workspace-workspace-1-files/cat.png'] },
) => {
    const results = Array.isArray(processResult) ? processResult : [processResult]
    const process = vi.fn(async () => results[Math.min(process.mock.calls.length - 1, results.length - 1)] as ProviderState)
    const createTransient = vi.fn(() => ({ process }))
    const router = new ImageRouter({ createTransient } as any)
    return { router, createTransient, process }
}

let debugInfoSpy: ReturnType<typeof vi.spyOn> | null = null
let debugWarnSpy: ReturnType<typeof vi.spyOn> | null = null
let debugErrSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
    debugInfoSpy = vi.spyOn(debugTools, 'info').mockImplementation(() => undefined)
    debugWarnSpy = vi.spyOn(debugTools, 'warn').mockImplementation(() => undefined)
    debugErrSpy = vi.spyOn(debugTools, 'err').mockImplementation(() => undefined)
})

afterEach(() => {
    debugInfoSpy?.mockRestore()
    debugInfoSpy = null
    debugWarnSpy?.mockRestore()
    debugWarnSpy = null
    debugErrSpy?.mockRestore()
    debugErrSpy = null
})

describe('ImageRouter', () => {
    it('returns empty update when provider, model, or prompt is missing', async () => {
        const { router, createTransient } = createRouter()

        const result = await router.execute(createState({
            imageProviderName: undefined,
            imageModelVersion: undefined,
            generatedImagePrompt: undefined,
        }))

        expect(result).toEqual({})
        expect(createTransient).not.toHaveBeenCalled()
    })

    it('passes onProseMirrorContent through to the transient image provider request', async () => {
        const { router, process } = createRouter()
        const state = createState()
        const onProseMirrorContent = vi.fn()

        await router.execute(state, { onProseMirrorContent })

        const requestData = process.mock.calls[0]?.[0]
        expect(requestData).toMatchObject({
            proseMirrorContentHandler: onProseMirrorContent,
        })
    })

    it('requests capture-only generation without media persistence when configured', async () => {
        const { router, process } = createRouter()

        await router.execute(createState(), { captureOnly: true })

        expect(process.mock.calls[0]?.[0]).toMatchObject({
            captureOnlyImageGeneration: true,
        })
    })

    it('routes image generation and applies provider mapping defaults', async () => {
        const { router, createTransient, process } = createRouter()
        const state = createState({ eventMeta: { organizationId: 'organization-1' } })

        const result = await router.execute(state)

        expect(createTransient).toHaveBeenCalledWith('workspace-1:thread-1:image', 'Google')
        expect(process).toHaveBeenCalledTimes(1)
        const requestData = process.mock.calls[0]?.[0]
        expect(requestData).toMatchObject({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            enableImageGeneration: true,
            imageSize: '1:1',
            generationRun: undefined,
            eventMeta: state.eventMeta,
            organizationId: 'organization-1',
        })
        expect(requestData.aiModelMetaInfo).toMatchObject({
            provider: 'Google',
            model: 'Gemini Image',
            modelVersion: 'gemini-2.5-flash-image',
        })
        expect(requestData.messages).toEqual([{ role: 'user', content: expect.any(String) }])
        expect(requestData.imageGenerationReferences).toEqual([{
            url: 'data:image/png;base64,cat-ref',
            role: 'source-reference',
            fileName: 'source-reference-1',
        }])
        expect(result.generatedImages).toEqual(['nats-obj://workspace-workspace-1-files/cat.png'])
        expect(result.imageUsage).toMatchObject({
            generatedCount: 1,
            size: '1:1',
            quality: 'high',
        })
    })

    it('submits plain text content when no reference images are present', async () => {
        const { router, createTransient, process } = createRouter()

        await router.execute(createState({
            referenceImages: [],
        }))

        expect(createTransient).toHaveBeenCalledWith('workspace-1:thread-1:image', 'Google')
        const requestData = process.mock.calls[0]?.[0]
        expect(requestData.messages).toEqual([{
            role: 'user',
            content: expect.any(String),
        }])
    })

    it('returns an error when the transient provider fails without images', async () => {
        const { router, process } = createRouter({ error: 'Image provider failed', generatedImages: [] })

        const result = await router.execute(createState())

        expect(process).toHaveBeenCalledOnce()
        expect(result.error).toBe('Image provider failed')
    })

    it('returns a provider-completion error when no image is emitted', async () => {
        const { router, process } = createRouter({ generatedImages: [] })

        const result = await router.execute(createState())

        expect(process).toHaveBeenCalledOnce()
        expect(result.error).toBe('Image generation failed: provider completed without a generated image')
    })

    it('uses mediaRunId instance keys for fan-out children', async () => {
        const { router, createTransient } = createRouter()
        const generationRun = {
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            reasoningIndex: 0,
            mediaRunId: 'reasoning-1:image:1',
            mediaModelId: 'Google:gemini-2.5-flash-image',
            mediaType: 'image',
            mediaIndex: 1,
            variantIndex: 2,
        } as const

        await router.execute(createState({ generationRun }))

        expect(createTransient).toHaveBeenCalledWith('workspace-1:thread-1:reasoning-1:image:1', 'Google')
    })

    it('derives a media-run instance key when generationRun has no explicit mediaRunId', async () => {
        const { router, createTransient } = createRouter()
        const generationRun = {
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            reasoningIndex: 0,
        } as const

        await router.execute(createState({ generationRun }))

        expect(createTransient).toHaveBeenCalledWith('workspace-1:thread-1:reasoning-1:image:0', 'Google')
    })

    it('removes the transient image provider even when processing throws', async () => {
        const remove = vi.fn()
        const process = vi.fn(async () => {
            throw new Error('image provider crash')
        })
        const createTransient = vi.fn(() => ({ process }))
        const router = new ImageRouter({ createTransient, remove } as any)

        const result = await router.execute(createState())

        expect(process).toHaveBeenCalledOnce()
        expect(result.error).toBe('image provider crash')
        expect(remove).toHaveBeenCalledWith('workspace-1:thread-1:image')
    })

    it('stops an active transient provider when the caller aborts', async () => {
        const controller = new AbortController()
        const stop = vi.fn(async () => undefined)
        let completeProcessing: ((state: ProviderState) => void) | undefined
        const process = vi.fn(() => new Promise<ProviderState>((resolve) => {
            completeProcessing = resolve
        }))
        const createTransient = vi.fn(() => ({ process }))
        const router = new ImageRouter({ createTransient, stop } as any)

        const execution = router.execute(createState(), { signal: controller.signal })
        await vi.waitFor(() => expect(process).toHaveBeenCalledOnce())

        controller.abort()
        await vi.waitFor(() => {
            expect(stop).toHaveBeenCalledWith('workspace-1:thread-1:image')
        })
        completeProcessing?.(createState({
            generatedImages: ['nats-obj://workspace-workspace-1-files/cat.png'],
        }))

        await execution
    })

    it('delegates a Character Creator media plan to its registered strategy and returns the final PNG for normal settlement', async () => {
        const complete = vi.spyOn(ImagePublisher.prototype, 'complete').mockResolvedValue(undefined)
        const execute = vi.fn(async () => ({
            generatedImages: ['final-character-sheet-base64'],
            imageUsage: { generatedCount: 27, size: '3840x2560', quality: 'high' },
            capabilityMediaTrace: { schemaVersion: 'character-sheet-trace-v1' },
        }))
        const get = vi.fn(() => ({ execute }))
        const createTransient = vi.fn()
        const plan = {
            kind: 'character-sheet',
            capabilityRunId: 'run-1',
            sourceAssetIds: ['asset-1'],
            userPrompt: 'Create a combie character out of this photo.',
            panels: [],
            layoutId: 'character-sheet-3840x2560',
            semanticRetryLimit: 1,
        } as any
        const state = createState({
            capabilityUsageMode: 'character-creator',
            capabilityMediaExecutionPlan: plan,
            generatedImagePrompt: 'Create an adorable chibi cartoon with a large head and small body.',
            providerSafeMediaIntent: { safePrompt: 'Create a combie character out of this photo.' } as any,
            mediaReferenceBindings: [{
                subjectIdentity: { classification: 'self' },
            }] as any,
            capabilityUsagePrompt: 'Apply the sibling visual-style Capability.',
            capabilityReferenceImages: ['data:image/png;base64,U1RZTEU='],
            capabilityReferenceImageTraceUrls: ['/api/capabilities/style/resources/sample-1'],
            capabilityToolResults: [
                { capabilityId: 'character-creator', runId: 'character-run', output: {} },
                { capabilityId: 'visual-style', runId: 'style-run', output: { style: 'watercolor' } },
            ],
            generationRun: {
                generationRequestId: 'request-1',
                reasoningRunId: 'reasoning-1',
                reasoningModelId: 'Anthropic:claude-sonnet-4-6',
                reasoningIndex: 0,
                mediaRunId: 'reasoning-1:image:0',
                mediaModelId: 'Google:gemini-2.5-flash-image',
                mediaType: 'image',
                mediaIndex: 0,
                variantIndex: 0,
            },
            imageSize: '1024x1024',
        })
        const router = new ImageRouter({ createTransient } as any, { get } as any, {} as any)

        try {
            const result = await router.execute(state)

            expect(get).toHaveBeenCalledWith(plan)
            expect(execute).toHaveBeenCalledWith(expect.objectContaining({
                organizationId: 'org-1',
                userId: 'user-1',
                workspaceId: 'workspace-1',
                conversationAssetId: 'thread-1',
                reasoningModel: expect.objectContaining({ provider: 'Anthropic' }),
                imageModel: expect.objectContaining({ provider: 'Google' }),
                sharedState: {
                    authoritativePrompt: 'Create a combie character out of this photo.',
                    sourceSubjectIdentityClassifications: ['self'],
                    capabilityInstructions: ['Apply the sibling visual-style Capability.'],
                    capabilityReferences: [{
                        imageUrl: 'data:image/png;base64,U1RZTEU=',
                        traceUrl: '/api/capabilities/style/resources/sample-1',
                    }],
                    capabilityOutputs: [
                        { capabilityId: 'character-creator', runId: 'character-run', output: {} },
                        { capabilityId: 'visual-style', runId: 'style-run', output: { style: 'watercolor' } },
                    ],
                },
            }), plan, expect.objectContaining({}))
            expect(complete).toHaveBeenCalledWith(expect.objectContaining({
                revisedPrompt: 'Create a combie character out of this photo.',
            }))
            expect(createTransient).not.toHaveBeenCalled()
            expect(result).toMatchObject({
                generatedImages: ['final-character-sheet-base64'],
                imageUsage: { generatedCount: 27, size: '3840x2560', quality: 'high' },
            })
        } finally {
            complete.mockRestore()
        }
    })

    it('returns a strategy preflight failure without calling an image provider', async () => {
        const execute = vi.fn(async () => {
            throw new Error('CHARACTER_CREATOR_IDENTITY_CONDITIONING_UNSUPPORTED')
        })
        const createTransient = vi.fn()
        const router = new ImageRouter({ createTransient } as any, {
            get: vi.fn(() => ({ execute })),
        } as any)

        const result = await router.execute(createState({
            capabilityMediaExecutionPlan: { kind: 'character-sheet' } as any,
        }))

        expect(result.error).toBe('CHARACTER_CREATOR_IDENTITY_CONDITIONING_UNSUPPORTED')
        expect(createTransient).not.toHaveBeenCalled()
    })
})
