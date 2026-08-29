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

    it('keeps the embedded image/video fallback compact and leaves model trigger content to its summary', () => {
        expectSourceToContain(scss, '.ai-prompt-media-mode-switch')
        expectSourceToContain(scss, 'width: 76px;')
        expectSourceToContain(scss, 'height: 40px;')
        expectSourceToContain(scss, '.ai-prompt-media-mode-switch-svg')
        expectSourceToContain(scss, '.ai-prompt-model-menu-trigger-summary')
        expectSourceNotToContain(scss, '.ai-prompt-model-menu-trigger-leading')
        expectSourceNotToContain(scss, '.ai-prompt-model-menu-trigger-icon')
        expectSourceNotToContain(scss, '.ai-prompt-model-menu-trigger-mode')
    })

    it('lays out model and inline configuration fields in one aligned row', () => {
        expectSourceToContain(scss, '.ai-model-config-primary-row')
        expectSourceToContain(scss, 'flex-wrap: nowrap;')
        expectSourceToContain(scss, '.ai-model-config-model-column {')
        expectSourceToContain(scss, `.ai-model-config-inline-control {
    display: flex;
    min-width: max-content;
    flex: 0 0 auto;
    justify-content: flex-start;
}`)
        expectSourceToContain(scss, 'width: max-content;')
        expectSourceNotToContain(scss, '.ai-model-config-inline-control .ai-prompt-model-menu-control-label')
        expectSourceNotToContain(scss, '.ai-model-config-inline-control .ai-media-config-control-field')
    })

    it('caps the model settings surface and scrolls only that surface when content exceeds the viewport space', () => {
        expectSourceToContain(scss, '.ai-prompt-model-menu-info-bubble .bubble-menu-content')
        expectSourceToContain(scss, '--ai-prompt-model-menu-info-bubble-max-height')
        expectSourceToContain(scss, 'overflow-y: auto;')
        expectSourceToContain(scss, 'overscroll-behavior: contain;')
    })

    it('renders each media configuration group as one vertical column and keeps video choices in one row', () => {
        expectSourceToContain(scss, '.ai-model-config-controls')
        expectSourceToContain(scss, 'flex-direction: column;')
        expectSourceToContain(scss, '.ai-media-config-control')
        expectSourceToContain(scss, 'grid-template-columns: minmax(0, 1fr);')
        expectSourceToContain(scss, '.ai-media-config-matrix[data-media-type="video"] .ai-model-config-controls')
        expectSourceToContain(scss, 'grid-template-columns: repeat(3, minmax(0, 1fr));')
        expectSourceToContain(scss, '.ai-media-config-group + .ai-media-config-group::before')
        expectSourceToContain(scss, '--ai-prompt-model-menu-section-divider-gradient')
    })

    it('puts video toggle switches below their label and keeps the tooltip label aligned', () => {
        expectSourceToContain(scss, '.ai-media-config-control[data-control-kind="toggle"] .ai-media-config-control-field')
        expectSourceToContain(scss, 'padding-left: var(--ai-prompt-model-menu-control-label-inset, 7px);')
        expectSourceToContain(scss, '.ai-media-config-control-label')
        expectSourceToContain(scss, 'align-self: flex-start;')
        expectSourceToContain(scss, '.ai-media-config-toggle-svg-host')
        expectSourceToContain(scss, 'border: none;')
        expectSourceToContain(scss, 'background: transparent;')
        expectSourceNotToContain(scss, '.ai-media-config-toggle-track')
    })
})
