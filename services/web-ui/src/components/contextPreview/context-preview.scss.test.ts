import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

function extractFlatRule(source: string, selector: string): string {
    const start = source.indexOf(`${selector} {`)
    const end = source.indexOf('\n}', start)
    if (start === -1 || end === -1) throw new Error(`Missing flat SCSS rule: ${selector}`)
    return source.slice(start, end)
}

describe('context-preview.scss', () => {
    const scss = readFileSync(resolve(__dirname, 'context-preview.scss'), 'utf-8')

    it('keeps inline reference triggers compact instead of thumbnail-sized', () => {
        const rootRule = extractFlatRule(scss, '.context-preview-inline.context-preview-inline-label')
        const triggerRule = extractFlatRule(scss, '.context-preview-inline-label .context-preview-inline-trigger')

        expect(rootRule).toContain('width: auto;')
        expect(rootRule).toContain('height: auto;')
        expect(triggerRule).toContain('min-width: 0;')
        expect(triggerRule).toContain('max-width: none;')
        expect(triggerRule).toContain('overflow: visible;')
    })

    it('keeps canvas-inline popovers above local node chrome', () => {
        const popoverRule = extractFlatRule(scss, '.context-preview-inline-popover')
        const portaledRule = extractFlatRule(scss, '.context-preview-inline-popover-portaled')

        expect(popoverRule).toContain('position: absolute;')
        expect(popoverRule).toContain('z-index: var(--help-tooltip-content-z-index, 10120);')
        expect(portaledRule).toContain('z-index: var(--help-tooltip-content-z-index, 10120);')
        expect(portaledRule).toContain('transform-origin: top left;')
    })
})
