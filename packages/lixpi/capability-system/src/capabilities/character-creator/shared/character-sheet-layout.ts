'use strict'

export type CharacterSheetLayoutCell = {
    cellId: string
    sourcePanelId: string
    x: number
    y: number
    width: number
    height: number
    fit: 'contain' | 'cover'
    derivedCrop?: 'eyes' | 'mouth' | 'feet' | 'prop'
}

export type CharacterSheetLayout = {
    layoutId: 'character-sheet-3840x2560'
    width: 3840
    height: 2560
    cells: CharacterSheetLayoutCell[]
}

export const CHARACTER_SHEET_LAYOUT_SVG_RESOURCE = new URL('./resources/character-sheet-layout.svg', import.meta.url)

const row = (args: {
    cellPrefix: string
    panelIds: string[]
    x: number
    y: number
    width: number
    height: number
    gap: number
    fit?: 'contain' | 'cover'
    derivedCrop?: CharacterSheetLayoutCell['derivedCrop']
}): CharacterSheetLayoutCell[] => args.panelIds.map((sourcePanelId, index) => ({
    cellId: `${args.cellPrefix}-${index + 1}`,
    sourcePanelId,
    x: args.x + index * (args.width + args.gap),
    y: args.y,
    width: args.width,
    height: args.height,
    fit: args.fit ?? 'cover',
    ...(args.derivedCrop ? { derivedCrop: args.derivedCrop } : {}),
}))

const bodyIds = ['body-front', 'body-three-quarter-front-left', 'body-profile-left', 'body-three-quarter-back-left', 'body-back']
const headIds = ['head-front', 'head-three-quarter-front-left', 'head-profile-left', 'head-three-quarter-back-left', 'head-back']
const expressionIds = ['head-front', 'expression-smile', 'expression-anger', 'expression-sadness', 'expression-surprise']
const mouthIds = ['head-front', 'expression-smile', 'expression-anger', 'expression-sadness', 'expression-surprise', 'mouth-open', 'mouth-grin', 'mouth-pursed', 'mouth-shout']
const actionIds = ['action-walk', 'action-run', 'action-crouch', 'action-jump', 'action-reach', 'action-hero']

export const CHARACTER_SHEET_LAYOUT: CharacterSheetLayout = {
    layoutId: 'character-sheet-3840x2560',
    width: 3840,
    height: 2560,
    cells: [
        ...row({ cellPrefix: 'body', panelIds: bodyIds, x: 48, y: 150, width: 390, height: 920, gap: 28, fit: 'contain' }),
        ...row({ cellPrefix: 'head', panelIds: headIds, x: 2180, y: 150, width: 300, height: 360, gap: 24 }),
        ...row({ cellPrefix: 'expression', panelIds: expressionIds, x: 2180, y: 540, width: 300, height: 300, gap: 24 }),
        ...row({ cellPrefix: 'eye', panelIds: expressionIds, x: 2180, y: 870, width: 300, height: 120, gap: 24, derivedCrop: 'eyes' }),
        ...row({ cellPrefix: 'mouth', panelIds: mouthIds, x: 2180, y: 1020, width: 162, height: 120, gap: 18, derivedCrop: 'mouth' }),
        ...row({ cellPrefix: 'feet', panelIds: bodyIds, x: 48, y: 1100, width: 390, height: 190, gap: 28, derivedCrop: 'feet' }),
        ...row({ cellPrefix: 'hand', panelIds: ['hand-left', 'hand-right'], x: 2180, y: 1170, width: 360, height: 260, gap: 24 }),
        { cellId: 'prop', sourcePanelId: 'prop-primary', x: 2948, y: 1170, width: 700, height: 260, fit: 'contain', derivedCrop: 'prop' },
        ...row({ cellPrefix: 'action', panelIds: actionIds, x: 48, y: 1500, width: 594, height: 850, gap: 38, fit: 'contain' }),
    ],
}
