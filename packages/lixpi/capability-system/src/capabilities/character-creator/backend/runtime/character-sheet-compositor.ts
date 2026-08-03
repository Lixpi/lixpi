'use strict'

import { createHash } from 'node:crypto'
import sharp from 'sharp'

import { CHARACTER_SHEET_LAYOUT, renderCharacterSheetLayoutSvg } from './character-sheet-layout.ts'
import { buildCharacterSourceCoverageNote } from './character-sheet-notes.ts'
import type { CharacterEvidenceProfile } from './character-evidence.ts'

export type CharacterPanelImage = {
    panelId: string
    bytes: Buffer
}

export type CharacterSheetComposition = {
    bytes: Buffer
    sha256: string
    width: 3840
    height: 2560
    sourceCoverageNote: string
}

export async function composeCharacterSheet(args: {
    panels: readonly CharacterPanelImage[]
    evidence: CharacterEvidenceProfile
}): Promise<CharacterSheetComposition> {
    const panelsById = new Map(args.panels.map(panel => [panel.panelId, panel.bytes]))
    const missing = CHARACTER_SHEET_LAYOUT.cells
        .filter(cell => cell.sourcePanelId !== 'prop-primary' && !panelsById.has(cell.sourcePanelId))
        .map(cell => cell.sourcePanelId)
    if (missing.length > 0) throw new Error(`CHARACTER_SHEET_REQUIRED_PANEL_MISSING:${[...new Set(missing)].join(',')}`)

    const sourceCoverageNote = buildCharacterSourceCoverageNote(args.evidence)
    const base = await renderCharacterSheetLayoutSvg({
        evidenceNotes: [
            ...args.evidence.costumeNotes.map(note => `Costume: ${note}`),
            ...args.evidence.materialNotes.map(note => `Materials: ${note}`),
            ...args.evidence.distinguishingDetailNotes.map(note => `Details: ${note}`),
        ],
        sourceCoverageNote,
        palette: args.evidence.palette,
    })
    const composites: { input: Buffer; left: number; top: number }[] = []
    for (const cell of CHARACTER_SHEET_LAYOUT.cells) {
        const input = panelsById.get(cell.sourcePanelId)
        if (!input) continue
        const contentTop = 36
        const normalized = await normalizePanelForCell(
            input,
            cell.width,
            cell.height - contentTop,
            cell.fit,
            cell.derivedCrop,
        )
        composites.push({ input: normalized, left: cell.x, top: cell.y + contentTop })
    }
    const bytes = await sharp(base)
        .composite(composites)
        .removeAlpha()
        .toColourspace('srgb')
        .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
        .toBuffer()
    const metadata = await sharp(bytes).metadata()
    if (metadata.format !== 'png' || metadata.width !== 3840 || metadata.height !== 2560) {
        throw new Error('CHARACTER_SHEET_COMPOSITION_INVALID')
    }
    return {
        bytes,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        width: 3840,
        height: 2560,
        sourceCoverageNote,
    }
}

const normalizePanelForCell = async (
    bytes: Buffer,
    width: number,
    height: number,
    fit: 'contain' | 'cover',
    derivedCrop?: 'eyes' | 'mouth' | 'feet' | 'prop',
): Promise<Buffer> => {
    try {
        const metadata = await sharp(bytes).metadata()
        if (!metadata.width || !metadata.height) throw new Error('dimensions missing')
        const position = derivedCrop === 'feet'
            ? 'south'
            : derivedCrop === 'eyes' ? 'north' : 'centre'
        return await sharp(bytes)
            .rotate()
            .resize({
                width,
                height,
                fit: derivedCrop || fit === 'cover' ? 'cover' : 'contain',
                position,
                background: '#ffffff',
                kernel: 'lanczos3',
            })
            .removeAlpha()
            .toColourspace('srgb')
            .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
            .toBuffer()
    } catch (error) {
        throw new Error(`CHARACTER_SHEET_PANEL_CORRUPT:${(error as Error).message}`)
    }
}
