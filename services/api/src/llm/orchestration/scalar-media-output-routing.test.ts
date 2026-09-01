import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    hasExplicitVideoOutputRequest,
    resolveScalarMediaModelSelection,
    restrictMediaRequestToExplicitVideoOutput,
} from './scalar-media-output-routing.ts'

// ===== hasExplicitVideoOutputRequest =====
describe('hasExplicitVideoOutputRequest', () => {
    it('always returns false regardless of prompt wording, as a compatibility no-op', () => {
        expect(hasExplicitVideoOutputRequest('Generate a video of this.')).toBe(false)
        expect(hasExplicitVideoOutputRequest('Animate this character.')).toBe(false)
        expect(hasExplicitVideoOutputRequest('')).toBe(false)
    })
})

// ===== restrictMediaRequestToExplicitVideoOutput =====
describe('restrictMediaRequestToExplicitVideoOutput', () => {
    const request = {
        imageModelIds: ['OpenAI:gpt-image-2'],
        videoModelIds: ['Google:veo-3.1-generate-preview', 'BytePlus:dreamina-seedance-2-0-260128'],
        useMultipleImageModels: true,
        useMultipleVideoModels: true,
        outputMediaTypes: ['image' as const, 'video' as const],
    }

    it('returns the request unchanged (identity) for an explicit video prompt', () => {
        const result = restrictMediaRequestToExplicitVideoOutput({
            request,
            prompt: 'Generate a video following ',
            hasVideoSource: false,
        })

        expect(result).toBe(request)
        expect(result).toEqual(request)
    })

    it('returns the request unchanged when an authorized extension source decides the output', () => {
        expect(restrictMediaRequestToExplicitVideoOutput({
            request,
            prompt: 'Keep going.',
            hasVideoSource: true,
        })).toBe(request)
    })

    it('returns the request unchanged when the prompt does not name a moving-media output', () => {
        expect(restrictMediaRequestToExplicitVideoOutput({
            request,
            prompt: 'Show the alley encounter.',
            hasVideoSource: false,
        })).toBe(request)
    })

    it('returns an image-only request unchanged even for an explicit video prompt', () => {
        const imageOnly = { imageModelIds: ['OpenAI:gpt-image-2'], videoModelIds: [] }

        expect(restrictMediaRequestToExplicitVideoOutput({
            request: imageOnly,
            prompt: 'Generate a video of this.',
            hasVideoSource: false,
        })).toBe(imageOnly)
    })
})

// ===== resolveScalarMediaModelSelection =====
describe('resolveScalarMediaModelSelection', () => {
    it('collapses to the image model when both are configured, regardless of prompt wording', () => {
        const prompt = 'Create a cinematic show where Robert walks along the alley and notices Jarrod eating trash.'

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
    ])('still collapses to the image model for explicit moving-media wording: %s', (prompt) => {
        expect(resolveScalarMediaModelSelection({
            prompt,
            imageModelId: 'OpenAI:gpt-image-2',
            videoModelId: 'Google:veo-3.1-lite-generate-preview',
            hasVideoSource: false,
        })).toEqual({ imageModelId: 'OpenAI:gpt-image-2' })
    })

    it('collapses to the image model even when an authorized extension source is present', () => {
        expect(resolveScalarMediaModelSelection({
            prompt: 'Keep going.',
            imageModelId: 'OpenAI:gpt-image-2',
            videoModelId: 'Google:veo-3.1-lite-generate-preview',
            hasVideoSource: true,
        })).toEqual({ imageModelId: 'OpenAI:gpt-image-2' })
    })

    it('preserves the only configured scalar media model when the other is absent', () => {
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

    it('returns an empty object when neither model id is configured', () => {
        expect(resolveScalarMediaModelSelection({
            prompt: 'Create it.',
            hasVideoSource: false,
        })).toEqual({})
    })
})
