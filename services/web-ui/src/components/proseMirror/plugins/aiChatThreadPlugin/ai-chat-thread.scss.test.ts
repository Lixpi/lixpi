import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function expectSourceToContain(source: string, snippet: string): void {
    expect(source.includes(snippet), `source should contain: ${snippet}`).toBe(true)
}

function getCustomPropertyValue(source: string, selector: string, propertyName: string): string | undefined {
    let searchStart = 0

    while (searchStart < source.length) {
        const ruleStart = source.indexOf(selector, searchStart)
        if (ruleStart < 0) return undefined

        const ruleEnd = source.indexOf('}', ruleStart)
        if (ruleEnd < 0) return undefined

        const rule = source.slice(ruleStart, ruleEnd)
        const propertyMatch = rule.match(new RegExp(`${propertyName}:\\s*([^;]+);`))
        if (propertyMatch?.[1]) return propertyMatch[1].trim()

        searchStart = ruleEnd + 1
    }

    return undefined
}

describe('ai-chat-thread.scss', () => {
    const scss = readFileSync(resolve(__dirname, 'ai-chat-thread.scss'), 'utf-8')

    it('defines thread and user message wrapper primitives', () => {
        expectSourceToContain(scss, '.ai-chat-thread-wrapper')
        expectSourceToContain(scss, '.ai-user-message-wrapper')
        expectSourceToContain(scss, '.ai-user-message')
        expectSourceToContain(scss, '--prompt-reference-color: #d7e6ff;')
        expectSourceToContain(scss, '--prompt-reference-capability-module-color: #eca983;')
        expectSourceToContain(scss, '.ai-submit-button')
    })

    it('uses the branch-marker reference palette for historical user messages', () => {
        const workspaceScss = readFileSync(
            resolve(__dirname, '../../../../infographics/workspace/workspace-canvas.scss'),
            'utf-8',
        )

        expect(getCustomPropertyValue(scss, '.ai-user-message {', '--prompt-reference-color')).toBe(
            getCustomPropertyValue(
                workspaceScss,
                '.workspace-branch-marker-message-text {',
                '--prompt-reference-color',
            ),
        )
        expect(getCustomPropertyValue(scss, '.ai-user-message {', '--prompt-reference-capability-module-color')).toBe(
            getCustomPropertyValue(
                workspaceScss,
                '.workspace-branch-marker-message-text {',
                '--prompt-reference-capability-module-color',
            ),
        )
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
