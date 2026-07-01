'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const debugTools = vi.hoisted(() => ({
    info: vi.fn(),
    err: vi.fn(),
}))

vi.mock('@lixpi/debug-tools', () => debugTools)

import { BytePlusProvider } from './byteplus-provider.ts'
import type { BaseProviderDeps } from './base-provider.ts'

const byteplusMocks = vi.hoisted(() => ({
    createVideoGenerationTask: vi.fn(),
    pollVideoGenerationTask: vi.fn(),
    downloadVideo: vi.fn(),
}))

const frameMocks = vi.hoisted(() => ({
    extractVideoFramesViaWorkload: vi.fn(),
}))

const noopDeps = {} as any

vi.mock('./byteplus-video-types.ts', async () => {
    const actual = await vi.importActual<typeof import('./byteplus-video-types.ts')>('./byteplus-video-types.ts')
    return {
        ...actual,
        createVideoGenerationTask: byteplusMocks.createVideoGenerationTask,
        pollVideoGenerationTask: byteplusMocks.pollVideoGenerationTask,
        downloadVideo: byteplusMocks.downloadVideo,
    }
})

vi.mock('../../services/video-frame-extraction.ts', () => ({
    extractVideoFramesViaWorkload: frameMocks.extractVideoFramesViaWorkload,
}))

const makeDeps = (): BaseProviderDeps => ({
    natsService: {
        publish: vi.fn(),
    } as any,
    storeWorkspaceImage: vi.fn(),
    storeWorkspaceVideo: vi.fn(),
    usageReporter: {} as any,
    runImageRouter: vi.fn(),
    runVideoRouter: vi.fn(),
})

const setProviderPublishers = (provider: BytePlusProvider) => {
    const pending = vi.fn()
    const generating = vi.fn()
    const complete = vi.fn(async () => undefined)
    const error = vi.fn()
    ;(provider as any).videoPublisher = {
        pending,
        generating,
        complete,
        error,
    }
    ;(provider as any).abortController = new AbortController()
    return { pending, generating, complete, error }
}

const makeState = (overrides: Record<string, any> = {}) => ({
    workspaceId: 'ws-1',
    aiChatThreadId: 'thread-1',
    modelVersion: 'seedance-2.0',
    messages: [{ role: 'user', content: 'A cat riding a motorcycle through a city at night.' }],
    enableVideoGeneration: true,
    videoResolution: '1080p',
    videoAspectRatio: '16:9',
    videoDurationSeconds: 6,
    ...overrides,
})

