'use strict'

import { describe, expect, it, vi } from 'vitest'

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
        featureReferenceImages: ['data:image/png;base64,feature-inline'],
        featureUsagePrompt: 'Use rough cut-paper edges and visible fiber texture.',
        ...overrides,
    }
}

const createRouter = () => {
    const process = vi.fn(async () => ({ generatedVideos: ['nats-obj://workspace-workspace-1-files/video-file'] }))
    const createTransient = vi.fn(() => ({ process }))
    const router = new VideoRouter({ createTransient } as any)
    return { router, createTransient, process }
}

describe('VideoRouter', () => {
    it('routes the final VEO prompt and attaches feature references when reference images are allowed', async () => {
        const { router, createTransient, process } = createRouter()

        const result = await router.execute(createState())

        expect(createTransient).toHaveBeenCalledWith('workspace-1:thread-1:video', 'Google')
        expect(result.generatedVideos).toEqual(['nats-obj://workspace-workspace-1-files/video-file'])
        const requestData = process.mock.calls[0]?.[0]
        expect(requestData.messages[0].content).toContain('VEO QUALITY DIRECTION')
        expect(requestData.messages[0].content).toContain('MANDATORY /use FEATURE TRANSFER FOR VIDEO')
        expect(requestData.messages[0].content).toContain('Negative prompt:')
        expect(requestData.videoReferenceImages).toEqual(['data:image/png;base64,feature-inline'])
    })

    it('keeps feature references in the prompt only when VEO first-frame mode is active', async () => {
        const { router, process } = createRouter()

        await router.execute(createState({
            videoFirstFrameImage: 'data:image/png;base64,first-frame',
        }))

        const requestData = process.mock.calls[0]?.[0]
        expect(requestData.messages[0].content).toContain('IMAGE-TO-VIDEO DIRECTION')
        expect(requestData.messages[0].content).toContain('MANDATORY /use FEATURE TRANSFER FOR VIDEO')
        expect(requestData.videoReferenceImages).toBeUndefined()
    })

    it('caps routed reference images at 3 for VEO (default cap when metadata is absent)', async () => {
        const { router, process } = createRouter()
        const refs = Array.from({ length: 5 }, (_, i) => `data:image/png;base64,ref-${i}`)

        await router.execute(createState({
            videoReferenceImages: refs,
            featureReferenceImages: [],
            featureUsagePrompt: undefined,
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
            featureReferenceImages: [],
            featureUsagePrompt: undefined,
        }))

        const requestData = process.mock.calls[0]?.[0]
        expect(requestData.videoReferenceImages).toHaveLength(9)
        expect(requestData.videoReferenceImages).toEqual(refs.slice(0, 9))
    })
})
