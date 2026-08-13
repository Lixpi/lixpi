'use strict'

import { describe, expect, it } from 'vitest'

import { buildCharacterPanelSpecs } from '../../shared/character-sheet-media-plan.ts'
import { selectCharacterPanelsForRegeneration } from './panel-regeneration.ts'

describe('selectCharacterPanelsForRegeneration', () => {
    const panels = buildCharacterPanelSpecs('A courier')
    const stored = new Set(panels.map(panel => panel.panelId))

    it('regenerates only an explicitly named shot and reuses the other stored components', () => {
        const decision = selectCharacterPanelsForRegeneration({
            prompt: 'The last shot has bare arms. Fix only that back view.',
            panels,
            availableComponentIds: stored,
        })

        expect(decision).toMatchObject({
            mode: 'selected-panels',
            regeneratePanelIds: ['body-back'],
            reusePanelIds: ['head-front-neutral', 'body-front'],
        })
    })

    it('regenerates affected body shots for a cross-view bag placement correction', () => {
        const decision = selectCharacterPanelsForRegeneration({
            prompt: 'Fix the bag position, proportions, strap, and placement to match the source.',
            panels,
            availableComponentIds: stored,
        })

        expect(decision).toMatchObject({
            mode: 'selected-panels',
            regeneratePanelIds: ['body-front', 'body-back'],
            reusePanelIds: ['head-front-neutral'],
        })
    })

    it('rebuilds the full sheet for a character-wide identity change or missing stored components', () => {
        expect(selectCharacterPanelsForRegeneration({
            prompt: 'Remove the hair and replace it with short antennas in every view.',
            panels,
            availableComponentIds: stored,
        }).mode).toBe('full-sheet')
        expect(selectCharacterPanelsForRegeneration({
            prompt: 'The last shot has bare arms. Also remove the hair and replace it with antennas.',
            panels,
            availableComponentIds: stored,
        }).mode).toBe('full-sheet')
        expect(selectCharacterPanelsForRegeneration({
            prompt: 'Fix the back view.',
            panels,
            availableComponentIds: new Set(),
        }).mode).toBe('full-sheet')
    })
})
