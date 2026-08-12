import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function expectSourceToContain(source: string, snippet: string): void {
    expect(source.includes(snippet), `source should contain: ${snippet}`).toBe(true)
}

function getPropertyValue(source: string, selector: string, propertyName: string): string | undefined {
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

function getBraceBalancedBlock(source: string, selector: string): string {
    const selectorIndex = source.indexOf(selector)
    expect(selectorIndex, `source should contain selector: ${selector}`).toBeGreaterThanOrEqual(0)
    const openBraceIndex = source.indexOf('{', selectorIndex)
    expect(openBraceIndex, `selector should open a block: ${selector}`).toBeGreaterThan(selectorIndex)

    let depth = 0
    for (let index = openBraceIndex; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1
        if (source[index] !== '}') continue
        depth -= 1
        if (depth === 0) return source.slice(selectorIndex, index + 1)
    }

    throw new Error(`selector block should close: ${selector}`)
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

        expect(getPropertyValue(scss, '.ai-user-message {', '--prompt-reference-color')).toBe(
            getPropertyValue(
                workspaceScss,
                '.workspace-branch-marker-message-text {',
                '--prompt-reference-color',
            ),
        )
        expect(getPropertyValue(scss, '.ai-user-message {', '--prompt-reference-capability-module-color')).toBe(
            getPropertyValue(
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

    it('keeps materialized lineage icons free of canvas-node shadows', () => {
        expect(getPropertyValue(scss, '.ai-lineage-event-icon {', 'box-shadow')).toBe('none')
    })

    it('shares the generation-prompt surface style with the prompt timeline item', () => {
        const traceBlock = getBraceBalancedBlock(scss, '.ai-generation-trace-block')
        const promptSurfaceMixin = getBraceBalancedBlock(scss, '@mixin ai-generation-prompt-surface')
        const timelineSelector = [
            '.workspace-media-generation-progress',
            "    .progress-timeline-item[data-item-id='lineage:media-generation-prompt']",
            '    > .progress-timeline-content',
            '    > .progress-timeline-details',
            '    > .progress-timeline-summary {',
        ].join('\n')

        expectSourceToContain(scss, '@mixin ai-generation-prompt-surface {')
        expectSourceToContain(scss, 'border-left: 2px solid rgba(115, 87, 184, 0.34);')
        expectSourceToContain(scss, 'background: rgba(115, 87, 184, 0.06);')
        expectSourceToContain(scss, timelineSelector)
        expectSourceToContain(
            getBraceBalancedBlock(scss, timelineSelector),
            '@include ai-generation-prompt-surface;',
        )
        expect(
            traceBlock.includes(".progress-timeline-item[data-item-id='lineage:media-generation-prompt']"),
            'timeline prompt selector must not be scoped under the generation trace block',
        ).toBe(false)
        expect(
            promptSurfaceMixin.includes('max-height'),
            'generation prompt surface must render its full height',
        ).toBe(false)
        expect(
            promptSurfaceMixin.includes('overflow-y'),
            'generation prompt surface must not introduce an internal scrollbar',
        ).toBe(false)
    })

    it('contains generated-image media shell styling hooks', () => {
        expectSourceToContain(scss, '.ai-generated-image-wrapper')
        expectSourceToContain(scss, '.ai-generated-image-container')
        expectSourceToContain(scss, '.ai-generated-image-content')
        expectSourceToContain(scss, '.ai-generated-image-prompt')
        expectSourceToContain(scss, '.ai-generated-media-run-pill')
    })
})
