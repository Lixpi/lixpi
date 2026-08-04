'use strict'

import { createHash } from 'node:crypto'
import sharp from 'sharp'

import { buildCharacterSheetLayout, renderCharacterSheetLayoutSvg } from './character-sheet-layout.ts'
import { buildCharacterSourceCoverageNote } from './character-sheet-notes.ts'
import type { CharacterEvidenceProfile } from './character-evidence.ts'
import type { CharacterPanelAssessment } from './panel-assessor.ts'
import type { CharacterPanelSpec } from '../../shared/character-sheet-media-plan.ts'

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
    issues: string[]
}

export async function composeCharacterSheet(args: {
    panelSpecs: readonly CharacterPanelSpec[]
    panels: readonly CharacterPanelImage[]
    evidence: CharacterEvidenceProfile
    assessments?: ReadonlyMap<string, CharacterPanelAssessment>
    unavailablePanelIds?: ReadonlySet<string>
    additionalIssues?: readonly string[]
    final?: boolean
}): Promise<CharacterSheetComposition> {
    if (args.panels.length === 0) throw new Error('CHARACTER_SHEET_NO_RENDERED_PANELS')
    const layout = buildCharacterSheetLayout(args.panelSpecs)
    const panelsById = new Map(args.panels.map(panel => [panel.panelId, panel.bytes]))
    const missing = args.panelSpecs.filter(panel => !panelsById.has(panel.panelId)).map(panel => panel.panelId)
    const comparisonIssues = args.panelSpecs.flatMap(panel => {
        const assessment = args.assessments?.get(panel.panelId)
        if (!panelsById.has(panel.panelId)) return []
        if (!assessment) return args.final ? [`${panel.title}: comparison unavailable`] : []
        if (assessment.dimensions.length === 0) return [`${panel.title}: comparison unavailable`]
        if (assessment.failedDimensions.length === 0) return []
        return [`${panel.title}: ${assessment.failedDimensions.join(', ')}`]
    })
    const unavailablePanelIds = args.unavailablePanelIds ?? new Set<string>()
    const issues = [
        ...(args.additionalIssues ?? []),
        ...missing
            .filter(panelId => args.final || unavailablePanelIds.has(panelId))
            .map(panelId => `${panelId}: unavailable`),
        ...comparisonIssues,
    ]
    const statusLabels = Object.fromEntries(args.panelSpecs.map(panel => {
        const assessment = args.assessments?.get(panel.panelId)
        if (!panelsById.has(panel.panelId)) {
            return [
                panel.panelId,
                args.final || unavailablePanelIds.has(panel.panelId)
                    ? 'UNAVAILABLE - RUN AGAIN IF NEEDED'
                    : 'WAITING',
            ]
        }
        if (!assessment) return [panel.panelId, args.final ? 'RENDERED - COMPARISON UNAVAILABLE' : 'RENDERED']
        if (assessment.dimensions.length === 0) return [panel.panelId, 'RENDERED - COMPARISON UNAVAILABLE']
        if (assessment.failedDimensions.length > 0) {
            return [panel.panelId, `REVIEW - ${assessment.failedDimensions.slice(0, 3).join(' - ')}`]
        }
        return [panel.panelId, `MATCH ${Math.round(assessment.score * 100)}`]
    }))
    const sourceCoverageNote = buildCharacterSourceCoverageNote(args.evidence)
    const base = await renderCharacterSheetLayoutSvg({
        panels: args.panelSpecs,
        statusLabels,
        evidenceNotes: [
            ...issues.slice(0, 3).map(issue => `Review: ${issue}`),
            ...args.evidence.costumeNotes.slice(0, 2).map(note => `Costume: ${note}`),
            ...args.evidence.materialNotes.slice(0, 2).map(note => `Materials: ${note}`),
        ],
        sourceCoverageNote,
        palette: args.evidence.palette,
    })
    const composites: { input: Buffer; left: number; top: number }[] = []
    for (const cell of layout.cells) {
        const input = panelsById.get(cell.sourcePanelId)
        if (!input) continue
        const contentTop = 56
        const normalized = await normalizePanelForCell(
            input,
            cell.width,
            cell.height - contentTop,
            cell.fit,
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
        issues,
    }
}

const normalizePanelForCell = async (
    bytes: Buffer,
    width: number,
    height: number,
    fit: 'contain' | 'cover',
): Promise<Buffer> => {
    try {
        const metadata = await sharp(bytes).metadata()
        if (!metadata.width || !metadata.height) throw new Error('dimensions missing')
        return await sharp(bytes)
            .rotate()
            .resize({
                width,
                height,
                fit,
                position: 'centre',
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
