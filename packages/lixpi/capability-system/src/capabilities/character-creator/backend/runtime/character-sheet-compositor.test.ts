import { createHash } from 'node:crypto'

import sharp from 'sharp'
import {
    describe,
    expect,
    it,
} from 'vitest'
import { buildCharacterPanelSpecs } from '../../shared/character-sheet-media-plan.ts'

import { composeCharacterSheet } from './character-sheet-compositor.ts'
import { emptyCharacterEvidenceProfile } from './character-evidence.ts'

const panelBytes = async (index: number): Promise<Buffer> =>
    await sharp({
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

const completePanels = async (panelSpecs = buildCharacterPanelSpecs()) =>
    await Promise.all(panelSpecs.map(async (panel, index) => ({
        panelId: panel.panelId,
        bytes: await panelBytes(index + 1),
    })))

describe('character sheet compositor', () => {
    it('assembles a deterministic 3840x2560 PNG and stable hash', async () => {
        const panelSpecs = buildCharacterPanelSpecs()
        const panels = await completePanels(panelSpecs)
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
        const first = await composeCharacterSheet({ panelSpecs, panels, evidence })
        const second = await composeCharacterSheet({ panelSpecs, panels, evidence })
        const metadata = await sharp(first.bytes).metadata()

        expect(metadata).toMatchObject({ format: 'png', width: 3840, height: 2560 })
        expect(first.sha256).toBe(createHash('sha256').update(first.bytes).digest('hex'))
        expect(first.sha256).toBe('74b89791320acfb013ab2e85aac04835a7b845ba7cc3966486f8c6445151f031')
        expect(second.sha256).toBe(first.sha256)
        expect(first.sourceCoverageNote).toContain('inferred')
    }, 20000)

    it('records unavailable final panels and rejects corrupt rendered panels', async () => {
        const panelSpecs = buildCharacterPanelSpecs()
        const panels = await completePanels(panelSpecs)
        await expect(composeCharacterSheet({
            panelSpecs,
            panels: panels.filter(panel => panel.panelId !== 'body-front'),
            evidence: emptyCharacterEvidenceProfile(),
        })).resolves.toMatchObject({ width: 3840, height: 2560, issues: [] })

        await expect(composeCharacterSheet({
            panelSpecs,
            panels: panels.filter(panel => panel.panelId !== 'body-front'),
            evidence: emptyCharacterEvidenceProfile(),
            final: true,
        })).resolves.toMatchObject({
            issues: [
                'body-front: unavailable',
                'Neutral front identity portrait: comparison unavailable',
                'Back body: comparison unavailable',
            ],
        })

        await expect(composeCharacterSheet({
            panelSpecs,
            panels: panels.map(panel => panel.panelId === 'body-front' ? { ...panel, bytes: Buffer.from('bad') } : panel),
            evidence: emptyCharacterEvidenceProfile(),
        })).rejects.toThrow('CHARACTER_SHEET_PANEL_CORRUPT')
    }, 20000)
})
