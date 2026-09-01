import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    assertValidCharacterSheetRenderPlan,
    buildCharacterSheetRenderPlan,
    CHARACTER_BACK_ANCHOR_BINDING_KEY,
    CHARACTER_BACK_ANCHOR_PANEL_ID,
    CHARACTER_IDENTITY_ANCHOR_BINDING_KEY,
    CHARACTER_IDENTITY_ANCHOR_PANEL_ID,
    CHARACTER_OUTFIT_ANCHOR_BINDING_KEY,
    CHARACTER_OUTFIT_ANCHOR_PANEL_ID,
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
            CHARACTER_OUTFIT_ANCHOR_PANEL_ID,
            CHARACTER_BACK_ANCHOR_PANEL_ID,
        ])
        expect(plan.panels.every(panel => panel.acceptanceDimensions.includes('depiction-medium'))).toBe(true)
        expect(plan.panels.every(panel => panel.acceptanceDimensions.includes('single-panel-composition'))).toBe(true)
        expect(plan.panels.every(panel => panel.acceptanceDimensions.includes('template-conformance'))).toBe(true)
        expect(plan.panels.every(panel => panel.acceptanceDimensions.includes('target-view'))).toBe(true)
        expect(plan.panels.find(panel => panel.panelId === CHARACTER_OUTFIT_ANCHOR_PANEL_ID)).toMatchObject({
            dependsOn: [CHARACTER_IDENTITY_ANCHOR_PANEL_ID],
            outputBindings: [{
                bindingKey: CHARACTER_IDENTITY_ANCHOR_BINDING_KEY,
                sourceNodeId: CHARACTER_IDENTITY_ANCHOR_PANEL_ID,
                required: true,
                referenceRole: 'canonical-anchor',
                fileName: 'GENERATED_IDENTITY_ANCHOR.png',
            }],
        })
        expect(plan.panels.find(panel => panel.panelId === CHARACTER_BACK_ANCHOR_PANEL_ID)).toMatchObject({
            dependsOn: [CHARACTER_IDENTITY_ANCHOR_PANEL_ID, CHARACTER_OUTFIT_ANCHOR_PANEL_ID],
            outputBindings: [
                {
                    bindingKey: CHARACTER_IDENTITY_ANCHOR_BINDING_KEY,
                    sourceNodeId: CHARACTER_IDENTITY_ANCHOR_PANEL_ID,
                    required: true,
                    referenceRole: 'adjacent-angle',
                    fileName: 'GENERATED_IDENTITY_ANCHOR.png',
                },
                {
                    bindingKey: CHARACTER_OUTFIT_ANCHOR_BINDING_KEY,
                    sourceNodeId: CHARACTER_OUTFIT_ANCHOR_PANEL_ID,
                    required: true,
                    referenceRole: 'canonical-anchor',
                    fileName: 'GENERATED_OUTFIT_ANCHOR.png',
                },
            ],
        })
        expect(expandedPlan.panels.map(panel => panel.panelId)).toContain('body-profile')
        expect(
            expandedPlan.panels.slice(3).every(panel => (
                panel.outputBindings.map(binding => binding.bindingKey).join(',')
                    === `${CHARACTER_IDENTITY_ANCHOR_BINDING_KEY},${CHARACTER_OUTFIT_ANCHOR_BINDING_KEY},${CHARACTER_BACK_ANCHOR_BINDING_KEY}`
            )),
        ).toBe(true)
        expect(plan.panels.length * (plan.semanticRetryLimit + 1)).toBe(CHARACTER_SHEET_DEFAULT_OPERATION_COUNT)
        expect(expandedPlan.panels).toHaveLength(CHARACTER_SHEET_MAX_OPERATION_COUNT)
        expect(expandedPlan.panels.length * (expandedPlan.semanticRetryLimit + 1))
            .toBe(CHARACTER_SHEET_MAX_PROVIDER_OPERATIONS)
    })

    it('keeps the default back view at three shots and uses profile as the first unrequested optional shot', () => {
        const backPlan = buildCharacterSheetRenderPlan({
            capabilityRunId: 'run-back',
            sourceAssetIds: [],
            userPrompt: 'A courier; include a back view',
        })
        const fourShotPlan = buildCharacterSheetRenderPlan({
            capabilityRunId: 'run-four',
            sourceAssetIds: [],
            userPrompt: 'A courier in four shots',
        })

        expect(backPlan.panels.map(panel => panel.panelId)).toEqual([
            CHARACTER_IDENTITY_ANCHOR_PANEL_ID,
            CHARACTER_OUTFIT_ANCHOR_PANEL_ID,
            CHARACTER_BACK_ANCHOR_PANEL_ID,
        ])
        expect(fourShotPlan.panels.map(panel => panel.panelId)).toEqual([
            CHARACTER_IDENTITY_ANCHOR_PANEL_ID,
            CHARACTER_OUTFIT_ANCHOR_PANEL_ID,
            CHARACTER_BACK_ANCHOR_PANEL_ID,
            'body-profile',
        ])
        expect(fourShotPlan.panels[3]).toMatchObject({
            dependsOn: [
                CHARACTER_IDENTITY_ANCHOR_PANEL_ID,
                CHARACTER_OUTFIT_ANCHOR_PANEL_ID,
                CHARACTER_BACK_ANCHOR_PANEL_ID,
            ],
            outputBindings: [
                expect.objectContaining({ bindingKey: CHARACTER_IDENTITY_ANCHOR_BINDING_KEY }),
                expect.objectContaining({ bindingKey: CHARACTER_OUTFIT_ANCHOR_BINDING_KEY }),
                expect.objectContaining({ bindingKey: CHARACTER_BACK_ANCHOR_BINDING_KEY }),
            ],
        })
    })

    it('rejects missing dependencies, changed generated-reference metadata, unstable ids, and changed retry bounds', () => {
        const plan = buildCharacterSheetRenderPlan({ capabilityRunId: 'run-1', sourceAssetIds: [], userPrompt: 'Courier' })

        expect(() => assertValidCharacterSheetRenderPlan({ ...plan, semanticRetryLimit: 2 })).toThrow('CHARACTER_SHEET_PLAN_RETRY_LIMIT_INVALID')
        expect(() => assertValidCharacterSheetRenderPlan({ ...plan, panels: plan.panels.map((panel, index) => index === 0 ? { ...panel, panelId: 'Bad ID' } : panel) }))
            .toThrow('CHARACTER_SHEET_PLAN_PANEL_ID_INVALID')
        expect(() => assertValidCharacterSheetRenderPlan({ ...plan, panels: plan.panels.map((panel, index) => index === 0 ? { ...panel, dependsOn: ['missing'] } : panel) }))
            .toThrow('CHARACTER_SHEET_PLAN_DEPENDENCY_UNKNOWN')
        expect(() =>
            assertValidCharacterSheetRenderPlan({
                ...plan,
                panels: plan.panels.map(panel => {
                    if (panel.panelId !== 'body-back') return panel
                    return {
                        ...panel,
                        outputBindings: panel.outputBindings.map((binding, index) =>
                            index === 1
                                ? { ...binding, fileName: 'GENERATED_WRONG_ANCHOR.png' }
                                : binding
                        ),
                    }
                }),
            })
        )
            .toThrow('CHARACTER_SHEET_PLAN_GENERATED_REFERENCE_SET_INVALID:body-back')
        expect(() =>
            assertValidCharacterSheetRenderPlan({
                ...plan,
                panels: plan.panels.map(panel => {
                    if (panel.panelId !== 'body-back') return panel
                    return { ...panel, panelId: 'body-profile' }
                }),
            })
        )
            .toThrow('CHARACTER_SHEET_PLAN_DEFAULT_SEQUENCE_INVALID:body-back')
        expect(() =>
            assertValidCharacterSheetRenderPlan({
                ...plan,
                panels: plan.panels.map(panel => {
                    if (panel.panelId !== CHARACTER_OUTFIT_ANCHOR_PANEL_ID) return panel
                    return { ...panel, required: false }
                }),
            })
        )
            .toThrow('CHARACTER_SHEET_PLAN_DEFAULT_SEQUENCE_INVALID:body-front')
    })
})
