import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

function extractFlatRule(source: string, selector: string): string {
    const start = source.indexOf(`${selector} {`)
    const end = source.indexOf('\n}', start)
    if (start === -1 || end === -1) throw new Error(`Missing flat SCSS rule: ${selector}`)
    return source.slice(start, end)
}

function expectRuleToContain(rule: string, snippet: string, selector: string): void {
    expect(
        rule.includes(snippet),
        `${selector} should contain:\n${snippet}`,
    ).toBe(true)
}

describe('context-preview.scss', () => {
    const scss = readFileSync(resolve(__dirname, 'context-preview.scss'), 'utf-8')

    it('keeps inline reference triggers compact instead of thumbnail-sized', () => {
        const rootRule = extractFlatRule(scss, '.context-preview-inline.context-preview-inline-label')
        const triggerRule = extractFlatRule(scss, '.context-preview-inline-label .context-preview-inline-trigger')

        expectRuleToContain(rootRule, 'width: auto;', '.context-preview-inline.context-preview-inline-label')
        expectRuleToContain(rootRule, 'height: auto;', '.context-preview-inline.context-preview-inline-label')
        expectRuleToContain(triggerRule, 'min-width: 0;', '.context-preview-inline-label .context-preview-inline-trigger')
        expectRuleToContain(triggerRule, 'max-width: none;', '.context-preview-inline-label .context-preview-inline-trigger')
        expectRuleToContain(triggerRule, 'overflow: visible;', '.context-preview-inline-label .context-preview-inline-trigger')
    })

    it('keeps canvas-inline popovers above local node chrome', () => {
        const popoverRule = extractFlatRule(scss, '.context-preview-inline-popover')
        const portaledRule = extractFlatRule(scss, '.context-preview-inline-popover-portaled')

        expectRuleToContain(popoverRule, 'position: absolute;', '.context-preview-inline-popover')
        expectRuleToContain(popoverRule, 'z-index: var(--help-tooltip-content-z-index, 10120);', '.context-preview-inline-popover')
        expectRuleToContain(portaledRule, 'z-index: var(--help-tooltip-content-z-index, 10120);', '.context-preview-inline-popover-portaled')
        expectRuleToContain(portaledRule, 'transform-origin: top left;', '.context-preview-inline-popover-portaled')
    })

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
