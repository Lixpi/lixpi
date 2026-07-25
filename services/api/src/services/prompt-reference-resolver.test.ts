import { describe, expect, it } from 'vitest'

import { extractLatestUserPromptReferences } from './prompt-reference-resolver.ts'

const threadDoc = (messages: object[]) => ({
    type: 'doc',
    content: [{
        type: 'aiChatThread',
        attrs: { threadId: 'conversation-1' },
        content: messages,
    }],
})

describe('extractLatestUserPromptReferences', () => {
    it('reads and deduplicates every typed atom from the latest authoritative user message', () => {
        const doc = threadDoc([
            {
                type: 'aiUserMessage',
                content: [{ type: 'paragraph', content: [{
                    type: 'prompt_reference',
                    attrs: { referenceType: 'skill', capabilityId: 'old-skill', displayName: 'Old' },
                }] }],
            },
            { type: 'aiResponseMessage', content: [{ type: 'paragraph' }] },
            {
                type: 'aiUserMessage',
                content: [{
                    type: 'paragraph',
                    content: [
                        { type: 'prompt_reference', attrs: { referenceType: 'media', assetId: 'asset-1', nodeId: 'node-1', mediaKind: 'image', displayName: 'Stale title' } },
                        { type: 'prompt_reference', attrs: { referenceType: 'capability-module', moduleId: 'character-creator', displayName: 'Renamed locally' } },
                        { type: 'prompt_reference', attrs: { referenceType: 'tool', capabilityId: 'tool-1', displayName: 'Tool' } },
                        { type: 'prompt_reference', attrs: { referenceType: 'skill', capabilityId: 'skill-1', displayName: 'Skill' } },
                        { type: 'prompt_reference', attrs: { referenceType: 'tool', capabilityId: 'tool-1', displayName: 'Duplicate' } },
                        { type: 'capability_reference', attrs: { capabilityId: 'legacy-skill', kind: 'skill', displayName: 'Legacy Skill' } },
                    ],
                }],
            },
        ])

        expect(extractLatestUserPromptReferences(doc, 'conversation-1')).toEqual([
            { referenceType: 'media', assetId: 'asset-1', nodeId: 'node-1', mediaKind: 'image' },
            { referenceType: 'capability-module', moduleId: 'character-creator' },
            { referenceType: 'tool', capabilityId: 'tool-1' },
            { referenceType: 'skill', capabilityId: 'skill-1' },
            { referenceType: 'skill', capabilityId: 'legacy-skill' },
        ])
    })

    it('rejects malformed atoms instead of trusting cosmetic or forged fields', () => {
        const doc = threadDoc([{
            type: 'aiUserMessage',
            content: [{ type: 'paragraph', content: [{
                type: 'prompt_reference',
                attrs: { referenceType: 'media', assetId: 'asset-1', mediaKind: 'executable', displayName: 'Forged' },
            }] }],
        }])

        expect(() => extractLatestUserPromptReferences(doc, 'conversation-1'))
            .toThrow('INVALID_PROMPT_REFERENCE_ATOM')
    })
})
