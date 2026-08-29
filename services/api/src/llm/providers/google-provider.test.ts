'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    directCapabilityToolName,
    SealedResolvedCapabilityPlan,
} from '@lixpi/capability-system/backend'
import type {
    AiModelInferenceCapabilities,
    CapabilityManifest,
    CapabilityResourceRef,
    ResolvedCapabilityPlan,
} from '@lixpi/constants'

const debugTools = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    err: vi.fn(),
}))

vi.mock('@lixpi/debug-tools', () => debugTools)

import { type BaseProviderDeps } from './base-provider.ts'
import { CURRENT_MEDIA_PROVIDER_DEFINITIONS } from './current-media-provider-definitions.ts'
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

const GOOGLE_INFERENCE_CAPABILITIES: AiModelInferenceCapabilities = {
    thinkingMode: 'google-budget',
    requiresAutoToolChoiceWithThinking: false,
    supportsTemperature: true,
    supportsSystemPrompt: true,
    requiresClosedJsonSchema: false,
    supportedInputKinds: ['image', 'video-frame', 'audio', 'document-text'],
}

const googleModelMeta = (
    modelVersion: string,
    modalities: string[] = ['text'],
    inferenceCapabilities: AiModelInferenceCapabilities = GOOGLE_INFERENCE_CAPABILITIES,
) => ({
    provider: 'Google',
    model: modelVersion,
    modelVersion,
    inferenceCapabilities,
    modalities: modalities.map(modality => ({ modality })),
})

const createProviderDeps = (): BaseProviderDeps => ({
    natsService: { publish: vi.fn() } as any,
    storeWorkspaceImage: vi.fn(),
    storeWorkspaceVideo: vi.fn(),
    usageReporter: {} as any,
    runImageRouter: vi.fn(),
    runVideoRouter: vi.fn(),
    mediaProviderDefinition: CURRENT_MEDIA_PROVIDER_DEFINITIONS.Google,
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
    aiModelMetaInfo: googleModelMeta('gemini-2.5-flash') as any,
    maxCompletionSize: 1000,
    temperature: 0.7,
})

const makeModelRequiredPlan = (): SealedResolvedCapabilityPlan => {
    const schemaRef: CapabilityResourceRef = {
        resourceId: 'input',
        blobHash: 'input-hash',
        mediaType: 'application/schema+json',
        role: 'schema',
    }
    const manifest: CapabilityManifest = {
        schemaVersion: 1,
        capabilityId: 'action-timeline',
        kind: 'tool',
        name: 'Action Timeline',
        description: 'Create a timed action timeline.',
        references: [],
        resources: [schemaRef],
        tool: {
            toolType: 'action-timeline',
            inputSchema: schemaRef,
            outputSchema: schemaRef,
            executionPolicy: 'model-required',
            executionMultiplicity: 'per-reasoning-model',
            modelAxisPolicy: {
                reasoning: 'all-selected',
                image: 'ignore',
                video: 'ignore',
                outputMode: 'capability-only',
            },
            workflow: { steps: [], outputs: {} },
        },
    }
    const serializable: ResolvedCapabilityPlan = {
        rootCapabilityIds: ['action-timeline'],
        capabilities: [{ capabilityId: 'action-timeline', kind: 'tool', manifestBlobHash: 'manifest-hash', manifest }],
        resolvedManifests: [{ capabilityId: 'action-timeline', manifestBlobHash: 'manifest-hash' }],
    }
    return new SealedResolvedCapabilityPlan(serializable, [{
        capabilityId: 'action-timeline',
        ref: schemaRef,
        bytes: new TextEncoder().encode(JSON.stringify({
            type: 'object',
            required: ['durationMs', 'precisionMs'],
            properties: {
                durationMs: { type: 'number' },
                precisionMs: { type: 'number' },
            },
            additionalProperties: false,
        })),
    }])
}

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

