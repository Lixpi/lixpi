// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    getBranchMarkerPromptDisplayText,
    getBranchMarkerPromptParts,
    truncateBranchMarkerPromptParts,
    type BranchMarkerPromptPart,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import { BranchMarkerPromptParts } from '@lixpi/canvas-components-lixpi-specific/frontend/nodes'
import { createCanvasPromptReferenceRenderer } from './branch-prompt-reference-renderer.ts'

const owners: BranchMarkerPromptParts[] = []
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
})

function renderBranchMarkerPromptParts(parts: readonly BranchMarkerPromptPart[], options?: Omit<Parameters<typeof createCanvasPromptReferenceRenderer>[0], 'document'>) {
    const prompt = new BranchMarkerPromptParts(parts, createCanvasPromptReferenceRenderer({ document, ...options }))
    owners.push(prompt)
    return prompt.items
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
                    document,
                    tooltipHideDelayMs: 0,
                    getArtifactIcon: () => '',
                    extractDocumentText: () => '',
                    initialRenditionUrl: () => '',
                    resolveRenditionUrl: async () => '',
                    onError: vi.fn(),
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
                    document,
                    tooltipHideDelayMs: 0,
                    getArtifactIcon: () => '',
                    extractDocumentText: () => '',
                    initialRenditionUrl: () => '',
                    resolveRenditionUrl: async () => '',
                    onError: vi.fn(),
                },
            },
        })

        expect(parts[1]?.type).toBe('media')
        expect(getBranchMarkerPromptDisplayText(parts)).toBe('Use asset-1 on the train')
        expect((rendered[1] as HTMLElement).classList.contains('context-preview-inline')).toBe(true)
        expect((rendered[1] as HTMLElement).querySelector('.prompt-reference-chip-name')?.textContent).toBe('Shelby')
        expect((rendered[1] as HTMLElement).querySelector('.context-preview-popover-title')?.textContent)
            .toBe('Shelby')
    })
})
