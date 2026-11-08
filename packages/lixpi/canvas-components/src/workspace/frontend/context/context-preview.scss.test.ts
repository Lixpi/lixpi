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

const expectRuleToContain = (rule: string, snippet: string, selector: string): void => {
    expect(
        withoutLayout(rule).includes(withoutLayout(snippet)),
        `${selector} should contain:\n${snippet}`,
    ).toBe(true)
}

describe('context-preview.scss', () => {
    const stylesheetPath = resolve(import.meta.dirname, 'context-preview.scss')
    const scss = readFileSync(stylesheetPath, 'utf-8')
    // Typography comes from theme tokens, so it is read from what the default
    // theme renders rather than from the source text.
    let css = ''

    beforeAll(async () => void (css = await compileThemedStylesheet(stylesheetPath)))

    it('keeps capability description cards wide with media-preview typography', () => {
        const popoverRule = extractFlatRule(scss, '.capability-description-popover')
        const cardRule = extractFlatRule(css, '.capability-description-card')
        const titleRule = extractFlatRule(css, '.capability-description-card h2')
        const sectionTitleRule = extractFlatRule(css, '.capability-description-card h3')

        expectRuleToContain(popoverRule, 'width: min(520px, calc(100vw - 24px));', '.capability-description-popover')
        expectRuleToContain(popoverRule, 'max-width: min(520px, calc(100vw - 24px));', '.capability-description-popover')
        expectRuleToContain(popoverRule, 'max-height: min(560px, var(--help-tooltip-available-max-height', '.capability-description-popover')
        expectRuleToContain(cardRule, 'font-size: 11px;', '.capability-description-card')
        expectRuleToContain(cardRule, 'font-weight: 500;', '.capability-description-card')
        expectRuleToContain(cardRule, 'line-height: 1.3;', '.capability-description-card')
        expectRuleToContain(titleRule, 'font-size: 12px;', '.capability-description-card h2')
        expectRuleToContain(titleRule, 'font-weight: var(--canvas-title-font-weight, 700);', '.capability-description-card h2')
        expectRuleToContain(titleRule, 'line-height: 1.25;', '.capability-description-card h2')
        expectRuleToContain(sectionTitleRule, 'font-size: 11px;', '.capability-description-card h3')
        expectRuleToContain(sectionTitleRule, 'font-weight: var(--canvas-title-font-weight, 700);', '.capability-description-card h3')
        expectRuleToContain(sectionTitleRule, 'line-height: 1.25;', '.capability-description-card h3')
    })
})