describe('GoogleProvider construction', () => {
    const createDeps = (): BaseProviderDeps => ({
        natsService: { publish: vi.fn() } as any,
        storeWorkspaceImage: vi.fn(),
        storeWorkspaceVideo: vi.fn(),
        usageReporter: {} as any,
        runImageRouter: vi.fn(),
        runVideoRouter: vi.fn(),
        mediaProviderDefinition: CURRENT_MEDIA_PROVIDER_DEFINITIONS.Google,
    }) as unknown as BaseProviderDeps

    beforeEach(() => {
        process.env.GOOGLE_API_KEY = 'test-key'
        process.env.GOOGLE_VEO_PERSON_GENERATION_PROFILE = 'standard'
        resetGoogleMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
        delete process.env.GOOGLE_API_KEY
        delete process.env.GOOGLE_VEO_PERSON_GENERATION_PROFILE
    })

    it('requires GOOGLE_API_KEY to instantiate provider', () => {
        delete process.env.GOOGLE_API_KEY
        expect(() => new GoogleProvider('ws-1:thread-1', createDeps()))
            .toThrow('GOOGLE_API_KEY environment variable is required')
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
        mediaProviderDefinition: CURRENT_MEDIA_PROVIDER_DEFINITIONS.Google,
    }) as unknown as BaseProviderDeps

    beforeEach(() => {
        process.env.GOOGLE_API_KEY = 'test-key'
        process.env.GOOGLE_VEO_PERSON_GENERATION_PROFILE = 'standard'
        resetGoogleMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
        delete process.env.GOOGLE_API_KEY
        delete process.env.GOOGLE_VEO_PERSON_GENERATION_PROFILE
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
        const sourceBytes = Buffer.from('original-source')
        const layoutBytes = Buffer.from('structure-reference')

        const update = await (provider as any).streamImpl({
            ...baseGoogleState(),
            modelVersion: 'gemini-2.5-flash-image',
            aiModelMetaInfo: googleModelMeta(
                'gemini-2.5-flash-image',
                ['text', 'image', 'image_generation'],
            ),
            enableImageGeneration: true,
            imageSize: '16:9',
            messages: [{ role: 'user', content: 'show me a dog' }],
            resolvedImageGenerationReferences: [
                {
                    url: 'source-url',
                    role: 'original-source',
                    fileName: 'original-source-1.jpg',
                    bytes: sourceBytes,
                    dataUrl: `data:image/jpeg;base64,${sourceBytes.toString('base64')}`,
                    mediaType: 'image/jpeg',
                    byteLength: sourceBytes.byteLength,
                    sha256: 'source-sha',
                },
                {
                    url: 'layout-url',
                    role: 'structure-reference',
                    fileName: 'structure-reference-1.png',
                    bytes: layoutBytes,
                    dataUrl: `data:image/png;base64,${layoutBytes.toString('base64')}`,
                    mediaType: 'image/png',
                    byteLength: layoutBytes.byteLength,
                    sha256: 'layout-sha',
                },
            ],
        })

        expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
            contents: [{
                role: 'user',
                parts: [
                    { text: 'show me a dog' },
                    {
                        text: 'REFERENCE IMAGE 1 — AUTHORITATIVE ORIGINAL SOURCE. File: original-source-1.jpg. Use its observed design, clothing, material, accessory, and placement evidence wherever the request assigns the target appearance to this source.',
                    },
                    { inlineData: { mimeType: 'image/jpeg', data: sourceBytes.toString('base64') } },
                    {
                        text: 'REFERENCE IMAGE 2 — STRUCTURE REFERENCE ONLY. File: structure-reference-1.png. Use its composition without copying identity or design.',
                    },
                    { inlineData: { mimeType: 'image/png', data: layoutBytes.toString('base64') } },
                ],
            }],
        }))
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

    it('configures native image thinking from synchronized capabilities instead of the model name', async () => {
        generateContent.mockResolvedValueOnce({
            candidates: [{
                content: {
                    parts: [{ inlineData: { data: 'iVBORw0KGgo=', mimeType: 'image/png' } }],
                },
            }],
        })

        const provider = new GoogleProvider('ws-1:thread-1', createProviderDeps())
        configureProviderInternals(provider)

        await (provider as any).streamImpl({
            ...baseGoogleState(),
            modelVersion: 'synchronized-image-model',
            aiModelMetaInfo: googleModelMeta(
                'synchronized-image-model',
                ['text', 'image', 'image_generation'],
                { ...GOOGLE_INFERENCE_CAPABILITIES, thinkingMode: 'google-level' },
            ),
            enableImageGeneration: true,
            messages: [{ role: 'user', content: 'show me a dog' }],
        })

        expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
            model: 'synchronized-image-model',
            config: expect.objectContaining({
                thinkingConfig: { includeThoughts: true },
            }),
        }))
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
            aiModelMetaInfo: googleModelMeta(
                'gemini-2.5-flash-image',
                ['text', 'image', 'image_generation'],
            ),
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

    it('registers standing Capability tools and continues after search_capabilities results', async () => {
        googleMocks.generateContentStream.mockResolvedValueOnce(makeAsyncStream([{
            usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
            candidates: [{
                content: {
                    parts: [{
                        functionCall: {
                            name: 'search_capabilities',
                            args: { query: 'character' },
                        },
                    }],
                },
            }],
        }]))
        googleMocks.generateContentStream.mockResolvedValueOnce(makeAsyncStream([{
            usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 },
            candidates: [{ content: { parts: [{ text: 'I found the Tool.' }] } }],
        }]))
        const search = vi.fn(async () => ({
            items: [{
                capabilityId: 'character-creator',
                kind: 'tool',
                name: 'Character Creator',
                summary: 'Creates sheets',
                tags: ['character'],
            }],
        }))
        const deps = {
            ...createProviderDeps(),
            capabilityDispatcher: { search, use: vi.fn() },
        } as any
        const provider = new GoogleProvider('ws-1:thread-1', deps)
        const { chunk } = configureProviderInternals(provider)

        const update = await (provider as any).streamImpl({
            ...baseGoogleState(),
            eventMeta: { userId: 'user-1', organizationId: 'organization-1' },
            capabilityInvocationDepth: 0,
        } as any)

        expect(search).toHaveBeenCalledWith(
            expect.objectContaining({ query: 'character' }),
            expect.objectContaining({ userId: 'user-1', workspaceId: 'ws-1' }),
        )
        expect(googleMocks.generateContentStream).toHaveBeenCalledTimes(2)
        expect(googleMocks.generateContentStream.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
            config: expect.objectContaining({
                tools: [{
                    functionDeclarations: expect.arrayContaining([
                        expect.objectContaining({ name: 'search_capabilities' }),
                        expect.objectContaining({ name: 'use_capability' }),
                    ]),
                }],
            }),
        }))
        expect(googleMocks.generateContentStream.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
            contents: expect.arrayContaining([
                expect.objectContaining({
                    role: 'user',
                    parts: [expect.objectContaining({
                        functionResponse: expect.objectContaining({ name: 'search_capabilities' }),
                    })],
                }),
            ]),
        }))
        expect(chunk).toHaveBeenCalledWith('I found the Tool.')
        expect(update.usage).toEqual(expect.objectContaining({
            promptTokens: 5,
            completionTokens: 5,
            totalTokens: 10,
        }))
    })

    it('forces the attached Action Timeline Tool, then streams the reasoning response after execution', async () => {
        const toolName = directCapabilityToolName('action-timeline')
        googleMocks.generateContentStream.mockResolvedValueOnce(makeAsyncStream([{
            candidates: [{
                content: {
                    parts: [{
                        functionCall: {
                            name: toolName,
                            args: { durationMs: 1, precisionMs: 1 },
                        },
                    }],
                },
            }],
        }]))
        googleMocks.generateContentStream.mockResolvedValueOnce(makeAsyncStream([{
            candidates: [{ content: { parts: [{ text: 'The action timeline is ready.' }] } }],
        }]))
        const use = vi.fn(async () => ({
            run: { runId: 'timeline-run', status: 'completed', outputAssetIds: ['timeline-asset'] },
            output: { outputKind: 'capabilityArtifact', assetId: 'timeline-asset' },
            stepOutputs: {},
            events: [],
        }))
        const provider = new GoogleProvider('ws-1:thread-1', {
            ...createProviderDeps(),
            capabilityDispatcher: { use },
        } as any)
        const internals = configureProviderInternals(provider)
        const capabilityGenerationTrace = vi.fn()
        ;(provider as any).streamPublisher.capabilityGenerationTrace = capabilityGenerationTrace

        const state = {
            ...baseGoogleState(),
            eventMeta: { userId: 'user-1', organizationId: 'organization-1' },
            resolvedCapabilityPlan: makeModelRequiredPlan(),
            capabilityInputs: {
                'action-timeline': { durationMs: 15000, precisionMs: 2000 },
            },
            generationRun: {
                requestKind: 'media-generation-matrix',
                generationRequestId: 'request-1',
                reasoningRunId: 'reasoning-1',
                reasoningModelId: 'Google:gemini-2.5-flash',
                reasoningIndex: 0,
            },
        } as any

        await (provider as any).streamImpl(state)

        expect(googleMocks.generateContentStream).toHaveBeenCalledTimes(2)
        expect(googleMocks.generateContentStream.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
            config: expect.objectContaining({
                toolConfig: {
                    functionCallingConfig: {
                        mode: 'ANY',
                        allowedFunctionNames: [toolName],
                    },
                },
            }),
        }))
        expect(googleMocks.generateContentStream.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
            contents: expect.arrayContaining([
                expect.objectContaining({
                    role: 'user',
                    parts: [expect.objectContaining({
                        functionResponse: expect.objectContaining({ name: toolName }),
                    })],
                }),
            ]),
            config: expect.not.objectContaining({ toolConfig: expect.anything() }),
        }))
        expect(googleMocks.generateContentStream.mock.calls[1]?.[0]?.config?.tools).toBeUndefined()
        expect(googleMocks.generateContentStream.mock.calls[1]?.[0]?.config?.systemInstruction)
            .toContain('Do not include code')
        expect(googleMocks.generateContentStream.mock.calls[0]?.[0]?.config?.systemInstruction)
            .not.toContain('Do not include code')
        expect(use).toHaveBeenCalledWith(expect.objectContaining({
            arguments: expect.objectContaining({
                durationMs: 15000,
                precisionMs: 2000,
            }),
        }))
        expect(capabilityGenerationTrace).toHaveBeenCalledWith(expect.objectContaining({
            capabilityName: 'Action Timeline',
            capabilityRunId: 'timeline-run',
        }))
        expect(internals.chunk).toHaveBeenCalledWith('The action timeline is ready.')
        expect(internals.end).not.toHaveBeenCalled()
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

    it('streams VEO from synchronized video modality metadata and updates media usage', async () => {
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
            aiModelMetaInfo: googleModelMeta(
                'veo-3.1-generate-preview',
                ['video', 'video_generation'],
            ),
            enableVideoGeneration: true,
            videoModelVersion: 'veo-3.1-generate-preview',
            videoModelMetaInfo: { provider: 'Google', model: 'veo-3.1', modelVersion: 'veo-3.1-generate-preview' } as any,
            videoProviderName: 'Google',
            videoAspectRatio: '16:9',
            videoResolution: '720p',
            videoDurationSeconds: 8,
            videoGenerationConfig: { negativePrompt: 'no subtitles or captions' },
            videoFirstFrameImage: 'data:image/png;base64,ZmFrZQ==',
            messages: [{ role: 'user', content: 'make a cinematic shot' }],
        } as any)

        const completeArgs = videoPublisher.complete.mock.calls[0]?.[0]
        const generateRequest = googleMocks.generateVideos.mock.calls[0]?.[0]
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
        expect(generateRequest.config).toMatchObject({
            numberOfVideos: 1,
            aspectRatio: '16:9',
            resolution: '720p',
            durationSeconds: 8,
            negativePrompt: 'no subtitles or captions',
            personGeneration: 'allow_adult',
        })
        expect(generateRequest.source).toEqual({
            prompt: 'make a cinematic shot',
            image: { imageBytes: 'ZmFrZQ==', mimeType: 'image/png' },
        })
        expect(generateRequest).not.toHaveProperty('prompt')
        expect(generateRequest).not.toHaveProperty('image')
        expect(generateRequest).not.toHaveProperty('video')
        expect(generateRequest.config).not.toHaveProperty('seed')
        expect(completeArgs).not.toHaveProperty('generationSeed')
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
            aiModelMetaInfo: googleModelMeta(
                'veo-3.1-generate-preview',
                ['video', 'video_generation'],
            ),
            enableVideoGeneration: true,
            videoModelVersion: 'veo-3.1-generate-preview',
            videoModelMetaInfo: { provider: 'Google', model: 'veo-3.1', modelVersion: 'veo-3.1-generate-preview' } as any,
            videoProviderName: 'Google',
            messages: [{ role: 'user', content: 'make a cinematic shot' }],
        } as any)

        const expectedError = 'VEO: operation completed without a video (operation=operations/veo-empty, generatedVideoCount=0, raiMediaFilteredCount=0)'
        expect(update.error).toBe(expectedError)
        expect(videoPublisher.error).toHaveBeenCalledWith(expectedError)
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
            '[Google:ws-1:thread-1] AUTO tool selection did not satisfy the media request; retrying with forced function call {"explicitVideoToolRequired":false,"forcedFunctionNames":["generate_image"],"detectedImage":false,"detectedVideo":false,"textCharacterCount":23,"finishReasons":[],"functionCallNames":[]}',
        )
        expect(update.generatedImagePrompt).toBe('Auto-promote the request')
        expect(update.generatedVideoPrompt).toBeUndefined()
    })
})
