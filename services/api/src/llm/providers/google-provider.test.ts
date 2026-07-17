'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const debugTools = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    err: vi.fn(),
}))

vi.mock('@lixpi/debug-tools', () => debugTools)

import { type BaseProviderDeps } from './base-provider.ts'
import {
    buildVeoReferenceImages,
    getGoogleImageResponseSummary,
    GoogleProvider,
} from './google-provider.ts'

const { generateContent } = vi.hoisted(() => ({
    generateContent: vi.fn(),
}))
const googleMocks = vi.hoisted(() => ({
    generateContentStream: vi.fn(),
    generateVideos: vi.fn(),
    getVideosOperation: vi.fn(),
    download: vi.fn(),
}))
const extractFramesMock = vi.hoisted(() => ({
    extractVideoFramesViaWorkload: vi.fn(),
}))

vi.mock('@google/genai', () => ({
    GoogleGenAI: vi.fn(function() {
        return {
            models: {
                generateContent,
                generateContentStream: googleMocks.generateContentStream,
                generateVideos: googleMocks.generateVideos,
            },
            operations: { getVideosOperation: googleMocks.getVideosOperation },
            files: { download: googleMocks.download },
            vertexai: false,
        }
    }),
}))

vi.mock('../../services/video-frame-extraction.ts', () => ({
    extractVideoFramesViaWorkload: extractFramesMock.extractVideoFramesViaWorkload,
}))

const makeAsyncStream = <T>(chunks: T[]) => ({
    [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) yield chunk
    },
}) as unknown as AsyncIterable<unknown>

const createProviderDeps = (): BaseProviderDeps => ({
    natsService: { publish: vi.fn() } as any,
    storeWorkspaceImage: vi.fn(),
    storeWorkspaceVideo: vi.fn(),
    usageReporter: {} as any,
    runImageRouter: vi.fn(),
    runVideoRouter: vi.fn(),
})

const resetGoogleMocks = () => {
    generateContent.mockReset()
    googleMocks.generateContentStream.mockReset()
    googleMocks.generateVideos.mockReset()
    googleMocks.getVideosOperation.mockReset()
    googleMocks.download.mockReset()
    extractFramesMock.extractVideoFramesViaWorkload.mockReset()
}

const configureProviderInternals = (provider: GoogleProvider) => {
    const start = vi.fn()
    const end = vi.fn()
    const chunk = vi.fn()
    const error = vi.fn()
    const streamPublisher = {
        start,
        end,
        chunk,
        error,
    } as any
    const imagePublisher = {
        partial: vi.fn(),
        complete: vi.fn(),
    } as any
    const videoPublisher = {
        pending: vi.fn(),
        generating: vi.fn(),
        complete: vi.fn(async () => undefined),
        error: vi.fn(),
    } as any
    ;(provider as any).streamPublisher = streamPublisher
    ;(provider as any).imagePublisher = imagePublisher
    ;(provider as any).videoPublisher = videoPublisher
    ;(provider as any).abortController = new AbortController()
    return { start, end, chunk, error, imagePublisher, videoPublisher }
}

const baseGoogleState = () => ({
    workspaceId: 'ws-1',
    aiChatThreadId: 'thread-1',
    messages: [{ role: 'user', content: 'generate a scene' }],
    modelVersion: 'gemini-2.5-flash',
    aiModelMetaInfo: { modelVersion: 'gemini-2.5-flash' } as any,
    maxCompletionSize: 1000,
    temperature: 0.7,
})

describe('buildVeoReferenceImages', () => {
    it('uses the VEO 3.1 asset reference type for every reference image', () => {
        const refs = [
            { imageBytes: 'first-image', mimeType: 'image/png' },
            { imageBytes: 'second-image', mimeType: 'image/jpeg' },
        ]

        expect(buildVeoReferenceImages(refs)).toEqual([
            { image: refs[0], referenceType: 'asset' },
            { image: refs[1], referenceType: 'asset' },
        ])
    })
})

