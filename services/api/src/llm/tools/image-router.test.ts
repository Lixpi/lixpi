'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as debugTools from '@lixpi/debug-tools'

import { ImageRouter } from './image-router.ts'
import type { ProviderState } from '../graph/state.ts'

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

function createState(overrides: Partial<ProviderState> = {}): ProviderState {
    return {
        messages: [{ role: 'user', content: 'paint this cat' }],
        aiModelMetaInfo: {
            provider: 'Anthropic',
            model: 'claude-sonnet-4-6',
            modelVersion: 'claude-sonnet-4-6',
            maxCompletionSize: 4096,
        },
        eventMeta: {},
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
        imageModelMetaInfo: { provider: 'Google', model: 'Gemini Image', modelVersion: 'gemini-2.5-flash-image' },
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

    it('runs Character Creator as layout synthesis followed by a source-conditioned fidelity edit', async () => {
        const { router, process, createTransient } = createRouter([
            {
                generatedImages: [TINY_PNG_BASE64],
                imageUsage: { generatedCount: 1, size: '3:2', quality: 'high' },
            },
            {
                generatedImages: ['nats-obj://workspace-workspace-1-files/character-sheet.png'],
                imageUsage: { generatedCount: 1, size: '3:2', quality: 'high' },
            },
        ])
        const state = createState({
            capabilityUsageMode: 'character-creator',
            capabilityUsagePrompt: 'Use the fixed multi-view layout.',
            capabilityReferenceImages: ['data:image/jpeg;base64,character-sheet-layout'],
            referenceImages: ['data:image/jpeg;base64,user-character-reference'],
        })

        const result = await router.execute(state)

        expect(process).toHaveBeenCalledTimes(2)
        expect(createTransient).toHaveBeenNthCalledWith(
            1,
            'workspace-1:thread-1:image:layout-synthesis',
            'Google',
        )
        expect(createTransient).toHaveBeenNthCalledWith(2, 'workspace-1:thread-1:image', 'Google')
        const layoutRequest = process.mock.calls[0]?.[0] as {
            messages: ProviderState['messages']
            imageGenerationReferences: ProviderState['imageGenerationReferences']
            captureOnlyImageGeneration: boolean
        }
        expect(layoutRequest.captureOnlyImageGeneration).toBe(true)
        expect(layoutRequest.messages).toHaveLength(1)
        expect(layoutRequest.messages[0]?.content).toEqual(
            expect.stringContaining('Image 1 is the authoritative character identity'),
        )
        expect(layoutRequest.messages[0]?.content).toEqual(
            expect.stringContaining('Image 2 is the authoritative output-layout template'),
        )
        expect(layoutRequest.imageGenerationReferences).toEqual([
            {
                url: 'data:image/jpeg;base64,user-character-reference',
                role: 'character-source',
                fileName: 'character-source-1',
            },
            {
                url: 'data:image/jpeg;base64,character-sheet-layout',
                role: 'character-layout-example',
                fileName: 'character-layout-example-1',
            },
        ])
        const fidelityRequest = process.mock.calls[1]?.[0] as {
            messages: ProviderState['messages']
            imageGenerationReferences: ProviderState['imageGenerationReferences']
            captureOnlyImageGeneration: boolean
        }
        expect(fidelityRequest.captureOnlyImageGeneration).toBe(false)
        expect(fidelityRequest.messages[0]?.content).toEqual(
            expect.stringContaining('CHARACTER FIDELITY RESTORATION EDIT'),
        )
        expect(fidelityRequest.messages[0]?.content).toEqual(
            expect.stringContaining('Do not clean up, beautify, photorealize, vectorize, smooth'),
        )
        expect(fidelityRequest.imageGenerationReferences).toEqual([
            {
                url: `data:image/png;base64,${TINY_PNG_BASE64}`,
                role: 'character-sheet-draft',
                fileName: 'character-sheet-draft',
            },
            {
                url: 'data:image/jpeg;base64,user-character-reference',
                role: 'character-source',
                fileName: 'character-source-1',
            },
        ])
        expect(result.imageUsage).toEqual({ generatedCount: 2, size: '3:2', quality: 'high' })
    })

    it('takes Character Creator source images from the authoritative branch resolution when reasoning extraction fails', async () => {
        const { router, process } = createRouter([
            { generatedImages: [TINY_PNG_BASE64] },
            { generatedImages: ['nats-obj://workspace-workspace-1-files/character-sheet.png'] },
        ])
        const state = createState({
            capabilityUsageMode: 'character-creator',
            capabilityUsagePrompt: 'Use the fixed multi-view layout.',
            capabilityReferenceImages: ['data:image/jpeg;base64,character-sheet-layout'],
            referenceImages: [],
            imageProviderName: 'OpenAI',
            imageModelVersion: 'gpt-image-2',
            imageModelMetaInfo: {
                provider: 'OpenAI',
                model: 'GPT Image 2',
                modelVersion: 'gpt-image-2',
            },
            mediaBranchCandidateSnapshot: {
                promptText: 'Create character',
                candidates: [{
                    nodeId: 'selected-character-node',
                    imageUrl: 'nats-obj://workspace-images/selected-character.png',
                }],
            } as any,
            mediaBranchResolution: {
                referenceCandidateIds: ['selected-character-node'],
            } as any,
        })

        await router.execute(state)

        expect(process).toHaveBeenCalledTimes(2)
        const request = process.mock.calls[0]?.[0] as {
            messages: ProviderState['messages']
            imageGenerationReferences: ProviderState['imageGenerationReferences']
            imageSize: string
        }
        expect(request.imageSize).toBe('1536x1024')
        expect(request.messages[0]?.content).toEqual(
            expect.stringContaining('Image 1 is the authoritative character identity'),
        )
        expect(request.imageGenerationReferences).toEqual([
            {
                url: 'nats-obj://workspace-images/selected-character.png',
                role: 'character-source',
                fileName: 'character-source-1',
            },
            {
                url: 'data:image/jpeg;base64,character-sheet-layout',
                role: 'character-layout-example',
                fileName: 'character-layout-example-1',
            },
        ])
        const fidelityRequest = process.mock.calls[1]?.[0] as {
            imageGenerationReferences: ProviderState['imageGenerationReferences']
        }
        expect(fidelityRequest.imageGenerationReferences).toEqual([
            {
                url: `data:image/png;base64,${TINY_PNG_BASE64}`,
                role: 'character-sheet-draft',
                fileName: 'character-sheet-draft',
            },
            {
                url: 'nats-obj://workspace-images/selected-character.png',
                role: 'character-source',
                fileName: 'character-source-1',
            },
        ])
    })

    it('deduplicates one Character Creator source selected through multiple candidate records', async () => {
        const { router, process } = createRouter([
            { generatedImages: [TINY_PNG_BASE64] },
            { generatedImages: ['nats-obj://workspace-workspace-1-files/character-sheet.png'] },
        ])
        const sharedSource = 'nats-obj://workspace-images/shared-character.png'
        const state = createState({
            capabilityUsageMode: 'character-creator',
            capabilityUsagePrompt: 'Use the fixed multi-view layout.',
            capabilityReferenceImages: ['data:image/jpeg;base64,character-sheet-layout'],
            mediaBranchCandidateSnapshot: {
                promptText: 'Create character',
                candidates: [
                    { candidateId: 'candidate-node', nodeId: 'node-1', imageUrl: sharedSource },
                    { candidateId: 'candidate-asset', assetId: 'asset-1', imageUrl: sharedSource },
                ],
            } as any,
            mediaBranchResolution: {
                referenceCandidateIds: ['candidate-node', 'candidate-asset'],
            } as any,
        })

        await router.execute(state)

        expect(process.mock.calls[0]?.[0].imageGenerationReferences).toEqual([
            {
                url: sharedSource,
                role: 'character-source',
                fileName: 'character-source-1',
            },
            {
                url: 'data:image/jpeg;base64,character-sheet-layout',
                role: 'character-layout-example',
                fileName: 'character-layout-example-1',
            },
        ])
    })

    it('keeps the routed Stability Character Creator prompt below the provider limit', async () => {
        const { router, process } = createRouter([
            { generatedImages: [TINY_PNG_BASE64] },
            { generatedImages: ['nats-obj://workspace-workspace-1-files/character-sheet.png'] },
        ])
        const state = createState({
            capabilityUsageMode: 'character-creator',
            capabilityUsagePrompt: 'x'.repeat(8500),
            capabilityReferenceImages: ['data:image/jpeg;base64,character-sheet-layout'],
            imageProviderName: 'Stability',
            imageModelVersion: 'sd3.5-large',
            imageModelMetaInfo: {
                provider: 'Stability',
                model: 'Stable Diffusion 3.5 Large',
                modelVersion: 'sd3.5-large',
                imagePromptMaxChars: 10000,
            },
        })

        await router.execute(state)

        const routedPrompt = process.mock.calls[0]?.[0].messages[0]?.content
        expect(typeof routedPrompt).toBe('string')
        expect((routedPrompt as string).length).toBeLessThanOrEqual(10000)
        expect(routedPrompt).toEqual(expect.stringContaining('CHARACTER CREATOR BRIEF'))
    })
})
