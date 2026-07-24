import { describe, expect, it } from 'vitest'

import {
    buildCharacterCreatorImagePrompt,
    buildCharacterSheetCorrectionPrompt,
    normalizeCharacterSheetAssessment,
    type CharacterSheetAssessment,
} from './character-creator-prompt.ts'

function makeAssessment(overrides: Partial<CharacterSheetAssessment> = {}): CharacterSheetAssessment {
    return {
        isSingleImage: true,
        hasPortrait: true,
        hasFrontView: true,
        hasLeftView: true,
        hasRightView: true,
        hasBackView: true,
        hasThreeQuarterView: true,
        hasWalkingPose: true,
        fullHeightViewsUncropped: true,
        identityConsistent: true,
        outfitConsistent: true,
        labelsCorrect: true,
        issues: [],
        ...overrides,
    }
}

describe('Character Creator prompt construction', () => {
    it('builds one deterministic prompt with reference fidelity only when references exist', () => {
        const prompt = buildCharacterCreatorImagePrompt({
            prompt: 'A desert courier with a rust-red scarf.',
            layoutInstructions: 'PORTRAIT, FRONT, LEFT, RIGHT, BACK, 3/4, WALK.',
            referenceFidelityInstructions: 'Preserve identity from references.',
            promptConstructionInstructions: 'Use fixed cell order.',
            referenceCount: 2,
        })

        expect(prompt.includes('Create exactly one professional character design sheet')).toBe(true)
        expect(prompt.includes('REFERENCE ASSETS (2 authorized images)')).toBe(true)
        expect(prompt.includes('Preserve identity from references.')).toBe(true)
        expect(prompt.includes('Do not crop any full-height view.')).toBe(true)
    })

    it('rejects an empty request and excludes unused reference instructions', () => {
        expect(() => buildCharacterCreatorImagePrompt({
            prompt: ' ',
            layoutInstructions: 'layout',
            referenceFidelityInstructions: 'references',
            promptConstructionInstructions: 'prompt',
            referenceCount: 0,
        })).toThrow('CHARACTER_CREATOR_PROMPT_REQUIRED')

        const prompt = buildCharacterCreatorImagePrompt({
            prompt: 'Original character',
            layoutInstructions: 'layout',
            referenceFidelityInstructions: 'must-not-appear',
            promptConstructionInstructions: 'prompt',
            referenceCount: 0,
        })
        expect(prompt.includes('must-not-appear')).toBe(false)
    })
})

describe('Character Creator validation and correction', () => {
    it('passes only when every required sheet check passes', () => {
        expect(normalizeCharacterSheetAssessment(makeAssessment()).passed).toBe(true)

        const failed = normalizeCharacterSheetAssessment(makeAssessment({
            hasBackView: false,
            issues: [' Missing back view. ', ''],
        }))
        expect(failed.passed).toBe(false)
        expect(failed.issues).toEqual(['Missing back view.'])
    })

    it('rejects malformed assessment flags', () => {
        expect(() => normalizeCharacterSheetAssessment({
            ...makeAssessment(),
            labelsCorrect: 'yes',
        })).toThrow('CHARACTER_SHEET_ASSESSMENT_FLAG_INVALID:labelsCorrect')
    })

    it('builds one full-sheet correction prompt only for a failed validation', () => {
        const failed = normalizeCharacterSheetAssessment(makeAssessment({
            fullHeightViewsUncropped: false,
            issues: ['Front and back feet are cropped.'],
        }))
        const prompt = buildCharacterSheetCorrectionPrompt({
            originalPrompt: 'Create exactly one complete sheet.',
            validation: failed,
        })

        expect(prompt.includes('BOUNDED CORRECTION PASS')).toBe(true)
        expect(prompt.includes('Front and back feet are cropped.')).toBe(true)
        expect(prompt.includes('Return the entire corrected sheet')).toBe(true)
        expect(() => buildCharacterSheetCorrectionPrompt({
            originalPrompt: 'prompt',
            validation: normalizeCharacterSheetAssessment(makeAssessment()),
        })).toThrow('CHARACTER_SHEET_CORRECTION_NOT_REQUIRED')
    })
})