describe('BytePlusProvider', () => {
    const prevByteplus = process.env.BYTEPLUS_ARK_API_KEY
    const prevArk = process.env.ARK_API_KEY

    beforeEach(() => {
        delete process.env.BYTEPLUS_ARK_API_KEY
        delete process.env.ARK_API_KEY
        byteplusMocks.createVideoGenerationTask.mockReset()
        byteplusMocks.pollVideoGenerationTask.mockReset()
        byteplusMocks.downloadVideo.mockReset()
        frameMocks.extractVideoFramesViaWorkload.mockReset()
    })

    afterEach(() => {
        if (prevByteplus === undefined) delete process.env.BYTEPLUS_ARK_API_KEY
        else process.env.BYTEPLUS_ARK_API_KEY = prevByteplus
        if (prevArk === undefined) delete process.env.ARK_API_KEY
        else process.env.ARK_API_KEY = prevArk
    })

    it('constructs with BYTEPLUS_ARK_API_KEY and reports providerName BytePlus', () => {
        process.env.BYTEPLUS_ARK_API_KEY = 'test-key'
        const provider = new BytePlusProvider('ws:thread:video', noopDeps)
        expect(provider.providerName).toBe('BytePlus')
    })

    it('falls back to ARK_API_KEY', () => {
        process.env.ARK_API_KEY = 'test-key'
        const provider = new BytePlusProvider('ws:thread:video', noopDeps)
        expect(provider.providerName).toBe('BytePlus')
    })

    it('throws a clear error when no API key is configured', () => {
        expect(() => new BytePlusProvider('ws:thread:video', noopDeps)).toThrow(/ARK_API_KEY/)
    })

    it('streams Seedance video lifecycle through pending/generating and completes with usage metadata', async () => {
        process.env.BYTEPLUS_ARK_API_KEY = 'test-key'
        const provider = new BytePlusProvider('ws-1:thread-1:video', makeDeps())
        const publisherState = setProviderPublishers(provider)
        const mp4Buffer = Buffer.from('video-bytes')

        byteplusMocks.createVideoGenerationTask.mockResolvedValueOnce({ id: 'seedance-task-1' })
        byteplusMocks.pollVideoGenerationTask.mockResolvedValueOnce({
            id: 'seedance-task-1',
            status: 'succeeded',
            content: { video_url: 'https://byteplus.local/video.mp4' },
            usage: { completion_tokens: 111, total_tokens: 222 },
            duration: 6,
            resolution: '1080p',
            ratio: '16:9',
        })
        byteplusMocks.downloadVideo.mockResolvedValueOnce(mp4Buffer)
        frameMocks.extractVideoFramesViaWorkload.mockResolvedValueOnce({
            posterBuffer: Buffer.from('poster-bytes'),
            frameBuffer: Buffer.from('frame-bytes'),
        })

        const result = await (provider as any).streamImpl(makeState())

        expect(publisherState.pending).toHaveBeenCalledTimes(1)
        expect(publisherState.generating).toHaveBeenCalledTimes(0)
        expect(publisherState.complete).toHaveBeenCalledTimes(1)
        expect(publisherState.error).not.toHaveBeenCalled()
        const completeArgs = publisherState.complete.mock.calls[0]?.[0]
        expect(completeArgs).toMatchObject({
            durationSeconds: 6,
            aspectRatio: '16:9',
            hasAudio: true,
            responseId: 'seedance-task-1',
            revisedPrompt: 'A cat riding a motorcycle through a city at night.',
            videoModelId: 'seedance-2.0',
        })
        expect(frameMocks.extractVideoFramesViaWorkload).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            videoBuffer: mp4Buffer,
            atSeconds: 3,
        })
        expect(result).toEqual(expect.objectContaining({
            generatedVideos: ['seedance-complete'],
            aiVendorRequestId: 'byteplus-seedance-task-1',
            videoUsage: {
                durationSeconds: 6,
                resolution: '1080p',
                aspectRatio: '16:9',
                completionTokens: 111,
                totalTokens: 222,
                responseId: 'seedance-task-1',
            },
        }))
    })

    it('rejects non-Seedance model routes so mis-routed requests stay visible', async () => {
        process.env.BYTEPLUS_ARK_API_KEY = 'test-key'
        const provider = new BytePlusProvider('ws-1:thread-1:video', makeDeps())
        setProviderPublishers(provider)
        const state = makeState({ modelVersion: 'gpt-like-video', enableVideoGeneration: true })

        await expect((provider as any).streamImpl(state)).rejects.toThrow(
            'BytePlus provider supports Seedance video generation only',
        )
        expect(byteplusMocks.createVideoGenerationTask).not.toHaveBeenCalled()
    })

    it('errors when Seedance returns no task id and reports it through the video publisher', async () => {
        process.env.BYTEPLUS_ARK_API_KEY = 'test-key'
        const provider = new BytePlusProvider('ws-1:thread-1:video', makeDeps())
        const publisherState = setProviderPublishers(provider)

        byteplusMocks.createVideoGenerationTask.mockResolvedValueOnce({})

        await expect((provider as any).streamImpl(makeState())).rejects.toThrow('ModelArk did not return a task id')
        expect(publisherState.error).toHaveBeenCalledWith('ModelArk did not return a task id')
        expect(publisherState.complete).not.toHaveBeenCalled()
        expect(publisherState.pending).not.toHaveBeenCalled()
        expect(byteplusMocks.pollVideoGenerationTask).not.toHaveBeenCalled()
    })

    it('records Seedance failures on the video publisher and rethrows to the caller', async () => {
        process.env.BYTEPLUS_ARK_API_KEY = 'test-key'
        const provider = new BytePlusProvider('ws-1:thread-1:video', makeDeps())
        const publisherState = setProviderPublishers(provider)

        byteplusMocks.createVideoGenerationTask.mockResolvedValueOnce({ id: 'seedance-task-2' })
        byteplusMocks.pollVideoGenerationTask.mockResolvedValueOnce({
            id: 'seedance-task-2',
            status: 'failed',
            error: { message: 'GPU quota exceeded' },
            content: {},
        })

        await expect((provider as any).streamImpl(makeState())).rejects.toThrow(
            'Seedance task seedance-task-2 failed: GPU quota exceeded',
        )
        expect(publisherState.error).toHaveBeenCalledWith('Seedance task seedance-task-2 failed: GPU quota exceeded')
        expect(publisherState.complete).not.toHaveBeenCalled()
        expect(publisherState.pending).toHaveBeenCalledTimes(1)
        expect(byteplusMocks.downloadVideo).not.toHaveBeenCalled()
    })

    it('throws clearly when the user prompt is missing and never submits a Seedance task', async () => {
        process.env.BYTEPLUS_ARK_API_KEY = 'test-key'
        const provider = new BytePlusProvider('ws-1:thread-1:video', makeDeps())
        setProviderPublishers(provider)

        await expect((provider as any).streamImpl(makeState({
            messages: [{ role: 'user', content: { message: 'not a string' } }],
        }))).rejects.toThrow('Seedance: missing prompt in user message')
        expect(byteplusMocks.createVideoGenerationTask).not.toHaveBeenCalled()
    })

    it('errors when the Seedance task returns success without a usable video_url', async () => {
        process.env.BYTEPLUS_ARK_API_KEY = 'test-key'
        const provider = new BytePlusProvider('ws-1:thread-1:video', makeDeps())
        const publisherState = setProviderPublishers(provider)

        byteplusMocks.createVideoGenerationTask.mockResolvedValueOnce({ id: 'seedance-task-3' })
        byteplusMocks.pollVideoGenerationTask.mockResolvedValueOnce({
            id: 'seedance-task-3',
            status: 'succeeded',
            content: {},
            usage: { completion_tokens: 77, total_tokens: 155 },
            duration: 6,
            resolution: '1080p',
            ratio: '16:9',
        })

        await expect((provider as any).streamImpl(makeState())).rejects.toThrow(
            'Seedance task succeeded but returned no video_url',
        )
        expect(publisherState.error).toHaveBeenCalledWith('Seedance task succeeded but returned no video_url')
        expect(publisherState.complete).not.toHaveBeenCalled()
    })

    it('errors when Seedance video download is empty', async () => {
        process.env.BYTEPLUS_ARK_API_KEY = 'test-key'
        const provider = new BytePlusProvider('ws-1:thread-1:video', makeDeps())
        const publisherState = setProviderPublishers(provider)

        byteplusMocks.createVideoGenerationTask.mockResolvedValueOnce({ id: 'seedance-task-4' })
        byteplusMocks.pollVideoGenerationTask.mockResolvedValueOnce({
            id: 'seedance-task-4',
            status: 'succeeded',
            content: { video_url: 'https://byteplus.local/video.mp4' },
            usage: { completion_tokens: 77, total_tokens: 155 },
            duration: 6,
            resolution: '1080p',
            ratio: '16:9',
        })
        byteplusMocks.downloadVideo.mockResolvedValueOnce(Buffer.alloc(0))

        await expect((provider as any).streamImpl(makeState())).rejects.toThrow(
            'Seedance: empty video bytes after download',
        )
        expect(frameMocks.extractVideoFramesViaWorkload).not.toHaveBeenCalled()
        expect(publisherState.error).toHaveBeenCalledWith('Seedance: empty video bytes after download')
        expect(debugTools.err).toHaveBeenCalledWith(
            '[BytePlus:ws-1:thread-1:video] Seedance failed: Seedance: empty video bytes after download',
        )
    })
})
