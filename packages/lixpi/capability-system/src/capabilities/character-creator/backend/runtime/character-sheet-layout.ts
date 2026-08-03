'use strict'

import { readFile } from 'node:fs/promises'

import {
    CHARACTER_SHEET_LAYOUT,
    CHARACTER_SHEET_LAYOUT_SVG_RESOURCE,
    type CharacterSheetLayout,
} from '../../shared/character-sheet-layout.ts'

export { CHARACTER_SHEET_LAYOUT, type CharacterSheetLayout }

export async function renderCharacterSheetLayoutSvg(args: {
    evidenceNotes: string[]
    sourceCoverageNote: string
    palette: readonly string[]
}): Promise<Buffer> {
    const cells = CHARACTER_SHEET_LAYOUT.cells.map(cell => `
        <rect x="${cell.x}" y="${cell.y}" width="${cell.width}" height="${cell.height}" rx="12" fill="#ffffff" stroke="#bcc3cc" stroke-width="3"/>
        ${renderBitmapText(cell.cellId, cell.x + 14, cell.y + 10, 2, '#313944')}
    `).join('')
    const swatches = args.palette.slice(0, 8).map((color, index) => `
        <rect x="${2460 + index * 138}" y="2388" width="112" height="84" rx="10" fill="${safeColor(color)}" stroke="#313944" stroke-width="3"/>
    `).join('')
    const noteLines = wrapText([...args.evidenceNotes, args.sourceCoverageNote].join(' · '), 84).slice(0, 5)
        .map((line, index) => renderBitmapText(line, 2180, 1515 + index * 34, 3, '#313944'))
        .join('')

    const generatedContent = `
        ${renderBitmapText('CHARACTER DESCRIPTION SHEET', 48, 42, 7, '#171b22')}
        ${renderBitmapText('PANEL-FIRST GENERATED VIEWS - DETERMINISTIC LAYOUT', 48, 108, 3, '#586273')}
        <g>${cells}</g>
        <rect x="2148" y="1458" width="1644" height="430" rx="16" fill="#ffffff" stroke="#bcc3cc" stroke-width="3"/>
        ${renderBitmapText('COSTUME, MATERIALS, DETAILS, AND SOURCE COVERAGE', 2180, 1478, 3, '#171b22')}
        <g>${noteLines}</g>
        ${renderBitmapText('PALETTE', 2180, 2338, 4, '#171b22')}
        ${swatches}
    `
    const template = await readFile(CHARACTER_SHEET_LAYOUT_SVG_RESOURCE, 'utf8')
    if (!template.includes('<!-- CHARACTER_SHEET_GENERATED_CONTENT -->')) {
        throw new Error('CHARACTER_SHEET_LAYOUT_RESOURCE_INVALID')
    }
    return Buffer.from(template.replace('<!-- CHARACTER_SHEET_GENERATED_CONTENT -->', generatedContent))
}

const wrapText = (value: string, maxLength: number): string[] => {
    const words = value.split(/\s+/u)
    const lines: string[] = []
    let line = ''
    for (const word of words) {
        const next = line ? `${line} ${word}` : word
        if (next.length > maxLength && line) {
            lines.push(line)
            line = word
        } else {
            line = next
        }
    }
    if (line) lines.push(line)
    return lines
}

const safeColor = (value: string): string => /^#[0-9a-f]{6}$/iu.test(value) ? value : '#d7dbe1'

const BITMAP_GLYPHS: Readonly<Record<string, readonly string[]>> = {
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
    H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
    K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
    X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
    Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
    Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
    '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
    '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
    '.': ['00000', '00000', '00000', '00000', '00000', '00110', '00110'],
    ',': ['00000', '00000', '00000', '00000', '00110', '00100', '01000'],
    ':': ['00000', '00110', '00110', '00000', '00110', '00110', '00000'],
    '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
}

const renderBitmapText = (value: string, x: number, y: number, scale: number, fill: string): string => {
    const paths: string[] = []
    let cursor = x
    for (const character of value.toLocaleUpperCase()) {
        const glyph = BITMAP_GLYPHS[character]
        if (glyph) {
            glyph.forEach((row, rowIndex) => {
                for (let column = 0; column < row.length; column += 1) {
                    if (row[column] === '1') paths.push(`M${cursor + column * scale} ${y + rowIndex * scale}h${scale}v${scale}h-${scale}z`)
                }
            })
        }
        cursor += scale * 6
    }
    return `<path d="${paths.join('')}" fill="${fill}"/>`
}
