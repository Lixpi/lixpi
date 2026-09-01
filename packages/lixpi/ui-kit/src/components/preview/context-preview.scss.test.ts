import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
    describe,
    expect,
    it,
} from 'vitest'

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
    const scss = readFileSync(resolve(import.meta.dirname, 'context-preview.scss'), 'utf-8')

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
})
