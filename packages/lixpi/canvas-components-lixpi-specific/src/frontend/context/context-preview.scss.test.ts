import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
    describe,
    expect,
    it,
} from 'vitest'
import { withoutLayout } from '@lixpi/test-utils'

function extractFlatRule(source: string, selector: string): string {
    const start = source.indexOf(`${selector} {`)
    const end = source.indexOf('\n}', start)
    if (start === -1 || end === -1) throw new Error(`Missing flat SCSS rule: ${selector}`)
    return source.slice(start, end)
}

function expectRuleToContain(rule: string, snippet: string, selector: string): void {
    expect(
        withoutLayout(rule).includes(withoutLayout(snippet)),
        `${selector} should contain:\n${snippet}`,
    ).toBe(true)
}

describe('context-preview.scss', () => {
    const scss = readFileSync(resolve(import.meta.dirname, 'context-preview.scss'), 'utf-8')

    it('keeps capability description cards wide with media-preview typography', () => {
        const popoverRule = extractFlatRule(scss, '.capability-description-popover')
        const cardRule = extractFlatRule(scss, '.capability-description-card')
        const titleRule = extractFlatRule(scss, '.capability-description-card h2')
        const sectionTitleRule = extractFlatRule(scss, '.capability-description-card h3')

        expectRuleToContain(popoverRule, 'width: min(520px, calc(100vw - 24px));', '.capability-description-popover')
        expectRuleToContain(popoverRule, 'max-width: min(520px, calc(100vw - 24px));', '.capability-description-popover')
        expectRuleToContain(popoverRule, 'max-height: min(560px, var(--help-tooltip-available-max-height', '.capability-description-popover')
        expectRuleToContain(cardRule, 'font-size: 11px;', '.capability-description-card')
        expectRuleToContain(cardRule, 'font-weight: 500;', '.capability-description-card')
        expectRuleToContain(cardRule, 'line-height: 1.3;', '.capability-description-card')
        expectRuleToContain(titleRule, 'font-size: 12px;', '.capability-description-card h2')
        expectRuleToContain(titleRule, 'font-weight: 700;', '.capability-description-card h2')
        expectRuleToContain(titleRule, 'line-height: 1.25;', '.capability-description-card h2')
        expectRuleToContain(sectionTitleRule, 'font-size: 11px;', '.capability-description-card h3')
        expectRuleToContain(sectionTitleRule, 'font-weight: 700;', '.capability-description-card h3')
        expectRuleToContain(sectionTitleRule, 'line-height: 1.25;', '.capability-description-card h3')
    })
})
