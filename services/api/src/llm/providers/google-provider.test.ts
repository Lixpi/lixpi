'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type BaseProviderDeps } from './base-provider.ts'
import { buildVeoReferenceImages, getGoogleImageResponseSummary } from './google-provider.ts'
import { GoogleProvider } from './google-provider.ts'

const { generateContent } = vi.hoisted(() => ({
    generateContent: vi.fn(),
}))

vi.mock('@google/genai', () => ({
    GoogleGenAI: vi.fn(function() {
        return { models: { generateContent } }
    }),
}))

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
        generateContent.mockReset()
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
        generateContent.mockReset()
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
})
