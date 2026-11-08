import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest'
import {
    compileThemedStylesheet,
    withoutLayout,
} from '@lixpi/test-utils'

const extractFlatRule = (source: string, selector: string): string => {
    const start = source.indexOf(`${selector} {`)
    const end = source.indexOf('\n}', start)

    if (
        start === -1
        || end === -1
    )
        throw new Error(`Missing flat SCSS rule: ${selector}`)

    return source.slice(start, end)
}

const expectRuleToContain = (rule: string, declaration: string): void => void expect(withoutLayout(rule).includes(withoutLayout(declaration)), `rule should contain: ${declaration}`).toBe(true)

const expectRuleNotToContain = (rule: string, declaration: string): void => void expect(withoutLayout(rule).includes(withoutLayout(declaration)), `rule should not contain: ${declaration}`).toBe(false)

const expectSourceToContain = (source: string, snippet: string, label = 'source excerpt'): void => void expect(withoutLayout(source).includes(withoutLayout(snippet)), `${label} should contain:\n${snippet}`).toBe(true)

describe('prompt-reference-picker.scss', () => {
    const composerDirectory = resolve(import.meta.dirname, '../../../../../packages/lixpi/canvas-components/src/workspace/frontend/composer')
    const scss = readFileSync(resolve(composerDirectory, 'prompt-reference-picker.scss'), 'utf-8')
    // Typography and chip colors come from theme tokens, so value checks read
    // what the default theme renders. The source keeps the structural checks.
    let css = ''
    let darkSurfaceCss = ''

    beforeAll(async () => {
        css = await compileThemedStylesheet(resolve(composerDirectory, 'prompt-reference-picker.scss'))
        darkSurfaceCss = await compileThemedStylesheet(resolve(composerDirectory, 'chat-thread.scss'))
    })

    it('uses the default app and browser scrollbar appearance', () => {
        const pickerRule = extractFlatRule(scss, '.prompt-reference-picker')

        expectRuleNotToContain(pickerRule, 'scrollbar-color:')
        expectRuleNotToContain(scss, '::-webkit-scrollbar')
    })

    it('keeps navigation fixed while only the results list scrolls', () => {
        const pickerRule = extractFlatRule(scss, '.prompt-reference-picker')
        const headerRule = extractFlatRule(scss, '.prompt-reference-picker-header')
        const listRule = extractFlatRule(scss, '.prompt-reference-picker-list')

        expectRuleToContain(pickerRule, 'display: flex;')
        expectRuleToContain(pickerRule, 'flex-direction: column;')
        expectRuleToContain(pickerRule, 'overflow: hidden;')
        expectRuleNotToContain(pickerRule, 'overflow-y: auto;')
        expectRuleToContain(headerRule, 'flex: 0 0 auto;')
        expectRuleNotToContain(headerRule, 'position: sticky;')
        expectRuleToContain(listRule, 'flex: 1 1 auto;')
        expectRuleToContain(listRule, 'min-height: 0;')
        expectRuleToContain(listRule, 'overflow-y: auto;')
        expectRuleToContain(listRule, 'overscroll-behavior: contain;')
    })

    it('renders references as borderless inline icon labels', () => {
        const chipRule = extractFlatRule(scss, '.prompt-reference-chip')

        const contentRule = extractFlatRule(scss, '.prompt-reference-chip-content')

        expectRuleToContain(chipRule, 'gap: 0;')
        expectRuleToContain(contentRule, 'gap: 2px;')
        expectRuleToContain(contentRule, 'align-items: baseline;')
        expectRuleToContain(chipRule, 'align-items: baseline;')
        expectRuleToContain(chipRule, 'padding: 0;')
        expectRuleToContain(chipRule, 'border: 0;')
        expectRuleToContain(chipRule, 'background: transparent;')
        expectRuleToContain(chipRule, 'font-size: inherit;')
        expectRuleToContain(extractFlatRule(css, '.prompt-reference-chip'), 'line-height: 1;')
        expectRuleToContain(chipRule, 'vertical-align: baseline;')
        expectRuleNotToContain(chipRule, 'border-radius:')
        expectRuleNotToContain(chipRule, 'height: 20px;')
    })

    it('centers a compact existing SVG icon and uses color with a semibold name', () => {
        const chipRule = extractFlatRule(scss, '.prompt-reference-chip')
        const iconRule = extractFlatRule(scss, '.prompt-reference-chip-icon')
        const iconSvgRule = extractFlatRule(scss, '.prompt-reference-chip-icon svg')
        const nameRule = extractFlatRule(scss, '.prompt-reference-chip-name')
        const capabilityRule = extractFlatRule(scss, '.prompt-reference-chip-capability-module')
        const toolRule = extractFlatRule(scss, '.prompt-reference-chip-tool')
        const skillRule = extractFlatRule(scss, '.prompt-reference-chip-skill')

        expectRuleToContain(chipRule, 'color: var(--prompt-reference-color);')
        expectRuleToContain(iconRule, 'align-self: center;')
        expectRuleToContain(iconRule, 'flex: 0 0 14px;')
        expectRuleToContain(iconRule, 'width: 14px;')
        expectRuleToContain(iconRule, 'height: 14px;')
        expectRuleToContain(iconSvgRule, 'fill: currentColor;')
        expectRuleToContain(extractFlatRule(css, '.prompt-reference-chip-name'), 'font-weight: 500;')
        expectRuleToContain(nameRule, 'line-height: inherit;')
        expectRuleToContain(capabilityRule, 'color: var(--prompt-reference-capability-module-color);')
        expectRuleToContain(toolRule, 'color: var(--prompt-reference-tool-color);')
        expectRuleToContain(skillRule, 'color: var(--prompt-reference-skill-color);')
    })

    // Chip color has exactly one owner. Every surface reads these custom
    // properties; no stylesheet may restate a chip color literal of its own.
    it('reads its palette from the shared partial and emits the light defaults once', () => {
        expectSourceToContain(scss, '@import "./prompt-reference-colors";')
        expectSourceToContain(scss, '@include prompt-reference-chip-on-light-surface;')

        // The light palette renders in the picker and the dark one in the chat
        // thread, both from the shared partial.
        const partial = `${css}\n${darkSurfaceCss}`

        for (
            const declaration of [
                '--prompt-reference-color: #3d649c;',
                '--prompt-reference-capability-module-color: #a55324;',
                '--prompt-reference-tool-color: #39766f;',
                '--prompt-reference-skill-color: #6d4fb2;',
                '--prompt-reference-color: #d7e6ff;',
                '--prompt-reference-capability-module-color: #eca983;',
            ]
        ) {
            expectSourceToContain(partial, declaration, 'prompt-reference chip palette')
        }
    })
})
