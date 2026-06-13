'use strict'

import { describe, expect, it } from 'vitest'

import { buildVeoReferenceImages, getGoogleImageResponseSummary } from './google-provider.ts'

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
