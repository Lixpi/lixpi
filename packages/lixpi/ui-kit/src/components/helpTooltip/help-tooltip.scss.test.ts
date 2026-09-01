// @vitest-environment happy-dom
import {
    describe,
    it,
    expect,
} from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function expectSourceToContain(source: string, snippet: string): void {
    expect(source.includes(snippet), `source should contain: ${snippet}`).toBe(true)
}

describe('help-tooltip.scss', () => {
    const scss = readFileSync(resolve(import.meta.dirname, 'help-tooltip.scss'), 'utf-8')

    it('defines root trigger geometry and interaction states', () => {
        expectSourceToContain(scss, '.help-tooltip')
        expectSourceToContain(scss, 'display: inline-flex;')
        expectSourceToContain(scss, '.help-tooltip-trigger')
        expectSourceToContain(scss, 'width: var(--help-tooltip-trigger-size')
        expectSourceToContain(scss, 'height: var(--help-tooltip-trigger-size')
        expectSourceToContain(scss, '.help-tooltip-trigger:hover')
    })

    it('defines tooltip content defaults, layering, and visibility states', () => {
        expectSourceToContain(scss, '.help-tooltip-content')
        expectSourceToContain(scss, 'position: fixed;')
        expectSourceToContain(scss, 'z-index: var(--help-tooltip-content-z-index, 10120);')
        expectSourceToContain(scss, 'width: var(--help-tooltip-width, max-content);')
        expectSourceToContain(scss, 'padding: var(--help-tooltip-padding, 5px 9px);')
        expectSourceToContain(scss, 'font-size: var(--help-tooltip-font-size, 13px);')
        expectSourceToContain(scss, 'visibility: hidden;')
        expectSourceToContain(scss, 'pointer-events: none;')
        expectSourceToContain(scss, '.help-tooltip-content.is-visible')
        expectSourceToContain(scss, 'visibility: visible;')
    })

    it('uses a shared, placement-aware arrow that inherits the tooltip surface color', () => {
        expectSourceToContain(scss, '--help-tooltip-arrow-size: 6px;')
        expectSourceToContain(scss, '.help-tooltip-content[data-placement="top"]::before')
        expectSourceToContain(scss, '.help-tooltip-content[data-placement="bottom"]::before')
        expectSourceToContain(scss, '.help-tooltip-content[data-placement="left"]::before')
        expectSourceToContain(scss, '.help-tooltip-content[data-placement="right"]::before')
        expectSourceToContain(scss, 'var(--help-tooltip-arrow-surface-color)')
    })

    it('keeps interactive content behavior explicitly opt-in', () => {
        expectSourceToContain(scss, '.help-tooltip-content-interactive')
        expectSourceToContain(scss, 'pointer-events: auto;')
    })

    it('keeps the question-mark glyph inside the configurable trigger bounds', () => {
        expectSourceToContain(scss, '.help-tooltip-mark')
        expectSourceToContain(scss, 'width: 100%;')
        expectSourceToContain(scss, 'height: 100%;')
        expectSourceToContain(scss, 'width: var(--help-tooltip-icon-size, 12px);')
        expectSourceToContain(scss, 'height: var(--help-tooltip-icon-size, 12px);')
        expectSourceToContain(scss, 'max-width: 100%;')
        expectSourceToContain(scss, 'max-height: 100%;')
    })
})
