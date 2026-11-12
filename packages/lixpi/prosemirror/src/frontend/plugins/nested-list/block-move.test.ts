import {
    describe,
    expect,
    it,
} from 'vitest'
import { EditorState } from 'prosemirror-state'
import {
    assertNestedListDocument,
    createNestedListSchema,
    parseNestedListDocument,
    type NestedListDocumentJson,
} from '../../../shared/nested-list.ts'
import { findNestedListEntry } from './commands.ts'
import { moveNestedListBlock } from './block-move.ts'
import {
    type NestedListMove,
} from './types.ts'

const text = (id: string, type = 'paragraph'): NestedListDocumentJson => ({
    type,
    attrs: {
        entryId: id,
        ...(type === 'heading' ? { level: 2 } : {}),
    },
    content: [{
        type: 'text',
        text: id,
    }],
})
const item = (id: string, children: NestedListDocumentJson[] = []): NestedListDocumentJson => ({
    type: 'list_item',
    attrs: {
        entryId: id,
        itemType: 'custom',
        data: { id },
        tagIds: ['tag'],
    },
    content: [text(`${id}-label`), ...children],
})
const list = (id: string, items: NestedListDocumentJson[]): NestedListDocumentJson => ({
    type: 'bullet_list',
    attrs: { entryId: id },
    content: items,
})
const fixture = (): EditorState => {
    const schema = createNestedListSchema()

    return EditorState.create({
        schema,
        doc: parseNestedListDocument({
            type: 'doc',
            content: [
                text('lead'),
                list('main-list', [item('a', [list('child-list', [item('child')])]), item('b')]),
                text('tail', 'heading'),
            ],
        }, schema),
    })
}
const move = (state: EditorState, request: NestedListMove): EditorState => {
    let next = state
    expect(moveNestedListBlock(request)(state, transaction => void (next = state.apply(transaction)))).toBe(true)
    assertNestedListDocument(next.doc)

    return next
}

describe('nested-list block moves', () => {
    it('moves a complete custom subtree beside a standalone heading', () => {
        const initial = fixture()
        const original = findNestedListEntry(initial.doc, 'a')!.node
        const next = move(initial, {
            entryId: 'a',
            targetEntryId: 'tail',
            placement: 'after',
        })
        expect(next.doc.lastChild?.type.name).toBe('bullet_list')
        expect(next.doc.lastChild?.firstChild?.eq(original)).toBe(true)
        expect(findNestedListEntry(next.doc, 'child')?.node.attrs.data).toEqual({ id: 'child' })
        expect(next.doc.child(1).firstChild?.attrs.entryId).toBe('b')
    })

    it('moves text after a complete list while retaining both custom subtrees', () => {
        const initial = fixture()
        const originalList = initial.doc.child(1)
        const next = move(initial, {
            entryId: 'lead',
            targetEntryId: 'b',
            placement: 'after',
        })
        expect(next.doc.child(0).eq(originalList)).toBe(true)
        expect(next.doc.child(1).attrs.entryId).toBe('lead')
    })

    it.each(['inside', 'after'] as const)('rejects moving text %s an interior list row', placement => {
        const initial = fixture()
        expect(moveNestedListBlock({
            entryId: 'tail',
            targetEntryId: 'a',
            placement,
        })(initial)).toBe(false)
    })

    it('reorders standalone text and retains its whole-block formatting', () => {
        let initial = fixture()
        const lead = findNestedListEntry(initial.doc, 'lead')!
        initial = initial.apply(initial.tr.setNodeMarkup(lead.pos, undefined, {
            ...lead.node.attrs,
            bold: true,
        }))
        const next = move(initial, {
            entryId: 'lead',
            targetEntryId: 'tail',
            placement: 'after',
        })
        expect(next.doc.lastChild?.attrs).toMatchObject({
            entryId: 'lead',
            bold: true,
        })
    })

    it('moves a nested item out of its only-child list and preserves its parent label', () => {
        const next = move(fixture(), {
            entryId: 'child',
            targetEntryId: 'a',
            placement: 'before',
        })
        const parent = findNestedListEntry(next.doc, 'a')!.node
        expect(parent.childCount).toBe(1)
        expect(parent.firstChild?.attrs.entryId).toBe('a-label')
        expect(next.doc.child(1).firstChild?.attrs.entryId).toBe('child')
    })

    it.each([
        {
            entryId: 'a',
            targetEntryId: 'child',
            placement: 'inside',
        },
        {
            entryId: 'a',
            targetEntryId: 'a-label',
            placement: 'before',
        },
        {
            entryId: 'a-label',
            targetEntryId: 'tail',
            placement: 'after',
        },
        {
            entryId: 'lead',
            targetEntryId: 'tail',
            placement: 'inside',
        },
        {
            entryId: 'a',
            targetEntryId: 'a',
            placement: 'before',
        },
    ] as NestedListMove[])('rejects invalid move $entryId $placement $targetEntryId', request => {
        const dispatch = (): never => { throw new Error('Invalid move dispatched') }
        expect(moveNestedListBlock(request)(fixture(), dispatch)).toBe(false)
    })
})
