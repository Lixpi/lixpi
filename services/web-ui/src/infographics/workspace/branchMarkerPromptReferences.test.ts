import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
    getBranchMarkerPromptDisplayText,
    getBranchMarkerPromptParts,
    renderBranchMarkerPromptParts,
    truncateBranchMarkerPromptParts,
} from './branchMarkerPromptReferences.ts'

function expectSourceToContain(source: string, snippet: string): void {
    expect(source.includes(snippet), `source should contain: ${snippet}`).toBe(true)
}

function expectSourceNotToContain(source: string, snippet: string): void {
    expect(source.includes(snippet), `source should not contain: ${snippet}`).toBe(false)
}

const submittedMessage = {
    type: 'aiUserMessage',
    content: [{
        type: 'paragraph',
        content: [
            { type: 'text', text: 'Create ' },
            {
                type: 'prompt_reference',
                attrs: {
                    referenceType: 'capability-module',
                    moduleId: 'action-timeline',
                    displayName: 'Action Timeline',
                },
            },
            { type: 'text', text: ' 15s duration 2s gaps with imaginary plot' },
        ],
    }],
}

describe('branch marker prompt content', () => {
    it('keeps the submitted Capability badge in its exact inline position', () => {
        const parts = getBranchMarkerPromptParts(submittedMessage, '')

        expect(parts).toEqual([
            { type: 'text', text: 'Create ' },
            {
                type: 'capability-module',
                reference: {
                    referenceType: 'capability-module',
                    moduleId: 'action-timeline',
                    displayName: 'Action Timeline',
                },
            },
            { type: 'text', text: ' 15s duration 2s gaps with imaginary plot' },
        ])
        expect(getBranchMarkerPromptDisplayText(parts)).toBe(
            'Create Action Timeline 15s duration 2s gaps with imaginary plot',
        )

        const rendered = renderBranchMarkerPromptParts(parts)
        expect(rendered[0]).toBe('Create ')
        expect(rendered[1]).toBeInstanceOf(HTMLSpanElement)
        expect((rendered[1] as HTMLSpanElement).classList.contains('prompt-reference-chip-capability-module')).toBe(true)
        expect((rendered[1] as HTMLSpanElement).querySelector('.prompt-reference-chip-name')?.textContent).toBe('Action Timeline')
        expect(rendered[2]).toBe(' 15s duration 2s gaps with imaginary plot')
    })

    it('preserves normal marker text behavior when no Capability badge exists', () => {
        const parts = getBranchMarkerPromptParts({
            type: 'aiUserMessage',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '  Create   an image  ' }] }],
        }, '')

        expect(parts).toEqual([{ type: 'text', text: 'Create an image' }])
        expect(renderBranchMarkerPromptParts(parts)).toEqual(['Create an image'])
    })

    it('truncates by displayed character order without moving the Capability badge', () => {
        const parts = truncateBranchMarkerPromptParts(getBranchMarkerPromptParts(submittedMessage, ''), 27)

        expect(parts[0]).toEqual({ type: 'text', text: 'Create ' })
        expect(parts[1]?.type).toBe('capability-module')
        expect(getBranchMarkerPromptDisplayText(parts)).toBe('Create Action Timeline 15s ...')
    })

    it('never degrades a partially visible Capability badge into plain text', () => {
        const parts = truncateBranchMarkerPromptParts(getBranchMarkerPromptParts(submittedMessage, ''), 12)

        expect(parts).toEqual([{ type: 'text', text: 'Create ...' }])
    })

    it('uses a lighter Capability accent on the dark branch message without changing marker layout', () => {
        const scss = readFileSync(resolve(__dirname, 'workspace-canvas.scss'), 'utf-8')
        const selector = '.workspace-branch-marker-message-text .prompt-reference-chip {'
        const ruleStart = scss.indexOf(selector)
        const ruleEnd = scss.indexOf('\n}', ruleStart)
        const rule = ruleStart >= 0 && ruleEnd >= 0 ? scss.slice(ruleStart, ruleEnd) : ''
        const capabilitySelector = '.workspace-branch-marker-message-text .prompt-reference-chip-capability-module {'
        const capabilityRuleStart = scss.indexOf(capabilitySelector)
        const capabilityRuleEnd = scss.indexOf('\n}', capabilityRuleStart)
        const capabilityRule = capabilityRuleStart >= 0 && capabilityRuleEnd >= 0
            ? scss.slice(capabilityRuleStart, capabilityRuleEnd)
            : ''

        expectSourceToContain(rule, 'color: inherit;')
        expectSourceToContain(rule, 'font-size: inherit;')
        expectSourceToContain(scss, '--prompt-reference-capability-module-color: #eca983;')
        expectSourceToContain(capabilityRule, 'color: var(--prompt-reference-capability-module-color);')
        expectSourceNotToContain(scss, '.workspace-branch-marker-message > .prompt-reference-chip {')
    })
})
