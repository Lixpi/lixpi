'use strict'

import {
    describe,
    expect,
    it,
} from 'vitest'
import type {
    AiInteractionMediaGenerationRequest,
    CapabilityPromptReference,
} from '@lixpi/constants'

import {
    CHARACTER_CREATOR_TOOL_ID,
    isCharacterCreatorCapabilitySelected,
    resolveCharacterCreatorRouting,
    restrictMediaRequestToCharacterImages,
} from './character-creator-routing.ts'

describe('isCharacterCreatorCapabilitySelected', () => {
    it('returns false when references is undefined', () => {
        expect(isCharacterCreatorCapabilitySelected(undefined)).toBe(false)
    })

    it('returns false when references is empty', () => {
        expect(isCharacterCreatorCapabilitySelected([])).toBe(false)
    })

    it('returns true when a tool reference matches the character creator tool id', () => {
        const references: CapabilityPromptReference[] = [{ capabilityId: CHARACTER_CREATOR_TOOL_ID, kind: 'tool' }]
        expect(isCharacterCreatorCapabilitySelected(references)).toBe(true)
    })

    it('ignores a skill reference with a matching id (kind must be tool)', () => {
        const references: CapabilityPromptReference[] = [{ capabilityId: CHARACTER_CREATOR_TOOL_ID, kind: 'skill' }]
        expect(isCharacterCreatorCapabilitySelected(references)).toBe(false)
    })

    it('ignores a tool reference with a different capability id', () => {
        const references: CapabilityPromptReference[] = [{ capabilityId: 'global.style-extraction', kind: 'tool' }]
        expect(isCharacterCreatorCapabilitySelected(references)).toBe(false)
    })
})

describe('resolveCharacterCreatorRouting — explicit selection', () => {
    it('keeps the exact reference list untouched when the tool is already explicitly selected', () => {
        const references: CapabilityPromptReference[] = [{ capabilityId: CHARACTER_CREATOR_TOOL_ID, kind: 'tool' }]

        const result = resolveCharacterCreatorRouting('draw a goat', references)

        expect(result).toEqual({ isCharacterCreator: true, capabilityReferences: references })
        expect(result.capabilityReferences).toBe(references)
    })
})

describe('resolveCharacterCreatorRouting — prompt-pattern detection', () => {
    it.each([
        'create a character for my story',
        'Design a character with a red cape',
        'please make an original character',
        'generate a character sheet',
        'character design for the villain',
        'character turnaround, front and back',
        'model turnaround for the hero',
        'draw a character eating a sandwich in the park',
    ])('detects character-creation intent in %j', (prompt) => {
        const result = resolveCharacterCreatorRouting(prompt, undefined)
        expect(result.isCharacterCreator).toBe(true)
    })

    it.each([
        'draw a goat in a meadow',
        'generate a landscape',
        'illustrate a chair',
    ])('does not detect character-creation intent in %j', (prompt) => {
        const result = resolveCharacterCreatorRouting(prompt, undefined)
        expect(result).toEqual({ isCharacterCreator: false, capabilityReferences: undefined })
    })

    it('appends the character creator tool reference when detected implicitly, preserving existing references', () => {
        const references: CapabilityPromptReference[] = [{ capabilityId: 'global.style-extraction', kind: 'tool' }]

        const result = resolveCharacterCreatorRouting('create a character', references)

        expect(result).toEqual({
            isCharacterCreator: true,
            capabilityReferences: [
                { capabilityId: 'global.style-extraction', kind: 'tool' },
                { capabilityId: CHARACTER_CREATOR_TOOL_ID, kind: 'tool' },
            ],
        })
    })

    it('does not mutate the input references array', () => {
        const references: CapabilityPromptReference[] = [{ capabilityId: 'global.style-extraction', kind: 'tool' }]

        resolveCharacterCreatorRouting('create a character', references)

        expect(references).toEqual([{ capabilityId: 'global.style-extraction', kind: 'tool' }])
    })

    it('passes references through unchanged when no capability is detected and none were provided', () => {
        const result = resolveCharacterCreatorRouting('generate a landscape', undefined)
        expect(result.capabilityReferences).toBeUndefined()
    })
})

describe('restrictMediaRequestToCharacterImages', () => {
    function makeRequest(overrides: Partial<AiInteractionMediaGenerationRequest> = {}): AiInteractionMediaGenerationRequest {
        return {
            imageModelIds: ['OpenAI:gpt-image-1'],
            videoModelIds: ['Google:veo-3'],
            useMultipleVideoModels: true,
            videoOptions: { durationSeconds: 8 },
            ...overrides,
        } as AiInteractionMediaGenerationRequest
    }

    it('strips videoOptions and disables video model selection', () => {
        const result = restrictMediaRequestToCharacterImages(makeRequest())

        expect(result.videoOptions).toBeUndefined()
        expect(result.useMultipleVideoModels).toBe(false)
        expect(result.videoModelIds).toEqual([])
    })

    it('preserves unrelated fields such as imageModelIds', () => {
        const result = restrictMediaRequestToCharacterImages(makeRequest())
        expect(result.imageModelIds).toEqual(['OpenAI:gpt-image-1'])
    })

    it('does not mutate the input request', () => {
        const request = makeRequest()
        restrictMediaRequestToCharacterImages(request)
        expect(request.videoOptions).toEqual({ durationSeconds: 8 })
    })

    it('filters replayPrompts to image-only entries for an existing-prompt regeneration', () => {
        const request = makeRequest({
            regeneration: {
                mode: 'existing-prompt',
                replayPrompts: [
                    { mediaType: 'image', promptText: 'a' },
                    { mediaType: 'video', promptText: 'b' },
                ],
            },
        } as Partial<AiInteractionMediaGenerationRequest>)

        const result = restrictMediaRequestToCharacterImages(request)

        expect(result.regeneration).toMatchObject({
            mode: 'existing-prompt',
            replayPrompts: [{ mediaType: 'image', promptText: 'a' }],
        })
    })

    it('leaves regeneration untouched when mode is not existing-prompt', () => {
        const request = makeRequest({
            regeneration: { mode: 'new-prompt' },
        } as Partial<AiInteractionMediaGenerationRequest>)

        const result = restrictMediaRequestToCharacterImages(request)

        expect(result.regeneration).toEqual({ mode: 'new-prompt' })
    })

    it('omits regeneration entirely when the request has none', () => {
        const request = makeRequest({ regeneration: undefined })
        const result = restrictMediaRequestToCharacterImages(request)
        expect(result.regeneration).toBeUndefined()
    })
})
