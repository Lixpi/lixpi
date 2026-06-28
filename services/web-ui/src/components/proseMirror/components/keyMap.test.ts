import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Schema } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import { redo } from 'prosemirror-history'
import { schema as baseSchema } from '$src/components/proseMirror/components/schema.ts'
import { documentTitleNodeType, documentTitleNodeSpec } from '$src/components/proseMirror/customNodes/documentTitleNode.ts'
import { insertAiChatThread } from '$src/components/proseMirror/components/commands.js'
import { buildKeymap } from '$src/components/proseMirror/components/keyMap.js'

let consoleWarnSpy: { mockRestore: () => void } | null = null
let consoleErrorSpy: { mockRestore: () => void } | null = null

function createSchema(docContent: string) {
    const nodes = {
        ...(baseSchema.spec.nodes as any).toObject(),
        doc: {
            ...(baseSchema.spec.nodes.get('doc') as Record<string, unknown>),
            content: docContent,
            marks: '_',
        },
        [documentTitleNodeType]: {
            ...documentTitleNodeSpec,
            group: 'block',
        },
    }

    return new Schema({
        nodes,
        marks: (baseSchema.spec.marks as any).toObject(),
    })
}

function createDocument(schema: Schema, includeParagraph: boolean) {
    const titleNode = schema.nodes[documentTitleNodeType].create(
        {},
        [schema.text('Thread title')],
    )

    if (!includeParagraph) {
        return schema.nodes.doc.create(null, [titleNode])
    }

    const bodyParagraph = schema.nodes.paragraph.create(null, [schema.text('Prompt and body')])
    return schema.nodes.doc.create(null, [titleNode, bodyParagraph])
}

function findPositionWhereParentMatches(doc: any, matches: (r: any) => boolean): number {
    for (let pos = 0; pos <= doc.content.size; pos++) {
        const resolved = doc.resolve(pos)
        if (matches(resolved)) {
            return pos
        }
    }

    throw new Error('No matching selection position found.')
}

function findTitleEndPosition(doc: any, titleNodeType: string): number {
    let selectionStart = -1
    doc.forEach((node: any, pos: number) => {
        if (node.type.name === titleNodeType) {
            selectionStart = pos + node.nodeSize
        }
    })
    if (selectionStart < 0) {
        throw new Error('Unable to locate document title node.')
    }
    return selectionStart
}

const defaultSchema = createSchema(`${documentTitleNodeType} block+`)

describe('buildKeymap', () => {
    beforeEach(() => {
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleWarnSpy?.mockRestore()
        consoleErrorSpy?.mockRestore()
        consoleWarnSpy = null
        consoleErrorSpy = null
    })

    it('supports mapKeys overriding and disabling key bindings', () => {
        const disabledDefaultUndo = buildKeymap(defaultSchema, 'document', {
            'Mod-z': false,
        })
        expect(disabledDefaultUndo['Mod-z']).toBeUndefined()

        const remappedUndo = buildKeymap(defaultSchema, 'document', {
            'Shift-Mod-z': 'Mod-z',
        })
        expect(remappedUndo['Mod-z']).toBe(redo)
        expect(remappedUndo['Shift-Mod-z']).toBeUndefined()
    })

    it('adds AI thread-specific binding only for aiChatThread documents', () => {
        const aiChatBindings = buildKeymap(defaultSchema, 'aiChatThread')
        const documentBindings = buildKeymap(defaultSchema, 'document')

        expect(aiChatBindings['Mod-Shift-i']).toBe(insertAiChatThread)
        expect(aiChatBindings['Mod-Shift-I']).toBe(insertAiChatThread)
        expect(documentBindings['Mod-Shift-i']).toBeUndefined()
        expect(documentBindings['Mod-Shift-I']).toBeUndefined()
    })

    it('selects title content when Mod-a is pressed inside document title', () => {
        const schema = defaultSchema
        const doc = createDocument(schema, true)
        const state = EditorState.create({ schema, doc })

        const selectAll = buildKeymap(schema, 'document')['Mod-a']
        if (!selectAll) {
            throw new Error('Expected Mod-a key binding to exist.')
        }

        const positionInsideTitle = findPositionWhereParentMatches(doc, (resolved) => {
            return resolved.parent.type.name === documentTitleNodeType
                && resolved.parentOffset > 0
                && resolved.parentOffset < resolved.parent.content.size
        })
        const stateWithSelection = state.apply(state.tr.setSelection(TextSelection.create(doc, positionInsideTitle)))

        const dispatch = vi.fn()
        const handled = selectAll(stateWithSelection, dispatch)
        expect(handled).toBe(true)

        const selection = dispatch.mock.calls[0][0].selection
        const resolved = doc.resolve(positionInsideTitle)
        const expectedFrom = resolved.start()
        const expectedTo = expectedFrom + resolved.parent.content.size

        expect(selection.from).toBe(expectedFrom)
        expect(selection.to).toBe(expectedTo)
    })

    it('selects everything after title when Mod-a is pressed outside title', () => {
        const schema = defaultSchema
        const doc = createDocument(schema, true)
        const state = EditorState.create({ schema, doc })

        const selectAll = buildKeymap(schema, 'document')['Mod-a']
        if (!selectAll) {
            throw new Error('Expected Mod-a key binding to exist.')
        }

        const positionInParagraph = findPositionWhereParentMatches(doc, (resolved) => {
            return resolved.parent.type.name === 'paragraph'
                && resolved.parentOffset > 0
                && resolved.parentOffset < resolved.parent.content.size
        })
        const stateWithSelection = state.apply(state.tr.setSelection(TextSelection.create(doc, positionInParagraph)))

        const dispatch = vi.fn()
        const handled = selectAll(stateWithSelection, dispatch)
        expect(handled).toBe(true)

        const selection = dispatch.mock.calls[0][0].selection
        const expectedFrom = findTitleEndPosition(doc, documentTitleNodeType)
        const expectedTo = doc.content.size - 1

        expect(selection.from).toBe(expectedFrom)
        expect(selection.to).toBe(expectedTo)
    })

    it('returns false when there is nothing selectable after document title', () => {
        const titleOnlySchema = createSchema(documentTitleNodeType)
        const doc = createDocument(titleOnlySchema, false)
        const state = EditorState.create({ schema: titleOnlySchema, doc })
        const selectAll = buildKeymap(titleOnlySchema, 'document')['Mod-a']
        if (!selectAll) {
            throw new Error('Expected Mod-a key binding to exist.')
        }

        const stateWithSelection = state.apply(state.tr.setSelection(TextSelection.create(doc, 0)))
        const dispatch = vi.fn()
        const handled = selectAll(stateWithSelection, dispatch)

        expect(handled).toBe(false)
        expect(dispatch).not.toHaveBeenCalled()
    })
})
