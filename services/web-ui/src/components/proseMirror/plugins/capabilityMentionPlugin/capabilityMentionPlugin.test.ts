import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { TextSelection } from 'prosemirror-state'

import { createProseMirrorSchema, DOCUMENT_TYPE } from '@lixpi/prosemirror'
import {
    capabilityMentionPluginKey,
    collectCapabilityReferences,
    isCurrentCapabilityMentionResponse,
    nextCapabilityMentionIndex,
    reduceCapabilityMentionState,
    type CapabilityMentionState,
} from '$src/components/proseMirror/plugins/capabilityMentionPlugin/index.ts'
import { createEditorState } from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'
import { extractContentJSON } from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputPlugin.ts'

const initialMentionState: CapabilityMentionState = {
    active: false,
    triggerPos: -1,
    query: '',
    selectedIndex: 0,
}

const mentionStyles = readFileSync(resolve(__dirname, 'capability-mention.scss'), 'utf-8')

describe('Capability mention picker', () => {
    it('uses the light sidebar visual language instead of an isolated dark theme', () => {
        expect(mentionStyles.includes('background: rgba(255, 255, 255, 0.94)')).toBe(true)
        expect(mentionStyles.includes('color: #1a2744')).toBe(true)
        expect(mentionStyles.includes('background: rgba(95, 143, 207, 0.11)')).toBe(true)
        expect(mentionStyles.includes('rgb(24 24 28 / 96%)')).toBe(false)
    })

    it('tracks a multi-word query and resets keyboard selection after edits', () => {
        const schema = createProseMirrorSchema(DOCUMENT_TYPE.AI_PROMPT_INPUT)
        const paragraph = schema.nodes.paragraph.create(null, schema.text('@Character Creator'))
        const input = schema.nodes.aiPromptInput.create(null, paragraph)
        const state = createEditorState(schema.nodes.doc.create(null, input))
        const open = reduceCapabilityMentionState(
            state.tr.setMeta(capabilityMentionPluginKey, { type: 'open', triggerPos: 2 }),
            initialMentionState,
        )
        const selection = TextSelection.create(state.doc, 20)
        const queried = reduceCapabilityMentionState(state.tr.setSelection(selection), { ...open, selectedIndex: 4 })

        expect(queried).toEqual({
            active: true,
            triggerPos: 2,
            query: 'Character Creator',
            selectedIndex: 0,
        })
    })

    it('extracts stable ordered references and collapses duplicate IDs', () => {
        expect(collectCapabilityReferences([
            {
                type: 'paragraph',
                content: [
                    { type: 'capability_reference', attrs: { capabilityId: 'tool-1', kind: 'tool', displayName: 'Old name' } },
                    { type: 'capability_reference', attrs: { capabilityId: 'skill-1', kind: 'skill', displayName: 'Skill' } },
                    { type: 'capability_reference', attrs: { capabilityId: 'tool-1', kind: 'tool', displayName: 'New name' } },
                ],
            },
        ])).toEqual([
            { capabilityId: 'tool-1', kind: 'tool' },
            { capabilityId: 'skill-1', kind: 'skill' },
        ])
    })

    it('treats a capability-only prompt as submittable draft content', () => {
        const schema = createProseMirrorSchema(DOCUMENT_TYPE.AI_PROMPT_INPUT)
        const reference = schema.nodes.capability_reference.create({
            capabilityId: 'tool-1',
            kind: 'tool',
            displayName: 'Character Creator',
        })
        const paragraph = schema.nodes.paragraph.create(null, reference)
        const input = schema.nodes.aiPromptInput.create(null, paragraph)
        const state = createEditorState(schema.nodes.doc.create(null, input))

        expect(extractContentJSON(state)).toEqual([{
            type: 'paragraph',
            content: [{
                type: 'capability_reference',
                attrs: {
                    capabilityId: 'tool-1',
                    kind: 'tool',
                    displayName: 'Character Creator',
                },
            }],
        }])
    })

    it('closes stale mention state when the cursor moves before the trigger', () => {
        const schema = createProseMirrorSchema(DOCUMENT_TYPE.AI_PROMPT_INPUT)
        const paragraph = schema.nodes.paragraph.create(null, schema.text('@tool'))
        const input = schema.nodes.aiPromptInput.create(null, paragraph)
        const state = createEditorState(schema.nodes.doc.create(null, input))
        const transaction = state.tr.setSelection(TextSelection.create(state.doc, 2))

        expect(reduceCapabilityMentionState(transaction, {
            active: true,
            triggerPos: 2,
            query: 'tool',
            selectedIndex: 0,
        }).active).toBe(false)
    })

    it('rejects stale async responses after a newer query starts', () => {
        const state = { active: true, triggerPos: 2, query: 'character', selectedIndex: 0 }
        expect(isCurrentCapabilityMentionResponse(1, 2, 'char', state)).toBe(false)
        expect(isCurrentCapabilityMentionResponse(2, 2, 'char', state)).toBe(false)
        expect(isCurrentCapabilityMentionResponse(2, 2, 'character', state)).toBe(true)
    })

    it('wraps ArrowUp and ArrowDown selection across result bounds', () => {
        expect(nextCapabilityMentionIndex(2, 'next', 3)).toBe(0)
        expect(nextCapabilityMentionIndex(0, 'previous', 3)).toBe(2)
        expect(nextCapabilityMentionIndex(0, 'next', 0)).toBe(0)
    })
})