describe('getGoogleImageResponseSummary', () => {
    it('summarizes no-image responses without dumping full text or binary payloads', () => {
        const summary = getGoogleImageResponseSummary({
            promptFeedback: { blockReason: 'SAFETY' },
            candidates: [
                {
                    finishReason: 'STOP',
                    safetyRatings: [{ category: 'HARM_CATEGORY_TEST', probability: 'LOW' }],
                    content: {
                        parts: [
                            { text: 'x'.repeat(300) },
                            { inlineData: { data: 'base64-image-bytes' } },
                        ],
                    },
                },
            ],
        })

        expect(summary).toEqual({
            promptFeedback: { blockReason: 'SAFETY' },
            candidates: [
                {
                    index: 0,
                    finishReason: 'STOP',
                    safetyRatings: [{ category: 'HARM_CATEGORY_TEST', probability: 'LOW' }],
                    partTypes: [
                        {
                            hasText: true,
                            textPreview: 'x'.repeat(240),
                            hasInlineData: false,
                            hasFunctionCall: false,
                        },
                        {
                            hasText: false,
                            textPreview: '',
                            hasInlineData: true,
                            hasFunctionCall: false,
                        },
                    ],
                },
            ],
        })
    })
})

describe('GoogleProvider rewrite flow', () => {
    const createDeps = (): BaseProviderDeps => ({
        natsService: { publish: vi.fn() } as any,
        storeWorkspaceImage: vi.fn(),
        storeWorkspaceVideo: vi.fn(),
        usageReporter: {} as any,
        runImageRouter: vi.fn(),
        runVideoRouter: vi.fn(),
    }) as unknown as BaseProviderDeps

    beforeEach(() => {
        process.env.GOOGLE_API_KEY = 'test-key'
        resetGoogleMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
        delete process.env.GOOGLE_API_KEY
    })

    it('requires GOOGLE_API_KEY to instantiate provider', () => {
        delete process.env.GOOGLE_API_KEY
        expect(() => new GoogleProvider('ws-1:thread-1', createDeps()))
            .toThrow('GOOGLE_API_KEY environment variable is required')
    })

    it('rewrites image prompts from direct model text responses', async () => {
        generateContent.mockResolvedValueOnce({ text: '  concise rephrase  ' })
        const provider = new GoogleProvider('ws-1:thread-1', createDeps())
        const state = { modelVersion: 'gemini-2.5-flash-image' } as any

        const rewritten = await (provider as any).rewriteImagePromptToFitLimit(state, 'Too verbose prompt', 64)

        expect(rewritten).toBe('concise rephrase')
        expect(generateContent).toHaveBeenCalledTimes(1)
    })

    it('falls back to collecting text parts when direct text is missing', async () => {
        generateContent.mockResolvedValueOnce({
            candidates: [
                { content: { parts: [{ text: 'first' }, { text: 'second', extra: true }] } },
            ],
        })
        const provider = new GoogleProvider('ws-1:thread-1', createDeps())
        const state = { modelVersion: 'gemini-2.5-flash-image' } as any

        const rewritten = await (provider as any).rewriteImagePromptToFitLimit(state, 'Too verbose prompt', 64)

        expect(rewritten).toBe('first\nsecond')
        expect(generateContent).toHaveBeenCalledTimes(1)
    })
})

