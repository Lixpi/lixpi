import { describe, expect, it } from 'vitest'

import {
    applyBranchLineageNodeGap,
    normalizeBranchLineageNodeGap,
} from '$src/infographics/workspace/branchLineageNodeSpacing.ts'

describe('normalizeBranchLineageNodeGap', () => {
    it('keeps finite positive gaps and clamps invalid values to zero', () => {
        expect(normalizeBranchLineageNodeGap(64)).toBe(64)
        expect(normalizeBranchLineageNodeGap(0)).toBe(0)
        expect(normalizeBranchLineageNodeGap(-12)).toBe(0)
        expect(normalizeBranchLineageNodeGap(Number.NaN)).toBe(0)
        expect(normalizeBranchLineageNodeGap(Number.POSITIVE_INFINITY)).toBe(0)
    })
})

describe('applyBranchLineageNodeGap', () => {
    it('uses the branch-lineage node gap as the collision margin without changing resolver behavior', () => {
        const sourceSettings = { iterations: 50, margin: 4, overlapThreshold: 0 }

        expect(applyBranchLineageNodeGap(sourceSettings, 64)).toEqual({
            iterations: 50,
            margin: 64,
            overlapThreshold: 0,
        })
        expect(sourceSettings.margin).toBe(4)
    })

    it('returns the original object when the margin is already normalized', () => {
        const sourceSettings = { iterations: 20, margin: 32, overlapThreshold: 0.5 }

        expect(applyBranchLineageNodeGap(sourceSettings, 32)).toBe(sourceSettings)
    })
})
