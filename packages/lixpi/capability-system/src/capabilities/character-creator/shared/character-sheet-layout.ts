import {
    type CharacterPanelSpec,
} from './character-sheet-media-plan.ts'

export type CharacterSheetLayoutCell = {
    cellId: string
    sourcePanelId: string
    x: number
    y: number
    width: number
    height: number
    fit: 'contain'
}

export type CharacterSheetLayout = {
    layoutId: 'character-sheet-3840x2560'
    width: 3840
    height: 2560
    cells: CharacterSheetLayoutCell[]
}

const SHEET_WIDTH = 3840
const SHEET_HEIGHT = 2560
const SHEET_MARGIN = 32
const CELL_GAP = 24

export const buildCharacterSheetLayout = (panels: readonly CharacterPanelSpec[]): CharacterSheetLayout => {
    if (panels.length < 1)
        throw new Error('CHARACTER_SHEET_LAYOUT_PANELS_REQUIRED')

    const columns = panels.length <= 6 ? 3 : 5
    const rows = Math.ceil(panels.length / columns)
    const width = Math.floor((SHEET_WIDTH - SHEET_MARGIN * 2 - CELL_GAP * (columns - 1)) / columns)
    const height = Math.floor((SHEET_HEIGHT - SHEET_MARGIN * 2 - CELL_GAP * (rows - 1)) / rows)
    const cells = panels.map((panel, index): CharacterSheetLayoutCell => {
        const column = index % columns
        const row = Math.floor(index / columns)

        return {
            cellId: `shot-${index + 1}`,
            sourcePanelId: panel.panelId,
            x: SHEET_MARGIN + column * (width + CELL_GAP),
            y: SHEET_MARGIN + row * (height + CELL_GAP),
            width,
            height,
            fit: 'contain',
        }
    })

    return {
        layoutId: 'character-sheet-3840x2560',
        width: SHEET_WIDTH,
        height: SHEET_HEIGHT,
        cells,
    }
}
