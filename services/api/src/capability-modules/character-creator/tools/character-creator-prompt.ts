export type CharacterCreatorPromptInput = {
    prompt: string
    layoutInstructions: string
    referenceFidelityInstructions: string
    promptConstructionInstructions: string
    referenceCount: number
}

export type CharacterSheetAssessment = {
    isSingleImage: boolean
    hasPortrait: boolean
    hasFrontView: boolean
    hasLeftView: boolean
    hasRightView: boolean
    hasBackView: boolean
    hasThreeQuarterView: boolean
    hasWalkingPose: boolean
    fullHeightViewsUncropped: boolean
    identityConsistent: boolean
    outfitConsistent: boolean
    labelsCorrect: boolean
    issues: string[]
}

export type CharacterSheetValidation = CharacterSheetAssessment & {
    passed: boolean
}

const REQUIRED_ASSESSMENT_FLAGS: Array<keyof Omit<CharacterSheetAssessment, 'issues'>> = [
    'isSingleImage',
    'hasPortrait',
    'hasFrontView',
    'hasLeftView',
    'hasRightView',
    'hasBackView',
    'hasThreeQuarterView',
    'hasWalkingPose',
    'fullHeightViewsUncropped',
    'identityConsistent',
    'outfitConsistent',
    'labelsCorrect',
]

export const CHARACTER_SHEET_ASSESSMENT_JSON_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: [...REQUIRED_ASSESSMENT_FLAGS, 'issues'],
    properties: {
        isSingleImage: { type: 'boolean' },
        hasPortrait: { type: 'boolean' },
        hasFrontView: { type: 'boolean' },
        hasLeftView: { type: 'boolean' },
        hasRightView: { type: 'boolean' },
        hasBackView: { type: 'boolean' },
        hasThreeQuarterView: { type: 'boolean' },
        hasWalkingPose: { type: 'boolean' },
        fullHeightViewsUncropped: { type: 'boolean' },
        identityConsistent: { type: 'boolean' },
        outfitConsistent: { type: 'boolean' },
        labelsCorrect: { type: 'boolean' },
        issues: {
            type: 'array',
            maxItems: 20,
            items: { type: 'string' },
        },
    },
} as const

export function buildCharacterCreatorImagePrompt(input: CharacterCreatorPromptInput): string {
    const request = input.prompt.trim()
    if (!request) throw new Error('CHARACTER_CREATOR_PROMPT_REQUIRED')
    if (input.referenceCount < 0 || !Number.isInteger(input.referenceCount)) {
        throw new Error('CHARACTER_CREATOR_REFERENCE_COUNT_INVALID')
    }

    return [
        'Create exactly one professional character design sheet containing one repeated character identity.',
        '',
        'CHARACTER REQUEST',
        request,
        '',
        'FIXED LAYOUT CONTRACT',
        input.layoutInstructions.trim(),
        '',
        'PROMPT CONSTRUCTION CONTRACT',
        input.promptConstructionInstructions.trim(),
        ...(input.referenceCount > 0 ? [
            '',
            `REFERENCE ASSETS (${input.referenceCount} authorized image${input.referenceCount === 1 ? '' : 's'})`,
            input.referenceFidelityInstructions.trim(),
        ] : []),
        '',
        'FINAL OUTPUT CONSTRAINTS',
        'Return one image only. Every required view must be present in the fixed grid.',
        'Keep identity, proportions, clothing construction, accessories, materials, and colors consistent in every cell.',
        'Do not crop any full-height view. Do not add extra characters, alternate outfits, scenery, logos, or watermarks.',
    ].join('\n')
}

export function normalizeCharacterSheetAssessment(input: unknown): CharacterSheetValidation {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('CHARACTER_SHEET_ASSESSMENT_INVALID')
    }
    const assessment = input as Record<string, unknown>
    for (const flag of REQUIRED_ASSESSMENT_FLAGS) {
        if (typeof assessment[flag] !== 'boolean') {
            throw new Error(`CHARACTER_SHEET_ASSESSMENT_FLAG_INVALID:${flag}`)
        }
    }
    if (!Array.isArray(assessment.issues) || assessment.issues.some((issue) => typeof issue !== 'string')) {
        throw new Error('CHARACTER_SHEET_ASSESSMENT_ISSUES_INVALID')
    }

    const normalized = assessment as CharacterSheetAssessment
    return {
        ...normalized,
        issues: normalized.issues.map((issue) => issue.trim()).filter(Boolean),
        passed: REQUIRED_ASSESSMENT_FLAGS.every((flag) => normalized[flag]),
    }
}

export function buildCharacterSheetCorrectionPrompt(args: {
    originalPrompt: string
    validation: CharacterSheetValidation
}): string {
    if (args.validation.passed) throw new Error('CHARACTER_SHEET_CORRECTION_NOT_REQUIRED')
    const issueText = args.validation.issues.length > 0
        ? args.validation.issues.map((issue) => `- ${issue}`).join('\n')
        : '- One or more required sheet checks failed.'

    return [
        args.originalPrompt.trim(),
        '',
        'BOUNDED CORRECTION PASS',
        'Regenerate the complete single sheet once. Correct every issue below without changing the requested character design:',
        issueText,
        '',
        'Preserve the same identity and design. Return the entire corrected sheet, not a crop or isolated replacement panel.',
    ].join('\n')
}
