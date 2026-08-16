import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
    getBranchMarkerPromptDisplayText,
    getBranchMarkerPromptParts,
    renderBranchMarkerPromptParts,
    resolveBranchMarkerPromptParts,
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
    it('keeps the exact submitted prompt while the persisted turn is still unavailable', () => {
        const submittedParts = getBranchMarkerPromptParts(submittedMessage, '')

        expect(resolveBranchMarkerPromptParts({
            submittedParts,
            fallbackText: 'REFERENCE_1 placeholder serialization',
        })).toEqual(submittedParts)
    })

    it('switches from the submit snapshot only when the persisted user turn is available', () => {
        expect(getBranchMarkerPromptDisplayText(resolveBranchMarkerPromptParts({
            persistedUserMessage: {
                type: 'aiUserMessage',
                content: [{
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Persisted user request' }],
                }],
            },
            submittedParts: [{ type: 'text', text: 'Submitted user request' }],
            fallbackText: 'Serialized provider request',
        }))).toBe('Persisted user request')
    })

    it('reads submitted composer content before the persisted user message is available', () => {
        const parts = getBranchMarkerPromptParts({
            type: 'doc',
            content: [{
                type: 'paragraph',
                content: [
                    { type: 'text', text: 'create a character sheet ' },
                    {
                        type: 'prompt_reference',
                        attrs: {
                            referenceType: 'capability-module',
                            moduleId: 'character-creator',
                            displayName: 'Character Creator',
                        },
                    },
                ],
            }],
        }, 'create a character sheet')

        expect(getBranchMarkerPromptDisplayText(parts)).toBe(
            'create a character sheet Character Creator',
        )
        expect(parts.at(-1)?.type).toBe('capability-module')
    })

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

    it('renders capability metadata previews in submitted branch markers', async () => {
        const parts = getBranchMarkerPromptParts(submittedMessage, '')
        const rendered = renderBranchMarkerPromptParts(parts, {
            inlinePopover: true,
            previewRenderer: {
                getNode: () => undefined,
                getCapabilityModule: async () => ({
                    moduleId: 'action-timeline',
                    name: 'Action Timeline',
                    normalizedName: 'action timeline',
                    summary: 'Creates an action timeline.',
                    tags: [],
                    status: 'active',
                    descriptionSheet: {
                        purpose: 'Creates a timed action plan.',
                        expectedInputs: [{
                            name: 'Prompt',
                            requirement: 'required',
                            accepts: ['prompt'],
                            description: 'Describe the action.',
                        }],
                        bestResults: ['Specify timing.'],
                        limitations: ['Timing is inferred when omitted.'],
                        executionCharacteristics: { cost: 'medium', latency: 'medium', summary: 'Builds a structured timeline.' },
                    },
                }),
                environment: {
                    getDocuments: () => [],
                    getThreads: () => [],
                    getApiBaseUrl: () => '',
                    getAuthToken: async () => '',
                },
            },
        })
        const preview = rendered[1] as HTMLElement
        document.body.append(preview)
        preview.dispatchEvent(new PointerEvent('pointerenter'))
        await new Promise(resolve => setTimeout(resolve, 0))

        expect(document.body.querySelector('.capability-description-card h2')?.textContent).toBe('Action Timeline')
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

        expect(getBranchMarkerPromptDisplayText(parts)).toBe('Create Action Timeline...')
        expect(parts[1]?.type).toBe('capability-module')
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

    it('keeps the media reference when its stored label crosses the marker preview limit', () => {
        const parts = getBranchMarkerPromptParts({
            type: 'aiUserMessage',
            content: [{
                type: 'paragraph',
                content: [
                    { type: 'text', text: 'Create character ' },
                    {
                        type: 'prompt_reference',
                        attrs: {
                            referenceType: 'capability-module',
                            moduleId: 'character-creator',
                            displayName: 'Character Creator',
                        },
                    },
                    { type: 'text', text: ' for ' },
                    {
                        type: 'prompt_reference',
                        attrs: {
                            referenceType: 'media',
                            assetId: 'asset-kitten',
                            mediaKind: 'image',
                            displayName: 'generated-image-with-a-long-storage-name.png',
                        },
                    },
                ],
            }],
        }, '')
        const truncated = truncateBranchMarkerPromptParts(parts, 45)

        expect(truncated.at(-1)?.type).toBe('media')
        expect(getBranchMarkerPromptDisplayText(truncated)).toBe(
            'Create character Character Creator for generated-image-with-a-long-storage-name.png',
        )
    })

    it('uses a lighter Capability accent on the dark branch message without changing marker layout', () => {
        const scss = readFileSync(resolve(__dirname, 'workspace-canvas.scss'), 'utf-8')
        const selector = '.workspace-branch-marker-message-text .prompt-reference-chip {'
        const ruleStart = scss.indexOf(selector)
        const ruleEnd = scss.indexOf('\n}', ruleStart)
        const rule = ruleStart >= 0 && ruleEnd >= 0 ? scss.slice(ruleStart, ruleEnd) : ''
        // The dark palette is declared once on the marker surface, so every chip
        // inside it — prompt line, reference row, pipeline trace — inherits it.
        // Anchored to the newline so this finds the top-level rule rather than the
        // indented responsive override that shares the selector.
        const markerSurfaceStart = scss.indexOf('\n.workspace-branch-marker-content {')
        const markerSurfaceEnd = scss.indexOf('\n}', markerSurfaceStart)
        const markerSurfaceRule = markerSurfaceStart >= 0 && markerSurfaceEnd >= 0
            ? scss.slice(markerSurfaceStart, markerSurfaceEnd)
            : ''

        expectSourceToContain(rule, 'font-size: inherit;')
        expectSourceToContain(markerSurfaceRule, '@include prompt-reference-chip-on-dark-surface;')
        expectSourceNotToContain(scss, '--prompt-reference-color: #d7e6ff;')
        expectSourceNotToContain(scss, '--prompt-reference-capability-module-color: #eca983;')
        expectSourceNotToContain(scss, '.workspace-branch-marker-message > .prompt-reference-chip {')
        expectSourceNotToContain(scss, '.workspace-branch-marker-message-text:has(.context-preview-inline.is-open)')
    })
})
