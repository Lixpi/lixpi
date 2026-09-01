import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    getBranchMarkerPromptParts,
    resolveBranchMarkerPromptParts,
    getBranchMarkerPromptDisplayText,
    truncateBranchMarkerPromptParts,
} from './marker-prompt-parts.ts'

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
})
