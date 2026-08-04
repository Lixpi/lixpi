'use strict'

import type { CharacterPanelSpec } from './character-sheet-media-plan.ts'

export type CharacterSheetLayoutCell = {
    cellId: string
    sourcePanelId: string
    title: string
    x: number
    y: number
    width: number
    height: number
    fit: 'contain' | 'cover'
}

export type CharacterSheetLayout = {
    layoutId: 'character-sheet-3840x2560'
    width: 3840
    height: 2560
    cells: CharacterSheetLayoutCell[]
}

export const CHARACTER_SHEET_LAYOUT_SVG_RESOURCE = new URL('./resources/character-sheet-layout.svg', import.meta.url)

const SHEET_WIDTH = 3840
const SHEET_HEIGHT = 2560
const HORIZONTAL_MARGIN = 48
const GRID_TOP = 150
const GRID_BOTTOM = 2220
const CELL_GAP = 28

export function buildCharacterSheetLayout(panels: readonly CharacterPanelSpec[]): CharacterSheetLayout {
    if (panels.length < 1) throw new Error('CHARACTER_SHEET_LAYOUT_PANELS_REQUIRED')
    const columns = panels.length <= 3 ? 3 : panels.length <= 6 ? 3 : 5
    const rows = Math.ceil(panels.length / columns)
    const width = Math.floor((SHEET_WIDTH - HORIZONTAL_MARGIN * 2 - CELL_GAP * (columns - 1)) / columns)
    const height = Math.floor((GRID_BOTTOM - GRID_TOP - CELL_GAP * (rows - 1)) / rows)
    const cells = panels.map((panel, index): CharacterSheetLayoutCell => {
        const column = index % columns
        const row = Math.floor(index / columns)
        return {
            cellId: `shot-${index + 1}`,
            sourcePanelId: panel.panelId,
            title: panel.title,
            x: HORIZONTAL_MARGIN + column * (width + CELL_GAP),
            y: GRID_TOP + row * (height + CELL_GAP),
            width,
            height,
            fit: panel.crop === 'full-body' || panel.crop === 'action' || panel.crop === 'prop'
                ? 'contain'
                : 'cover',
        }
    })
    return {
        layoutId: 'character-sheet-3840x2560',
        width: SHEET_WIDTH,
        height: SHEET_HEIGHT,
        cells,
    }
}