describe('GoogleProvider internals', () => {
    const createDeps = (): BaseProviderDeps => ({
        natsService: { publish: vi.fn() } as any,
        storeWorkspaceImage: vi.fn(),
        storeWorkspaceVideo: vi.fn(),
        usageReporter: {} as any,
        runImageRouter: vi.fn(),
        runVideoRouter: vi.fn(),
    }) as unknown as BaseProviderDeps

    beforeEach(() => {
        process.env.GOOGLE_API_KEY = 'test-key'
        resetGoogleMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
        delete process.env.GOOGLE_API_KEY
    })

    it('maps legacy and modern function-call payload fields in summaries', () => {
        const summary = getGoogleImageResponseSummary({
            candidates: [
                {
                    finish_reason: 'STOP',
                    safety_ratings: [{ category: 'HARM_CATEGORY_HARASSMENT', probability: 'LOW' }],
                    content: {
                        parts: [
                            { function_call: { name: 'generate_image' } },
                            { inline_data: { data: 'payload-bytes' } },
                        ],
                    },
                },
            ],
        })

        expect(summary).toEqual({
            promptFeedback: undefined,
            candidates: [{
                index: 0,
                finishReason: 'STOP',
                safetyRatings: [{ category: 'HARM_CATEGORY_HARASSMENT', probability: 'LOW' }],
                partTypes: [
                    {
                        hasText: false,
                        textPreview: '',
                        hasInlineData: false,
                        hasFunctionCall: true,
                    },
                    {
                        hasText: false,
                        textPreview: '',
                        hasInlineData: true,
                        hasFunctionCall: false,
                    },
                ],
            }],
        })
    })

    it('builds Google request parts from text and mixed attachment payload shapes', async () => {
        const provider = new GoogleProvider('ws-1:thread-1', createDeps())

        const parts = (provider as any).buildParts([
            { text: 'prompt' },
            { inline_data: { data: 'abc', mime_type: 'image/png' } },
            { inlineData: { data: 'def', mimeType: 'image/jpeg' } },
            { unknown: 'x' },
        ])

        expect(parts).toEqual([
            { text: 'prompt' },
            { inlineData: { data: 'abc', mimeType: 'image/png' } },
            { inlineData: { data: 'def', mimeType: 'image/jpeg' } },
        ])
    })

    it('streams native image generation, persists partial + complete events, and records image usage', async () => {
        generateContent.mockResolvedValueOnce({
            usageMetadata: {
                promptTokenCount: 5,
                cachedContentTokenCount: 2,
                candidatesTokenCount: 11,
                thoughtsTokenCount: 3,
                totalTokenCount: 16,
            },
            candidates: [
                {
                    content: {
                        parts: [
                            { text: 'preview text' },
                            { inlineData: { data: 'iVBORw0KGgo=', mimeType: 'image/png' } },
                            { inline_data: { data: '/9j/4AAQSk', mimeType: 'image/jpeg' } },
                        ],
                    },
                },
            ],
        })

        const provider = new GoogleProvider('ws-1:thread-1', createProviderDeps())
        const { chunk, imagePublisher } = configureProviderInternals(provider)

        const update = await (provider as any).streamImpl({
            ...baseGoogleState(),
            modelVersion: 'gemini-2.5-flash-image',
            enableImageGeneration: true,
            imageSize: '16:9',
            messages: [{ role: 'user', content: 'show me a dog' }],
        })

        expect(imagePublisher.partial).toHaveBeenCalledWith('iVBORw0KGgo=', 1)
        expect(imagePublisher.complete).toHaveBeenCalledTimes(1)
        const completeArgs = imagePublisher.complete.mock.calls[0]?.[0]
        expect(completeArgs).toMatchObject({
            imageBase64: '/9j/4AAQSk',
            responseId: '',
            revisedPrompt: '',
            imageModelId: 'gemini-2.5-flash-image',
        })
        expect(chunk).toHaveBeenCalledWith('preview text')
        expect(update).toMatchObject({
            generatedImages: ['/9j/4AAQSk'],
            imageUsage: {
                generatedCount: 1,
                size: '16:9',
                quality: 'high',
            },
            usage: {
                promptTokens: 5,
                completionTokens: 14, // candidates 11 + thoughts 3 (reasoning folded into completion)
                promptCachedTokens: 2,
                completionReasoningTokens: 3,
                totalTokens: 16,
            },
            aiVendorRequestId: 'google-ws-1-thread-1',
        })
    })

    it('surfaces image-generation content errors when the provider returns no inline image data', async () => {
        generateContent.mockResolvedValueOnce({
            usageMetadata: {
                promptTokenCount: 5,
                candidatesTokenCount: 8,
                totalTokenCount: 13,
            },
            candidates: [{ content: { parts: [{ text: 'No images in this response' }] } }],
        })

        const provider = new GoogleProvider('ws-1:thread-1', createProviderDeps())
        const { chunk, imagePublisher } = configureProviderInternals(provider)

        const update = await (provider as any).streamImpl({
            ...baseGoogleState(),
            modelVersion: 'gemini-2.5-flash-image',
            enableImageGeneration: true,
            messages: [{ role: 'user', content: 'try generating image' }],
        })

        expect(chunk).toHaveBeenCalledWith('No images in this response')
        expect(imagePublisher.partial).toHaveBeenCalledWith('', 0)
        expect(imagePublisher.complete).not.toHaveBeenCalled()
        expect(update).toEqual(expect.objectContaining({
            error: 'Google image model gemini-2.5-flash-image returned no inline image data.',
            usage: {
                promptTokens: 5,
                completionTokens: 8,
                promptCachedTokens: 0,
                completionReasoningTokens: 0,
                totalTokens: 13,
                promptAudioTokens: 0,
                completionAudioTokens: 0,
            },
        }))
    })

    it('detects generate_image tool calls, emits generatedImagePrompt, and extracts reference images', async () => {
        googleMocks.generateContentStream.mockResolvedValueOnce(makeAsyncStream([
            {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    functionCall: {
                                        name: 'generate_image',
                                        args: { prompt: 'a warm portrait prompt' },
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        ]))

        const provider = new GoogleProvider('ws-1:thread-1', createProviderDeps())
        const { start, videoPublisher } = configureProviderInternals(provider)

        const update = await (provider as any).streamImpl({
            ...baseGoogleState(),
            imageModelVersion: 'imagen-4.0',
            imageModelMetaInfo: {
                provider: 'Google',
                model: 'imagen-4.0',
                modelVersion: 'imagen-4.0',
            } as any,
            imageProviderName: 'Google',
            enableImageGeneration: false,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'input_image', image_url: 'data:image/png;base64,ZmFrZQ==' },
                        { type: 'input_image', image_url: 'data:image/jpeg;base64,c2hvd2M=' },
                    ],
                },
            ],
        } as any)

        expect(start).toHaveBeenCalled()
        expect(videoPublisher.pending).not.toHaveBeenCalled()
        expect(update.generatedImagePrompt).toBe('a warm portrait prompt')
        expect(update.referenceImages).toEqual([
            'data:image/png;base64,ZmFrZQ==',
            'data:image/jpeg;base64,c2hvd2M=',
        ])
        expect(googleMocks.generateContentStream).toHaveBeenCalledWith(expect.objectContaining({
            model: 'gemini-2.5-flash',
            config: expect.objectContaining({
                tools: expect.arrayContaining([
                    expect.objectContaining({
                        functionDeclarations: expect.arrayContaining([
                            expect.objectContaining({ name: 'generate_image' }),
                        ]),
                    }),
                ]),
            }),
        }))
    })

    it('falls back to forced function calling when fanout is enabled and no initial tool call is emitted', async () => {
        googleMocks.generateContentStream.mockResolvedValueOnce(makeAsyncStream([
            {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    text: 'No clear tool call yet.',
                                },
                            ],
                        },
                    },
                ],
            },
        ]))
        googleMocks.generateContentStream.mockResolvedValueOnce(makeAsyncStream([
            {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    functionCall: {
                                        name: 'generate_image',
                                        args: { prompt: 'Strict mode fallback prompt' },
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        ]))

        const provider = new GoogleProvider('ws-1:thread-1', createProviderDeps())
        const { chunk } = configureProviderInternals(provider)

        const update = await (provider as any).streamImpl({
            ...baseGoogleState(),
            imageModelVersion: 'imagen-4.0',
            imageModelMetaInfo: {
                provider: 'Google',
                model: 'imagen-4.0',
                modelVersion: 'imagen-4.0',
            } as any,
            imageProviderName: 'Google',
            enableImageGeneration: false,
            mediaFanoutPlan: true,
            messages: [{ role: 'user', content: 'draw it' }],
        } as any)

        expect(chunk).toHaveBeenCalledWith('No clear tool call yet.')
        expect(googleMocks.generateContentStream).toHaveBeenCalledTimes(2)
        expect(update.generatedImagePrompt).toBe('Strict mode fallback prompt')
        expect(googleMocks.generateContentStream.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
            config: expect.objectContaining({
                toolConfig: expect.objectContaining({
                    functionCallingConfig: expect.objectContaining({
                        mode: 'ANY',
                        allowedFunctionNames: ['generate_image'],
                    }),
                }),
            }),
        }))
    })

    it('streams plain-text responses and finalizes the stream publisher lifecycle', async () => {
        googleMocks.generateContentStream.mockResolvedValueOnce(makeAsyncStream([
            {
                usageMetadata: {
                    promptTokenCount: 3,
                    candidatesTokenCount: 4,
                    totalTokenCount: 7,
                },
                candidates: [
                    { content: { parts: [{ text: 'hello ' }] } },
                ],
            },
            {
                usageMetadata: {
                    promptTokenCount: 3,
                    candidatesTokenCount: 6,
                    cachedContentTokenCount: 1,
                    thoughtsTokenCount: 2,
                    totalTokenCount: 12,
                },
                candidates: [
                    { content: { parts: [{ text: 'world' }] } },
                ],
            },
        ]))

        const provider = new GoogleProvider('ws-1:thread-1', createProviderDeps())
        const { chunk, end, error } = configureProviderInternals(provider)

        const update = await (provider as any).streamImpl({
            ...baseGoogleState(),
            enableImageGeneration: false,
            enableVideoGeneration: false,
            messages: [{ role: 'user', content: 'plain text request' }],
        })

        expect(chunk).toHaveBeenCalledTimes(2)
        expect(chunk).toHaveBeenNthCalledWith(1, 'hello ')
        expect(chunk).toHaveBeenNthCalledWith(2, 'world')
        expect(end).toHaveBeenCalledOnce()
        expect(error).not.toHaveBeenCalled()
        expect(update).toMatchObject({
            usage: {
                promptTokens: 3,
                completionTokens: 8, // candidates 6 + thoughts 2 (reasoning folded into completion)
                promptCachedTokens: 1,
                completionReasoningTokens: 2,
                totalTokens: 12,
            },
            aiVendorRequestId: 'google-ws-1-thread-1',
        })
        expect(update.generatedImages).toBeUndefined()
        expect(update.generatedVideos).toBeUndefined()
    })

    it('streams VEO path from model-version matching regex and updates media usage', async () => {
        googleMocks.generateVideos.mockResolvedValueOnce({
            done: true,
            name: 'operations/veo-123',
            response: {
                generatedVideos: [
                    { video: { videoBytes: 'AAAA' } },
                ],
            },
        })
        const provider = new GoogleProvider('ws-1:thread-1', createProviderDeps())
        const { videoPublisher } = configureProviderInternals(provider)

        const update = await (provider as any).streamImpl({
            ...baseGoogleState(),
            modelVersion: 'veo-3.1-generate-preview',
            enableVideoGeneration: true,
            videoModelVersion: 'veo-3.1-generate-preview',
            videoModelMetaInfo: { provider: 'Google', model: 'veo-3.1', modelVersion: 'veo-3.1-generate-preview' } as any,
            videoProviderName: 'Google',
            videoAspectRatio: '16:9',
            videoResolution: '720p',
            videoDurationSeconds: 8,
            videoFirstFrameImage: 'data:image/png;base64,ZmFrZQ==',
            messages: [{ role: 'user', content: 'make a cinematic shot' }],
        } as any)

        const completeArgs = videoPublisher.complete.mock.calls[0]?.[0]
        expect(videoPublisher.pending).toHaveBeenCalledTimes(1)
        expect(videoPublisher.generating).toHaveBeenCalledTimes(0)
        expect(videoPublisher.complete).toHaveBeenCalledTimes(1)
        expect(completeArgs).toMatchObject({
            durationSeconds: 8,
            aspectRatio: '16:9',
            hasAudio: true,
            responseId: 'operations/veo-123',
            revisedPrompt: 'make a cinematic shot',
            videoModelId: 'veo-3.1-generate-preview',
            posterBuffer: null,
            frameBuffer: null,
        })
        expect(update).toEqual(expect.objectContaining({
            generatedVideos: ['veo-complete'],
            videoUsage: {
                durationSeconds: 8,
                resolution: '720p',
                aspectRatio: '16:9',
            },
        }))
    })

    it('captures VEO operation failures as stream errors', async () => {
        googleMocks.generateVideos.mockResolvedValueOnce({
            done: true,
            name: 'operations/veo-empty',
            response: {},
        })

        const provider = new GoogleProvider('ws-1:thread-1', createProviderDeps())
        const { videoPublisher } = configureProviderInternals(provider)

        const update = await (provider as any).streamImpl({
            ...baseGoogleState(),
            modelVersion: 'veo-3.1-generate-preview',
            enableVideoGeneration: true,
            videoModelVersion: 'veo-3.1-generate-preview',
            videoModelMetaInfo: { provider: 'Google', model: 'veo-3.1', modelVersion: 'veo-3.1-generate-preview' } as any,
            videoProviderName: 'Google',
            messages: [{ role: 'user', content: 'make a cinematic shot' }],
        } as any)

        expect(update.error).toBe('VEO: operation completed without a video')
        expect(videoPublisher.error).toHaveBeenCalledWith('VEO: operation completed without a video')
        expect(update.generatedVideos).toBeUndefined()
    })

    it('streams plain text for non-media models and emits mapped usage', async () => {
        googleMocks.generateContentStream.mockResolvedValueOnce(makeAsyncStream([
            {
                usageMetadata: {
                    promptTokenCount: 12,
                    cachedContentTokenCount: 1,
                    candidatesTokenCount: 7,
                    thoughtsTokenCount: 2,
                    totalTokenCount: 21,
                },
                candidates: [{
                    content: {
                        parts: [
                            { text: 'Hello ' },
                            { text: 'world' },
                        ],
                    },
                }],
            },
        ]))

        const provider = new GoogleProvider('ws-1:thread-1', createProviderDeps())
        const { start, chunk } = configureProviderInternals(provider)

        const update = await (provider as any).streamImpl({
            ...baseGoogleState(),
            modelVersion: 'gemini-2.5-flash',
            enableImageGeneration: false,
            enableVideoGeneration: false,
            messages: [{ role: 'user', content: 'Tell me something.' }],
        })

        expect(start).toHaveBeenCalled()
        expect(chunk).toHaveBeenCalledWith('Hello ')
        expect(chunk).toHaveBeenCalledWith('world')
        expect(update).toMatchObject({
            usage: {
                promptTokens: 12,
                promptCachedTokens: 1,
                completionTokens: 9, // candidates 7 + thoughts 2 (reasoning folded into completion)
                completionReasoningTokens: 2,
                totalTokens: 21,
                promptAudioTokens: 0,
                completionAudioTokens: 0,
            },
            aiVendorRequestId: 'google-ws-1-thread-1',
        })
    })

    it('retries tool generation with forced tool calling when no function call is detected', async () => {
        const noToolCallStream = [
            {
                candidates: [
                    {
                        content: {
                            parts: [{ text: 'No function call today.' }],
                        },
                    },
                ],
            },
        ]

        const toolCallStream = [
            {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    functionCall: {
                                        name: 'generate_image',
                                        args: { prompt: 'Auto-promote the request' },
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        ]

        googleMocks.generateContentStream
            .mockResolvedValueOnce(makeAsyncStream(noToolCallStream))
            .mockResolvedValueOnce(makeAsyncStream(toolCallStream))

        const provider = new GoogleProvider('ws-1:thread-1', createProviderDeps())
        const { start } = configureProviderInternals(provider)

        const update = await (provider as any).streamImpl({
            ...baseGoogleState(),
            modelVersion: 'gemini-2.5-flash',
            imageModelVersion: 'imagen-4.0-generate-001',
            imageModelMetaInfo: {
                provider: 'Google',
                model: 'imagen-4.0',
                modelVersion: 'imagen-4.0-generate-001',
            } as any,
            imageProviderName: 'Google',
            imageSize: '16:9',
            enableImageGeneration: false,
            mediaFanoutPlan: true,
            enableVideoGeneration: false,
            messages: [{
                role: 'user',
                content: 'generate an image of a mountain',
            }],
        } as any)

        expect(start).toHaveBeenCalled()
        expect(googleMocks.generateContentStream).toHaveBeenCalledTimes(2)
        const firstCall = googleMocks.generateContentStream.mock.calls[0] as any[]
        const secondCall = googleMocks.generateContentStream.mock.calls[1] as any[]
        expect(firstCall[0]).toMatchObject({ model: 'gemini-2.5-flash' })
        expect(firstCall[0].config).toEqual(expect.objectContaining({
            tools: expect.any(Array),
        }))
        expect(firstCall[0].config.toolConfig).toBeUndefined()
        expect(secondCall[0]).toMatchObject({
            config: expect.objectContaining({
                toolConfig: {
                    functionCallingConfig: {
                        mode: 'ANY',
                        allowedFunctionNames: ['generate_image'],
                    },
                },
            }),
        })
        expect(debugTools.warn).toHaveBeenCalledWith(
            '[Google:ws-1:thread-1] media fanout AUTO mode skipped the tool; retrying with forced function call',
        )
        expect(update.generatedImagePrompt).toBe('Auto-promote the request')
        expect(update.generatedVideoPrompt).toBeUndefined()
    })
})
