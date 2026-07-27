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

    it('keeps the complete Capability badge in a compact accepted-output preview', () => {
        const parts = truncateBranchMarkerPromptParts(getBranchMarkerPromptParts(submittedMessage, ''), 22)
        const rendered = renderBranchMarkerPromptParts(parts)

        expect(getBranchMarkerPromptDisplayText(parts)).toBe('Create Action Timeline...')
        expect(rendered[0]).toBe('Create ')
        expect(rendered[1]).toBeInstanceOf(HTMLSpanElement)
        expect((rendered[1] as HTMLSpanElement).classList.contains('prompt-reference-chip-capability-module')).toBe(true)
        expect(rendered[2]).toBe('...')
    })

    it('keeps media references inline and renders their shared hover preview with the canonical Asset title', () => {
        const parts = getBranchMarkerPromptParts({
            type: 'aiUserMessage',
            content: [{
                type: 'paragraph',
                content: [
                    { type: 'text', text: 'Use ' },
                    {
                        type: 'prompt_reference',
                        attrs: {
                            referenceType: 'media',
                            assetId: 'asset-1',
                            mediaKind: 'image',
                            displayName: 'asset-1',
                        },
                    },
                    { type: 'text', text: ' on the train' },
                ],
            }],
        }, '')
        const rendered = renderBranchMarkerPromptParts(parts, {
            inlinePopover: true,
            previewRenderer: {
                getNode: () => ({
                    type: 'image',
                    nodeId: 'image-node-1',
                    assetId: 'asset-1',
                    position: { x: 0, y: 0 },
                    dimensions: { width: 640, height: 480 },
                }),
                environment: {
                    getDocuments: () => [],
                    getThreads: () => [],
                    getAsset: () => ({ title: 'Shelby' }) as never,
                    getApiBaseUrl: () => '',
                    getAuthToken: async () => '',
                },
            },
        })

        expect(parts[1]?.type).toBe('media')
        expect(getBranchMarkerPromptDisplayText(parts)).toBe('Use asset-1 on the train')
        expect((rendered[1] as HTMLElement).classList.contains('context-preview-inline')).toBe(true)
        expect((rendered[1] as HTMLElement).querySelector('.prompt-reference-chip-name')?.textContent).toBe('Shelby')
        expect((rendered[1] as HTMLElement).querySelector('.workspace-ai-chat-panel-context-preview-popover-title')?.textContent)
            .toBe('Shelby')
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

        expectSourceToContain(rule, 'font-size: inherit;')
        expectSourceToContain(scss, '--prompt-reference-color: #d7e6ff;')
        expectSourceToContain(rule, 'color: var(--prompt-reference-color);')
        expectSourceToContain(scss, '--prompt-reference-capability-module-color: #eca983;')
        expectSourceToContain(capabilityRule, 'color: var(--prompt-reference-capability-module-color);')
        expectSourceNotToContain(scss, '.workspace-branch-marker-message > .prompt-reference-chip {')
        expectSourceNotToContain(scss, '.workspace-branch-marker-message-text:has(.context-preview-inline.is-open)')
    })
})
