import { createHash } from 'node:crypto'
import sharp from 'sharp'

import { buildCharacterSheetLayout } from '../../shared/character-sheet-layout.ts'
import { buildCharacterSourceCoverageNote } from './character-sheet-notes.ts'
import {
    type CharacterEvidenceProfile,
} from './character-evidence.ts'
import {
    type CharacterPanelAssessment,
} from './panel-assessor.ts'
import {
    type CharacterPanelSpec,
} from '../../shared/character-sheet-media-plan.ts'

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

export const composeCharacterSheet = async (args: {
    panelSpecs: readonly CharacterPanelSpec[]
    panels: readonly CharacterPanelImage[]
    evidence: CharacterEvidenceProfile
    assessments?: ReadonlyMap<string, CharacterPanelAssessment>
    unavailablePanelIds?: ReadonlySet<string>
    additionalIssues?: readonly string[]
    final?: boolean
}): Promise<CharacterSheetComposition> => {
    if (args.panels.length === 0)
        throw new Error('CHARACTER_SHEET_NO_RENDERED_PANELS')

    const layout = buildCharacterSheetLayout(args.panelSpecs)
    const panelsById = new Map(
        args.panels.map(panel => [panel.panelId, panel.bytes]),
    )
    const missing = args.panelSpecs.filter(panel => !panelsById.has(panel.panelId)).map(panel => panel.panelId)
    const comparisonIssues = args.panelSpecs.flatMap(panel => {
        const assessment = args.assessments?.get(panel.panelId)

        if (!panelsById.has(panel.panelId))
            return []

        if (!assessment)
            return args.final ? [`${panel.title}: comparison unavailable`] : []

        if (assessment.dimensions.length === 0)
            return [`${panel.title}: comparison unavailable`]

        if (assessment.failedDimensions.length === 0)
            return []

        return [`${panel.title}: ${assessment.failedDimensions.join(', ')}`]
    })
    const unavailablePanelIds = args.unavailablePanelIds ?? new Set<string>()
    const issues = [
        ...(args.additionalIssues ?? []),
        ...missing.filter(panelId => args.final || unavailablePanelIds.has(panelId)).map(panelId => `${panelId}: unavailable`),
        ...comparisonIssues,
    ]
    const sourceCoverageNote = buildCharacterSourceCoverageNote(args.evidence)
    const base = await sharp({
        create: {
            width: layout.width,
            height: layout.height,
            channels: 3,
            background: '#ffffff',
        },
    }).png().toBuffer()
    const composites: {
        input: Buffer
        left: number
        top: number
    }[] = []

    for (const cell of layout.cells) {
        const input = panelsById.get(cell.sourcePanelId)

        if (!input)
            continue

        const panel = args.panelSpecs.find(candidate => candidate.panelId === cell.sourcePanelId)

        if (!panel)
            continue

        const normalized = await normalizePanelForCell(
            input,
            cell.width,
            cell.height,
            panel.crop,
        )
        composites.push({
            input: normalized,
            left: cell.x,
            top: cell.y,
        })
    }

    const bytes = await sharp(base)
        .composite(composites)
        .removeAlpha()
        .toColourspace('srgb')
        .png({
            compressionLevel: 9,
            adaptiveFiltering: false,
            palette: false,
        })
        .toBuffer()
    const metadata = await sharp(bytes).metadata()

    if (
        metadata.format !== 'png'
        || metadata.width !== 3840
        || metadata.height !== 2560
    )
        throw new Error('CHARACTER_SHEET_COMPOSITION_INVALID')

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
    crop: CharacterPanelSpec['crop'],
): Promise<Buffer> => {
    try {
        const metadata = await sharp(bytes).metadata()

        if (
            !metadata.width
            || !metadata.height
        )
            throw new Error('dimensions missing')

        const horizontalPaddingRatio = crop === 'prop' ? 0.07 : 0.04
        const verticalPaddingRatio = crop === 'full-body'
            || crop === 'action'
            ? 0.035
            : 0.04
        const horizontalPadding = Math.max(
            1,
            Math.round(width * horizontalPaddingRatio),
        )
        const verticalPadding = Math.max(
            1,
            Math.round(height * verticalPaddingRatio),
        )
        const contentWidth = width - horizontalPadding * 2
        const contentHeight = height - verticalPadding * 2
        const normalized = await sharp(bytes)
            .rotate()
            .flatten({ background: '#ffffff' })
            .trim({
                background: '#ffffff',
                threshold: 12,
            })
            .resize({
                width: contentWidth,
                height: contentHeight,
                fit: 'contain',
                position: 'centre',
                background: '#ffffff',
                kernel: 'lanczos3',
            })
            .removeAlpha()
            .toColourspace('srgb')
            .png({
                compressionLevel: 9,
                adaptiveFiltering: false,
                palette: false,
            })
            .toBuffer()

        return await sharp(normalized)
            .extend({
                top: verticalPadding,
                bottom: height - contentHeight - verticalPadding,
                left: horizontalPadding,
                right: width - contentWidth - horizontalPadding,
                background: '#ffffff',
            })
            .png({
                compressionLevel: 9,
                adaptiveFiltering: false,
                palette: false,
            })
            .toBuffer()
    } catch (error) {
        throw new Error(`CHARACTER_SHEET_PANEL_CORRUPT:${(error as Error).message}`)
    }
}
