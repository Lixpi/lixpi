export type CharacterCreatorPromptInput = {
    prompt: string
    layoutInstructions: string
    referenceFidelityInstructions: string
    promptConstructionInstructions: string
    referenceCount: number
}

export type CharacterSheetAssessment = {
    isSingleImage: boolean
    isLandscape: boolean
    hasFiveFullBodyViews: boolean
    hasFiveHeadViews: boolean
    hasExpressionShapePanels: boolean
    hasHandsFeetAndPropsPanels: boolean
    hasCostumePaletteMaterialAndDetailPanels: boolean
    hasSixPosePanels: boolean
    hasAlignmentGuides: boolean
    fullHeightViewsUncropped: boolean
    identityConsistent: boolean
    outfitConsistent: boolean
    labelsCorrect: boolean
    issues: string[]
}

export type CharacterSheetValidation = CharacterSheetAssessment & {
    passed: boolean
}

export const CHARACTER_CREATOR_VISUAL_INSTRUCTIONS_MAX_CHARS = 8500

const REQUIRED_ASSESSMENT_FLAGS: Array<keyof Omit<CharacterSheetAssessment, 'issues'>> = [
    'isSingleImage',
    'isLandscape',
    'hasFiveFullBodyViews',
    'hasFiveHeadViews',
    'hasExpressionShapePanels',
    'hasHandsFeetAndPropsPanels',
    'hasCostumePaletteMaterialAndDetailPanels',
    'hasSixPosePanels',
    'hasAlignmentGuides',
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
        isLandscape: { type: 'boolean' },
        hasFiveFullBodyViews: { type: 'boolean' },
        hasFiveHeadViews: { type: 'boolean' },
        hasExpressionShapePanels: { type: 'boolean' },
        hasHandsFeetAndPropsPanels: { type: 'boolean' },
        hasCostumePaletteMaterialAndDetailPanels: { type: 'boolean' },
        hasSixPosePanels: { type: 'boolean' },
        hasAlignmentGuides: { type: 'boolean' },
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

    const renderPrompt = (boundedRequest: string): string => [
        'Create exactly one professional character design sheet containing one repeated character identity.',
        '',
        'CHARACTER REQUEST',
        boundedRequest,
        '',
        'AUTHORITATIVE ATTACHED TEMPLATE',
        'The attached character-sheet template image is the output-layout specification, not character-appearance inspiration.',
        'Reproduce its complete landscape organization, anatomical alignment guides, section positions, view coverage, technical labels, note panels, and pose panels. Populate every placeholder with the requested character.',
        'Character-source images define identity and design. The template defines layout. Do not replace it with a simplified portrait-and-turnaround strip.',
        '',
        'TEMPLATE LAYOUT CONTRACT',
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
        'Return one landscape image only. Every section from the attached template must be present in its corresponding region.',
        'Keep identity, proportions, clothing construction, accessories, materials, and colors consistent in every character depiction.',
        'Do not crop any full-height view. Do not omit the head, expression, hands, feet, props, notes, palette, materials, details, alignment-guide, or pose sections.',
        'Do not add extra characters, alternate outfits, scenery, logos, or watermarks.',
    ].join('\n')
    const fixedPromptLength = renderPrompt('').length
    const maximumRequestLength = Math.max(
        1,
        CHARACTER_CREATOR_VISUAL_INSTRUCTIONS_MAX_CHARS - fixedPromptLength,
    )
    const boundedRequest = request.length <= maximumRequestLength
        ? request
        : `${request.slice(0, Math.max(0, maximumRequestLength - 3)).trimEnd()}...`
    return renderPrompt(boundedRequest)
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
