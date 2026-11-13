import {
    Fragment,
    type Node as ProseMirrorNode,
} from 'prosemirror-model'
import {
    TextSelection,
    type Command,
    type Transaction,
} from 'prosemirror-state'
import { PLAIN_LIST_ITEM_TYPE } from '../../../shared/nested-list.ts'
import { findNestedListEntry } from './commands.ts'

export type NestedListBlockStyle =
    | { type: 'paragraph' }
    | {
        type: 'heading'
        level: 1 | 2 | 3
    }
    | { type: 'bullet_list' }

const newPlainItem = (
    state: Parameters<Command>[0],
    paragraph?: ProseMirrorNode,
): ProseMirrorNode =>
    state.schema.nodes.list_item.create(
        {
            entryId: crypto.randomUUID(),
            itemType: PLAIN_LIST_ITEM_TYPE,
            data: null,
            tagIds: [],
        },
        paragraph ?? state.schema.nodes.paragraph.create({ entryId: crypto.randomUUID() }),
    )

const newBlock = (
    state: Parameters<Command>[0],
    style: NestedListBlockStyle,
): ProseMirrorNode => {
    if (style.type === 'bullet_list')
        return state.schema.nodes.bullet_list.create(
            { entryId: crypto.randomUUID() },
            newPlainItem(state),
        )

    return state.schema.nodes[style.type].create({
        entryId: crypto.randomUUID(),
        ...(style.type === 'heading' ? { level: style.level } : {}),
    })
}

const selectInserted = (
    tr: Transaction,
    pos: number,
    type: string,
): void => {
    const offset = type === 'bullet_list'
        ? 3
        : type === 'list_item'
            ? 2
            : 1
    tr.setSelection(
        TextSelection.near(
            tr.doc.resolve(pos + offset),
        ),
    )
}

export const insertNestedListBlockAfter = (
    entryId: string,
    style: NestedListBlockStyle,
): Command =>
(state, dispatch) => {
    const entry = findNestedListEntry(state.doc, entryId)

    if (!entry)
        return false

    const at = state.doc.resolve(entry.pos)
    const isItem = entry.node.type.name === 'list_item'
    const isText = entry.node.type.name === 'paragraph' || entry.node.type.name === 'heading'

    if (
        !isItem
        && !isText
    )
        return false

    if (
        isText
        && ['list_item', 'section'].includes(at.parent.type.name)
        && at.index() === 0
    )
        return false

    const after = entry.pos + entry.node.nodeSize

    if (
        !isItem
        || style.type === 'bullet_list'
    ) {
        const inserted = isItem
            ? newPlainItem(state)
            : newBlock(state, style)

        if (
            isItem
            && at.parent.type.name !== 'bullet_list'
        )
            return false

        if (!at.parent.canReplace(
            at.index() + 1,
            at.index() + 1,
            Fragment.from(inserted),
        ))
            return false

        if (dispatch) {
            const tr = state.tr.insert(after, inserted)
            selectInserted(
                tr,
                after,
                inserted.type.name,
            )
            dispatch(
                tr.scrollIntoView(),
            )
        }

        return true
    }

    if (at.parent.type.name !== 'bullet_list')
        return false

    const list = at.parent
    const index = at.index()

    if (
        index !== list.childCount - 1
        || !['doc', 'section'].includes(at.node(-1).type.name)
    )
        return false

    const inserted = newBlock(state, style)
    const listEnd = at.after()
    const parent = at.node(-1)

    if (!parent.canReplace(
        at.index(-1) + 1,
        at.index(-1) + 1,
        Fragment.from(inserted),
    ))
        return false

    if (dispatch) {
        const tr = state.tr.insert(listEnd, inserted)
        selectInserted(
            tr,
            listEnd,
            inserted.type.name,
        )
        dispatch(
            tr.scrollIntoView(),
        )
    }

    return true
}

export const changeNestedListBlockStyle = (
    entryId: string,
    style: NestedListBlockStyle,
): Command =>
(state, dispatch) => {
    const entry = findNestedListEntry(state.doc, entryId)

    if (
        !entry
        || (entry.node.type.name !== 'paragraph' && entry.node.type.name !== 'heading')
    )
        return false

    const at = state.doc.resolve(entry.pos)

    if (
        ['list_item', 'section'].includes(at.parent.type.name)
        && at.index() === 0
    )
        return false

    if (style.type === 'bullet_list') {
        const paragraph = state.schema.nodes.paragraph.create(
            {
                entryId: entryId,
                bold: entry.node.attrs.bold,
            },
            entry.node.content,
        )
        const list = state.schema.nodes.bullet_list.create(
            { entryId: crypto.randomUUID() },
            newPlainItem(state, paragraph),
        )

        if (!at.parent.canReplace(
            at.index(),
            at.index() + 1,
            Fragment.from(list),
        ))
            return false

        if (dispatch) {
            const tr = state.tr.replaceWith(
                entry.pos,
                entry.pos + entry.node.nodeSize,
                list,
            )
            selectInserted(
                tr,
                entry.pos,
                'bullet_list',
            )
            dispatch(
                tr.scrollIntoView(),
            )
        }

        return true
    }

    if (dispatch)
        dispatch(
            state.tr.setNodeMarkup(
                entry.pos,
                state.schema.nodes[style.type],
                {
                    entryId,
                    bold: entry.node.attrs.bold,
                    ...(style.type === 'heading' ? { level: style.level } : {}),
                },
            ).scrollIntoView(),
        )

    return true
}

export const toggleNestedListBlockBold = (entryId: string): Command =>
(state, dispatch) => {
    const entry = findNestedListEntry(state.doc, entryId)

    if (!entry)
        return false

    const isItem = entry.node.type.name === 'list_item'
    const block = isItem ? entry.node.firstChild : entry.node

    if (
        !block
        || (block.type.name !== 'paragraph' && block.type.name !== 'heading')
    )
        return false

    if (dispatch)
        dispatch(
            state.tr.setNodeMarkup(
                entry.pos + (isItem ? 1 : 0),
                undefined,
                {
                    ...block.attrs,
                    bold: !block.attrs.bold,
                },
            ).scrollIntoView(),
        )

    return true
}
