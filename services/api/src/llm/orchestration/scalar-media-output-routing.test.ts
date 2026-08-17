'use strict'

import { describe, expect, it } from 'vitest'

import {
    hasExplicitVideoOutputRequest,
    resolveScalarMediaModelSelection,
} from './scalar-media-output-routing.ts'

describe('scalar media output routing', () => {
    it('keeps action-heavy scene descriptions on the image model without an explicit video request', () => {
        const prompt = 'Create a cinematic show where Robert walks along the alley and notices Jarrod eating trash.'

        expect(hasExplicitVideoOutputRequest(prompt)).toBe(false)
        expect(resolveScalarMediaModelSelection({
            prompt,
            imageModelId: 'OpenAI:gpt-image-2',
            videoModelId: 'Google:veo-3.1-lite-generate-preview',
            hasVideoSource: false,
        })).toEqual({ imageModelId: 'OpenAI:gpt-image-2' })
    })

    it.each([
        'Create a cinematic video where the character walks through the alley.',
        'Animate this character walking through the alley.',
        'Turn this image into a short clip.',
        'Continue the source video for another five seconds.',
        'Film this scene from across the street.',
    ])('selects video for an explicit moving-media request: %s', (prompt) => {
        expect(hasExplicitVideoOutputRequest(prompt)).toBe(true)
        expect(resolveScalarMediaModelSelection({
            prompt,
            imageModelId: 'OpenAI:gpt-image-2',
            videoModelId: 'Google:veo-3.1-lite-generate-preview',
            hasVideoSource: false,
        })).toEqual({ videoModelId: 'Google:veo-3.1-lite-generate-preview' })
    })

    it('selects video for an authorized extension source without relying on prompt wording', () => {
        expect(resolveScalarMediaModelSelection({
            prompt: 'Keep going.',
            imageModelId: 'OpenAI:gpt-image-2',
            videoModelId: 'Google:veo-3.1-lite-generate-preview',
            hasVideoSource: true,
        })).toEqual({ videoModelId: 'Google:veo-3.1-lite-generate-preview' })
    })

    it('preserves the only configured scalar media model', () => {
        expect(resolveScalarMediaModelSelection({
            prompt: 'Create it.',
            imageModelId: 'OpenAI:gpt-image-2',
            hasVideoSource: false,
        })).toEqual({ imageModelId: 'OpenAI:gpt-image-2' })
        expect(resolveScalarMediaModelSelection({
            prompt: 'Create it.',
            videoModelId: 'Google:veo-3.1-lite-generate-preview',
            hasVideoSource: false,
        })).toEqual({ videoModelId: 'Google:veo-3.1-lite-generate-preview' })
    })
})
