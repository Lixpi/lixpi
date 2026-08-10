import { describe, expect, it } from 'vitest'

import {
    assertValidCharacterSheetRenderPlan,
    buildCharacterSheetRenderPlan,
    CHARACTER_IDENTITY_ANCHOR_BINDING_KEY,
    CHARACTER_IDENTITY_ANCHOR_PANEL_ID,
    CHARACTER_SHEET_DEFAULT_OPERATION_COUNT,
    CHARACTER_SHEET_MAX_OPERATION_COUNT,
    CHARACTER_SHEET_MAX_PROVIDER_OPERATIONS,
} from './character-sheet-media-plan.ts'

describe('CharacterSheetRenderPlan', () => {
    it('builds default and expanded DAGs within the one-attempt provider operation bound', () => {
        const plan = buildCharacterSheetRenderPlan({
            capabilityRunId: 'run-1',
            sourceAssetIds: ['asset-1', 'asset-1', 'asset-2'],
            userPrompt: 'A desert courier',
        })
        const expandedPlan = buildCharacterSheetRenderPlan({
            capabilityRunId: 'run-2',
            sourceAssetIds: ['asset-1'],
            userPrompt: 'A comprehensive character sheet',
        })

        expect(plan.sourceAssetIds).toEqual(['asset-1', 'asset-2'])
        expect(plan.panels).toHaveLength(CHARACTER_SHEET_DEFAULT_OPERATION_COUNT)
        expect(plan.panels.map(panel => panel.panelId)).toEqual([
            CHARACTER_IDENTITY_ANCHOR_PANEL_ID,
            'body-front',
            'body-profile',
        ])
        expect(plan.panels.find(panel => panel.panelId === 'body-front')).toMatchObject({
            dependsOn: [CHARACTER_IDENTITY_ANCHOR_PANEL_ID],
            outputBindings: [{
                bindingKey: CHARACTER_IDENTITY_ANCHOR_BINDING_KEY,
                sourceNodeId: CHARACTER_IDENTITY_ANCHOR_PANEL_ID,
                required: true,
            }],
        })
        expect(plan.panels.length * (plan.semanticRetryLimit + 1)).toBe(CHARACTER_SHEET_DEFAULT_OPERATION_COUNT)
        expect(expandedPlan.panels).toHaveLength(CHARACTER_SHEET_MAX_OPERATION_COUNT)
        expect(expandedPlan.panels.length * (expandedPlan.semanticRetryLimit + 1))
            .toBe(CHARACTER_SHEET_MAX_PROVIDER_OPERATIONS)
    })

    it('rejects cycles, missing dependencies, unstable ids, and changed retry bounds', () => {
        const plan = buildCharacterSheetRenderPlan({ capabilityRunId: 'run-1', sourceAssetIds: [], userPrompt: 'Courier' })

        expect(() => assertValidCharacterSheetRenderPlan({ ...plan, semanticRetryLimit: 2 })).toThrow('CHARACTER_SHEET_PLAN_RETRY_LIMIT_INVALID')
        expect(() => assertValidCharacterSheetRenderPlan({ ...plan, panels: plan.panels.map((panel, index) => index === 0 ? { ...panel, panelId: 'Bad ID' } : panel) }))
            .toThrow('CHARACTER_SHEET_PLAN_PANEL_ID_INVALID')
        expect(() => assertValidCharacterSheetRenderPlan({ ...plan, panels: plan.panels.map((panel, index) => index === 0 ? { ...panel, dependsOn: ['missing'] } : panel) }))
            .toThrow('CHARACTER_SHEET_PLAN_DEPENDENCY_UNKNOWN')
        expect(() => assertValidCharacterSheetRenderPlan({
            ...plan,
            panels: plan.panels.map(panel => {
                if (panel.panelId === 'body-front') {
                    return { ...panel, dependsOn: [CHARACTER_IDENTITY_ANCHOR_PANEL_ID, 'body-profile'] }
                }
                if (panel.panelId === 'body-profile') {
                    return { ...panel, dependsOn: [CHARACTER_IDENTITY_ANCHOR_PANEL_ID, 'body-front'] }
                }
                return panel
            }),
        }))
            .toThrow('CHARACTER_SHEET_PLAN_CYCLE')
    })
})
