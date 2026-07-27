import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function expectSourceToContain(source: string, snippet: string): void {
    expect(source.includes(snippet), `source should contain: ${snippet}`).toBe(true)
}

describe('ai-chat-thread.scss', () => {
    const scss = readFileSync(resolve(__dirname, 'ai-chat-thread.scss'), 'utf-8')

    it('defines thread and user message wrapper primitives', () => {
        expectSourceToContain(scss, '.ai-chat-thread-wrapper')
        expectSourceToContain(scss, '.ai-user-message-wrapper')
        expectSourceToContain(scss, '.ai-user-message')
        expectSourceToContain(scss, '--prompt-reference-capability-module-color: #eca983;')
        expectSourceToContain(scss, '.ai-submit-button')
    })

    it('covers response message and reasoning shell styles', () => {
        expectSourceToContain(scss, '.ai-response-message-wrapper')
        expectSourceToContain(scss, '.ai-response-message')
        expectSourceToContain(scss, '.ai-reasoning-section')
        expectSourceToContain(scss, '.ai-reasoning-section-spinner')
        expectSourceToContain(scss, '.is-empty')
        expectSourceToContain(scss, '.ai-response-message-content')
    })

    it('contains generated-image media shell styling hooks', () => {
        expectSourceToContain(scss, '.ai-generated-image-wrapper')
        expectSourceToContain(scss, '.ai-generated-image-container')
        expectSourceToContain(scss, '.ai-generated-image-content')
        expectSourceToContain(scss, '.ai-generated-image-prompt')
        expectSourceToContain(scss, '.ai-generated-media-run-pill')
    })
})
