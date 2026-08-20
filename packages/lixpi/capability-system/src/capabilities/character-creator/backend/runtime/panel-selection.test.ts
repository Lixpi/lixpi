'use strict'

import { describe, expect, it } from 'vitest'

import { selectCharacterPanelCandidate } from './panel-selection.ts'

const candidate = (attempt: number, score: number, failedDimensions: string[] = []) => ({
    attempt,
    bytes: Buffer.from([attempt]),
    assessment: {
        panelId: 'head-front',
        attemptId: `attempt-${attempt}`,
        valid: true,
        score,
        dimensions: [
            { dimension: 'facial-identity', score: failedDimensions.includes('facial-identity') ? 0.4 : 0.9, mismatchCodes: ['FACE_SHAPE'] },
            { dimension: 'framing', score: 0.9, mismatchCodes: [] },
        ],
        fidelityMetric: { available: false, unavailableReason: 'non-photographic' as const },
        vlmAssessor: 'test/model',
        failedDimensions,
    },
})

describe('character panel selection', () => {
    it('selects the best valid attempt and records below-threshold warnings', () => {
        expect(selectCharacterPanelCandidate([candidate(1, 0.6), candidate(2, 0.68)])).toMatchObject({
            attempt: 2,
            warning: expect.stringContaining('Best-effort'),
        })
    })

    it('uses the earliest attempt as the deterministic tie-breaker', () => {
        const selected = selectCharacterPanelCandidate([
            candidate(2, 0.9),
            candidate(1, 0.9),
        ])

        expect(selected).toMatchObject({ attempt: 1 })
        expect(selected).not.toHaveProperty('warning')
    })
})
