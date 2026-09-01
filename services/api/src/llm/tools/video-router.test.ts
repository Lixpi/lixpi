'use strict'

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import * as debugTools from '@lixpi/debug-tools'

import { VideoRouter } from './video-router.ts'
import type { ProviderState } from '../graph/state.ts'

function createState(overrides: Partial<ProviderState> = {}): ProviderState {
    return {
        messages: [{ role: 'user', content: 'animate this' }],
        aiModelMetaInfo: { provider: 'Anthropic', model: 'Claude', modelVersion: 'claude-sonnet-4-6', maxCompletionSize: 4096 },
        eventMeta: {},
        workspaceId: 'workspace-1',
        aiChatThreadId: 'thread-1',
        instanceKey: 'workspace-1:thread-1',
        provider: 'Anthropic',
        modelVersion: 'claude-sonnet-4-6',
        temperature: 0.7,
        streamActive: false,
        aiRequestReceivedAt: 1,
        videoModelMetaInfo: { provider: 'Google', model: 'VEO', modelVersion: 'veo-3.1-generate-preview' },
        videoModelVersion: 'veo-3.1-generate-preview',
        videoProviderName: 'Google',
        videoAspectRatio: '16:9',
        videoResolution: '720p',
        videoDurationSeconds: 8,
        generatedVideoPrompt: 'Film a paper fox taking three careful steps through warm studio light.',
        capabilityReferenceImages: ['data:image/png;base64,capability-inline'],
        capabilityUsagePrompt: 'Use rough cut-paper edges and visible fiber texture.',
        ...overrides,
    }
}

