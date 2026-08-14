'use strict'

import { describe, expect, it } from 'vitest'

import { buildCharacterPanelSpecs } from '../../shared/character-sheet-media-plan.ts'
import { selectCharacterPanelsForRegeneration } from './panel-regeneration.ts'

describe('selectCharacterPanelsForRegeneration', () => {
    const panels = buildCharacterPanelSpecs('A courier')
    const stored = new Set(panels.map(panel => panel.panelId))

    it('regenerates only the evidence-selected shot and reuses the other stored components', () => {
        const decision = selectCharacterPanelsForRegeneration({
            panels,
            availableComponentIds: stored,
            regenerationScope: 'selected-panels',
            affectedPanelIds: ['body-back'],
        })

        expect(decision).toMatchObject({
            mode: 'selected-panels',
            regeneratePanelIds: ['body-back'],
            reusePanelIds: ['head-front-neutral', 'body-front'],
        })
    })

    it('regenerates every evidence-selected cross-view panel', () => {
        const decision = selectCharacterPanelsForRegeneration({
            panels,
            availableComponentIds: stored,
            regenerationScope: 'selected-panels',
            affectedPanelIds: ['body-front', 'body-back'],
        })

        expect(decision).toMatchObject({
            mode: 'selected-panels',
            regeneratePanelIds: ['body-front', 'body-back'],
            reusePanelIds: ['head-front-neutral'],
        })
    })

    it('rebuilds the full sheet for full scope, unresolved scope, or missing stored components', () => {
        expect(selectCharacterPanelsForRegeneration({
            panels,
            availableComponentIds: stored,
            regenerationScope: 'full-sheet',
            affectedPanelIds: panels.map(panel => panel.panelId),
        }).mode).toBe('full-sheet')
        expect(selectCharacterPanelsForRegeneration({
            panels,
            availableComponentIds: stored,
        }).mode).toBe('full-sheet')
        expect(selectCharacterPanelsForRegeneration({
            panels,
            availableComponentIds: new Set(),
            regenerationScope: 'selected-panels',
            affectedPanelIds: ['body-back'],
        }).mode).toBe('full-sheet')
    })

    it('always regenerates missing stored components in addition to the selected panels', () => {
        const decision = selectCharacterPanelsForRegeneration({
            panels,
            availableComponentIds: new Set(['head-front-neutral', 'body-front']),
            regenerationScope: 'selected-panels',
            affectedPanelIds: ['body-front'],
        })

        expect(decision).toMatchObject({
            mode: 'selected-panels',
            regeneratePanelIds: ['body-front', 'body-back'],
            reusePanelIds: ['head-front-neutral'],
        })
    })
})
