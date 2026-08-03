'use strict'

import type { CharacterPanelAssessment } from './panel-assessor.ts'

const DEFAULT_PANEL_QUALITY_THRESHOLD = 0.72

export type CharacterPanelCandidate = {
    attempt: number
    bytes: Buffer
    assessment: CharacterPanelAssessment
}

export type CharacterPanelSelection = CharacterPanelCandidate & {
    warning?: string
}

export function selectCharacterPanelCandidate(
    candidates: readonly CharacterPanelCandidate[],
    qualityThreshold = DEFAULT_PANEL_QUALITY_THRESHOLD,
): CharacterPanelSelection {
    const valid = candidates.filter(candidate => candidate.assessment.valid)
        .sort((left, right) => right.assessment.score - left.assessment.score || left.attempt - right.attempt)
    const selected = valid[0]
    if (!selected) throw new Error('CHARACTER_PANEL_NO_USABLE_CANDIDATE')
    return {
        ...selected,
        ...(selected.assessment.score < qualityThreshold
            ? { warning: `Best-effort panel accepted below quality threshold (${selected.assessment.score.toFixed(3)}).` }
            : {}),
    }
}

export function buildCharacterPanelCorrectionPrompt(args: {
    basePrompt: string
    assessment: CharacterPanelAssessment
}): string {
    const failures = args.assessment.dimensions
        .filter(dimension => args.assessment.failedDimensions.includes(dimension.dimension))
        .map(dimension => `${dimension.dimension}: ${dimension.mismatchCodes.join(', ') || 'below threshold'}`)
    return [
        args.basePrompt,
        'Correct only these failed dimensions:',
        ...failures.map(failure => `- ${failure}`),
        'Preserve every accepted identity, design, medium, crop, and framing dimension exactly.',
    ].join('\n')
}
