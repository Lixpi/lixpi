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