const createRouter = (processResult: {
    generatedVideos?: string[]
    error?: string
    cancelledByUser?: boolean
} = { generatedVideos: ['nats-obj://workspace-workspace-1-files/video-file'] }) => {
    const process = vi.fn(async () => processResult)
    const createTransient = vi.fn(() => ({ process }))
    const router = new VideoRouter({ createTransient } as any)
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

describe('VideoRouter', () => {
    it('returns empty object when required routing inputs are missing', async () => {
        const { router, process } = createRouter()

        const result = await router.execute(createState({
            videoProviderName: undefined,
        }))

        expect(result).toEqual({})
        expect(process).not.toHaveBeenCalled()
    })

    it('passes onProseMirrorContent through to the transient video provider request', async () => {
        const { router, process } = createRouter()
        const state = createState()
        const onProseMirrorContent = vi.fn()

        await router.execute(state, { onProseMirrorContent })

        const requestData = process.mock.calls[0]?.[0]
        expect(requestData).toMatchObject({
            proseMirrorContentHandler: onProseMirrorContent,
        })
    })

    it('routes the final VEO prompt and attaches capability references when reference images are allowed', async () => {
        const { router, createTransient, process } = createRouter()

        const result = await router.execute(createState({ eventMeta: { organizationId: 'organization-1' } }))

        expect(createTransient).toHaveBeenCalledWith('workspace-1:thread-1:video', 'Google')
        expect(result.generatedVideos).toEqual(['nats-obj://workspace-workspace-1-files/video-file'])
        const requestData = process.mock.calls[0]?.[0]
        expect(requestData.organizationId).toBe('organization-1')
        expect(requestData.messages[0].content).toContain('VEO QUALITY DIRECTION')
        expect(requestData.messages[0].content).toContain('MANDATORY VISUAL CAPABILITY TRANSFER FOR VIDEO')
        expect(requestData.messages[0].content).toContain('Negative prompt:')
        expect(requestData.videoReferenceImages).toEqual(['data:image/png;base64,capability-inline'])
    })

    it('merges the reasoning model negative prompt into the internal provider config', async () => {
        const { router, process } = createRouter()

        await router.execute(createState({
            videoGenerationConfig: { generateAudio: 'false' },
            generatedVideoNegativePrompt: 'no subtitles',
        }))

        const requestData = process.mock.calls[0]?.[0]
        expect(requestData.videoGenerationConfig).toEqual({
            generateAudio: 'false',
            negativePrompt: 'no subtitles',
        })
    })

    it('omits videoReferenceImages when no source or first-frame references are available', async () => {
        const { router, process } = createRouter()

        await router.execute(createState({
            videoReferenceImages: [],
            capabilityReferenceImages: [],
            capabilityUsagePrompt: undefined,
        }))

        expect(process).toHaveBeenCalledOnce()
        const requestData = process.mock.calls[0]?.[0]
        expect(requestData.videoReferenceImages).toBeUndefined()
    })

    it('keeps capability references in the prompt only when VEO first-frame mode is active', async () => {
        const { router, process } = createRouter()

        await router.execute(createState({
            videoFirstFrameImage: 'data:image/png;base64,first-frame',
        }))

        const requestData = process.mock.calls[0]?.[0]
        expect(requestData.messages[0].content).toContain('IMAGE-TO-VIDEO DIRECTION')
        expect(requestData.messages[0].content).toContain('MANDATORY VISUAL CAPABILITY TRANSFER FOR VIDEO')
        expect(requestData.videoReferenceImages).toBeUndefined()
    })

    it('caps routed reference images at 3 for VEO (default cap when metadata is absent)', async () => {
        const { router, process } = createRouter()
        const refs = Array.from({ length: 5 }, (_, i) => `data:image/png;base64,ref-${i}`)

        await router.execute(createState({
            videoReferenceImages: refs,
            capabilityReferenceImages: [],
            capabilityUsagePrompt: undefined,
        }))

        const requestData = process.mock.calls[0]?.[0]
        expect(requestData.videoReferenceImages).toEqual(refs.slice(0, 3))
    })

    it('allows up to the Seedance 9-image cap when the model metadata sets videoMaxReferenceImages', async () => {
        const { router, process } = createRouter()
        const refs = Array.from({ length: 12 }, (_, i) => `data:image/png;base64,ref-${i}`)

        await router.execute(createState({
            videoModelMetaInfo: { provider: 'Google', model: 'Seedance', modelVersion: 'dreamina-seedance-2-0-260128', videoMaxReferenceImages: 9 },
            videoModelVersion: 'dreamina-seedance-2-0-260128',
            videoReferenceImages: refs,
            capabilityReferenceImages: [],
            capabilityUsagePrompt: undefined,
        }))

        const requestData = process.mock.calls[0]?.[0]
        expect(requestData.videoReferenceImages).toHaveLength(9)
        expect(requestData.videoReferenceImages).toEqual(refs.slice(0, 9))
    })

    it('returns an error when provider completes without any generated videos', async () => {
        const { router } = createRouter({ generatedVideos: [] })

        const result = await router.execute(createState())

        expect(result).toEqual({ error: 'Video generation failed: provider completed without a generated video' })
    })

    it('propagates provider cancellation instead of recording missing output as a failure', async () => {
        const { router } = createRouter({ cancelledByUser: true })

        await expect(router.execute(createState())).rejects.toMatchObject({ name: 'AbortError' })
    })

    it('does not leak capability reference images into media references when videoSourceForExtension is present', async () => {
        const { router, process } = createRouter()
        const refs = ['data:image/png;base64,ref-0', 'data:image/png;base64,ref-1']
        const capabilityRefs = ['data:image/png;base64,capability-0', 'data:image/png;base64,capability-1']

        await router.execute(createState({
            videoReferenceImages: refs,
            capabilityReferenceImages: capabilityRefs,
            capabilityUsagePrompt: 'Use warm brush marks in motion.',
            videoSourceForExtension: 'nats-obj://workspace-workspace-1-files/source-video-file',
        }))

        const requestData = process.mock.calls[0]?.[0]
        expect(requestData.videoReferenceImages).toEqual(refs)
    })

    it('removes the transient video provider even when processing throws', async () => {
        const remove = vi.fn()
        const process = vi.fn(async () => {
            throw new Error('video provider crash')
        })
        const createTransient = vi.fn(() => ({ process }))
        const router = new VideoRouter({ createTransient, remove } as any)

        const result = await router.execute(createState())

        expect(process).toHaveBeenCalledOnce()
        expect(result.error).toBe('video provider crash')
        expect(remove).toHaveBeenCalledWith('workspace-1:thread-1:video')
    })
})
