import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

function extractFlatRule(source: string, selector: string): string {
    const start = source.indexOf(`${selector} {`)
    const end = source.indexOf('\n}', start)
    if (start === -1 || end === -1) throw new Error(`Missing flat SCSS rule: ${selector}`)
    return source.slice(start, end)
}

function expectRuleToContain(rule: string, declaration: string): void {
    expect(rule.includes(declaration), `rule should contain: ${declaration}`).toBe(true)
}

function expectRuleNotToContain(rule: string, declaration: string): void {
    expect(rule.includes(declaration), `rule should not contain: ${declaration}`).toBe(false)
}

describe('prompt-reference-picker.scss', () => {
    const scss = readFileSync(resolve(__dirname, 'prompt-reference-picker.scss'), 'utf-8')

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
        expectRuleToContain(chipRule, 'font-size: 0.9375em;')
        expectRuleToContain(chipRule, 'line-height: 1;')
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

        expectRuleToContain(chipRule, 'color: #3d649c;')
        expectRuleToContain(iconRule, 'align-self: center;')
        expectRuleToContain(iconRule, 'flex: 0 0 14px;')
        expectRuleToContain(iconRule, 'width: 14px;')
        expectRuleToContain(iconRule, 'height: 14px;')
        expectRuleToContain(iconSvgRule, 'fill: currentColor;')
        expectRuleToContain(nameRule, 'font-weight: 500;')
        expectRuleToContain(nameRule, 'line-height: 1;')
        expectRuleToContain(capabilityRule, 'color: var(--prompt-reference-capability-module-color, #a55324);')
        expectRuleToContain(toolRule, 'color: #39766f;')
        expectRuleToContain(skillRule, 'color: #6d4fb2;')
    })
})
