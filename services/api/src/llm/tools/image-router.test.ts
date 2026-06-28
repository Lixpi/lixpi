'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as debugTools from '@lixpi/debug-tools'

import { ImageRouter } from './image-router.ts'
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

const createRouter = (processResult: { generatedImages?: string[]; error?: string } = { generatedImages: ['nats-obj://workspace-workspace-1-files/cat.png'] }) => {
    const process = vi.fn(async () => processResult as ProviderState)
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

    it('routes image generation and applies provider mapping defaults', async () => {
        const { router, createTransient, process } = createRouter()
        const state = createState()

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
        })
        expect(requestData.aiModelMetaInfo).toMatchObject({
            provider: 'Google',
            model: 'Gemini Image',
            modelVersion: 'gemini-2.5-flash-image',
        })
        expect(requestData.messages).toEqual([{
            role: 'user',
            content: [
                { type: 'input_text', text: expect.any(String) },
                { type: 'input_image', image_url: 'data:image/png;base64,cat-ref', detail: 'high' },
            ],
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
})
