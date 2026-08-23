import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function expectSourceToContain(source: string, snippet: string): void {
    expect(source.includes(snippet), `source should contain: ${snippet}`).toBe(true)
}

function expectSourceNotToContain(source: string, snippet: string): void {
    expect(source.includes(snippet), `source should not contain: ${snippet}`).toBe(false)
}

describe('ai-prompt-input.scss', () => {
    const scss = readFileSync(resolve(__dirname, 'ai-prompt-input.scss'), 'utf-8')

    it('defines floating input host and wrapper states', () => {
        expectSourceToContain(scss, '.ai-prompt-input-floating')
        expectSourceToContain(scss, '.floating-input-editor')
        expectSourceToContain(scss, '.ai-prompt-input-wrapper')
        expectSourceToContain(scss, '.ai-prompt-input-content')
        expectSourceToContain(scss, '.ai-prompt-input-controls')
        expectSourceToContain(scss, '.ai-submit-button')
    })

    it('includes model-menu control surface hooks', () => {
        expectSourceToContain(scss, '.ai-prompt-model-menu-trigger')
        expectSourceToContain(scss, '.ai-prompt-model-menu-info-bubble')
        expectSourceToContain(scss, '.ai-prompt-model-menu-content')
        expectSourceToContain(scss, '.ai-prompt-model-menu-section')
        expectSourceToContain(scss, '.ai-prompt-model-menu-control-label')
    })

    it('covers selected model tag row styling', () => {
        expectSourceToContain(scss, '.ai-prompt-selected-model-tags-row')
        expectSourceToContain(scss, '.ai-prompt-selected-model-tag')
        expectSourceToContain(scss, '.ai-prompt-selected-model-tag-svg')
    })

    it('caps the model settings surface and scrolls only that surface when content exceeds the viewport space', () => {
        expectSourceToContain(scss, '.ai-prompt-model-menu-info-bubble .bubble-menu-content')
        expectSourceToContain(scss, '--ai-prompt-model-menu-info-bubble-max-height')
        expectSourceToContain(scss, 'overflow-y: auto;')
        expectSourceToContain(scss, 'overscroll-behavior: contain;')
    })

    it('renders each media configuration group as one vertical column with the shared gradient separator', () => {
        expectSourceToContain(scss, '.ai-media-config-group-row')
        expectSourceToContain(scss, 'flex-direction: column;')
        expectSourceToContain(scss, '.ai-media-config-group-controls')
        expectSourceToContain(scss, 'grid-template-columns: minmax(0, 1fr);')
        expectSourceToContain(scss, '.ai-media-config-group + .ai-media-config-group::before')
        expectSourceToContain(scss, '--ai-prompt-model-menu-section-divider-gradient')
    })

    it('keeps media toggle controls inline and removes the redundant state label and track wrapper', () => {
        expectSourceToContain(scss, '.ai-media-config-toggle-text')
        expectSourceToContain(scss, '.ai-media-config-toggle-svg-host')
        expectSourceToContain(scss, 'border: none;')
        expectSourceToContain(scss, 'background: transparent;')
        expectSourceNotToContain(scss, '.ai-media-config-toggle-track')
        expectSourceNotToContain(scss, '.ai-media-config-toggle-label')
    })
})
