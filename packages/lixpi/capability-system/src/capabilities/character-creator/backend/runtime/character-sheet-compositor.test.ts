'use strict'

import { createHash } from 'node:crypto'

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { buildCharacterPanelSpecs } from '../../shared/character-sheet-media-plan.ts'

import { composeCharacterSheet } from './character-sheet-compositor.ts'
import { emptyCharacterEvidenceProfile } from './character-evidence.ts'

const panelBytes = async (index: number): Promise<Buffer> => await sharp({
    create: {
        width: 512,
        height: 768,
        channels: 3,
        background: {
            r: (index * 37) % 255,
            g: (index * 71) % 255,
            b: (index * 113) % 255,
        },
    },
}).png().toBuffer()

const completePanels = async () => await Promise.all(buildCharacterPanelSpecs().map(async (panel, index) => ({
    panelId: panel.panelId,
    bytes: await panelBytes(index + 1),
})))

describe('character sheet compositor', () => {
    it('assembles a deterministic 3840x2560 PNG and stable hash', async () => {
        const panels = await completePanels()
        const evidence = {
            ...emptyCharacterEvidenceProfile(),
            medium: 'illustration' as const,
            palette: ['#8f4e36', '#243447'],
            costumeNotes: ['Long storm-collar coat'],
            materialNotes: ['Weathered canvas'],
            sourceCoverage: [{
                sourceAssetId: 'asset-1',
                angles: ['front' as const, 'profile' as const],
                regions: ['face' as const, 'body' as const, 'outfit' as const],
            }],
        }
        const first = await composeCharacterSheet({ panels, evidence })
        const second = await composeCharacterSheet({ panels, evidence })
        const metadata = await sharp(first.bytes).metadata()

        expect(metadata).toMatchObject({ format: 'png', width: 3840, height: 2560 })
        expect(first.sha256).toBe(createHash('sha256').update(first.bytes).digest('hex'))
        expect(first.sha256).toBe('79d27985850e5c85e022094bc48db4184791cb3d6f696ddc9ec5756358b8168d')
        expect(second.sha256).toBe(first.sha256)
        expect(first.sourceCoverageNote).toContain('inferred')
    }, 20000)

    it('rejects missing and corrupt required panels', async () => {
        const panels = await completePanels()
        await expect(composeCharacterSheet({
            panels: panels.filter(panel => panel.panelId !== 'prop-primary'),
            evidence: emptyCharacterEvidenceProfile(),
        })).resolves.toMatchObject({ width: 3840, height: 2560 })

        await expect(composeCharacterSheet({
            panels: panels.filter(panel => panel.panelId !== 'body-front'),
            evidence: emptyCharacterEvidenceProfile(),
        })).rejects.toThrow('CHARACTER_SHEET_REQUIRED_PANEL_MISSING:body-front')

        await expect(composeCharacterSheet({
            panels: panels.map(panel => panel.panelId === 'body-front' ? { ...panel, bytes: Buffer.from('bad') } : panel),
            evidence: emptyCharacterEvidenceProfile(),
        })).rejects.toThrow('CHARACTER_SHEET_PANEL_CORRUPT')
    }, 20000)
})
