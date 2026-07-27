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
        isLandscape: true,
        hasFiveFullBodyViews: true,
        hasFiveHeadViews: true,
        hasExpressionShapePanels: true,
        hasHandsFeetAndPropsPanels: true,
        hasCostumePaletteMaterialAndDetailPanels: true,
        hasSixPosePanels: true,
        hasAlignmentGuides: true,
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
            layoutInstructions: 'Use every section from the attached detailed landscape template.',
            referenceFidelityInstructions: 'Preserve identity from references.',
            promptConstructionInstructions: 'Keep the complete template organization.',
            referenceCount: 2,
        })

        expect(prompt.includes('Create exactly one professional character design sheet')).toBe(true)
        expect(prompt.includes('The attached character-sheet template image is the output-layout specification')).toBe(true)
        expect(prompt.includes('Do not replace it with a simplified portrait-and-turnaround strip.')).toBe(true)
        expect(prompt.includes('REFERENCE ASSETS (2 authorized images)')).toBe(true)
        expect(prompt.includes('Preserve identity from references.')).toBe(true)
        expect(prompt.includes('Every section from the attached template must be present')).toBe(true)
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
            hasFiveHeadViews: false,
            issues: [' Missing head-turnaround row. ', ''],
        }))
        expect(failed.passed).toBe(false)
        expect(failed.issues).toEqual(['Missing head-turnaround row.'])
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
