import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function expectSourceToContain(source: string, snippet: string): void {
    expect(source.includes(snippet), `source should contain: ${snippet}`).toBe(true)
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
})
