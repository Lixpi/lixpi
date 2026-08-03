import { describe, expect, it } from 'vitest'

import {
    assertValidCharacterSheetRenderPlan,
    buildCharacterSheetRenderPlan,
    CHARACTER_SHEET_BASE_OPERATION_COUNT,
    CHARACTER_SHEET_MAX_OPERATION_COUNT,
    CHARACTER_SHEET_MAX_PROVIDER_OPERATIONS,
} from './character-sheet-media-plan.ts'

describe('CharacterSheetRenderPlan', () => {
    it('builds the stable 26 plus optional prop graph within the hard semantic operation bound', () => {
        const plan = buildCharacterSheetRenderPlan({
            capabilityRunId: 'run-1',
            sourceAssetIds: ['asset-1', 'asset-1', 'asset-2'],
            userPrompt: 'A desert courier',
        })

        expect(plan.sourceAssetIds).toEqual(['asset-1', 'asset-2'])
        expect(plan.panels).toHaveLength(CHARACTER_SHEET_MAX_OPERATION_COUNT)
        expect(plan.panels.filter(panel => panel.condition === 'always')).toHaveLength(CHARACTER_SHEET_BASE_OPERATION_COUNT)
        expect(plan.panels.length * (plan.semanticRetryLimit + 1)).toBe(CHARACTER_SHEET_MAX_PROVIDER_OPERATIONS)
        expect(plan.panels.find(panel => panel.panelId === 'body-front')?.dependsOn).toEqual([])
        expect(plan.panels.find(panel => panel.panelId === 'head-profile-left')?.dependsOn)
            .toEqual(['head-front', 'body-profile-left', 'head-three-quarter-front-left'])
    })

    it('rejects cycles, missing dependencies, unstable ids, and changed retry bounds', () => {
        const plan = buildCharacterSheetRenderPlan({ capabilityRunId: 'run-1', sourceAssetIds: [], userPrompt: 'Courier' })

        expect(() => assertValidCharacterSheetRenderPlan({ ...plan, semanticRetryLimit: 2 })).toThrow('CHARACTER_SHEET_PLAN_RETRY_LIMIT_INVALID')
        expect(() => assertValidCharacterSheetRenderPlan({ ...plan, panels: plan.panels.map((panel, index) => index === 0 ? { ...panel, panelId: 'Bad ID' } : panel) }))
            .toThrow('CHARACTER_SHEET_PLAN_PANEL_ID_INVALID')
        expect(() => assertValidCharacterSheetRenderPlan({ ...plan, panels: plan.panels.map((panel, index) => index === 0 ? { ...panel, dependsOn: ['missing'] } : panel) }))
            .toThrow('CHARACTER_SHEET_PLAN_DEPENDENCY_UNKNOWN')
        expect(() => assertValidCharacterSheetRenderPlan({ ...plan, panels: plan.panels.map((panel, index) => index === 0 ? { ...panel, dependsOn: ['body-three-quarter-front-left'] } : panel) }))
            .toThrow('CHARACTER_SHEET_PLAN_CYCLE')
    })
})
