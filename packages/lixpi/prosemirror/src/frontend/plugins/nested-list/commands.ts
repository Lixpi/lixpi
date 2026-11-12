import {
    Fragment,
    type Node as ProseMirrorNode,
} from 'prosemirror-model'
import {
    TextSelection,
    type Command,
    type Transaction,
} from 'prosemirror-state'
import { splitBlock } from 'prosemirror-commands'
import { splitListItem } from 'prosemirror-schema-list'
import { PLAIN_LIST_ITEM_TYPE } from '../../../shared/nested-list.ts'
import {
    type NestedListMove,
} from './types.ts'

export const findNestedListEntry = (
    doc: ProseMirrorNode,
    entryId: string,
): {
    node: ProseMirrorNode
    pos: number
} | undefined => {
    let found: {
        node: ProseMirrorNode
        pos: number
    } | undefined
    doc.descendants((node, pos) => {
        if (node.attrs.entryId === entryId)
            found = {
                node,
                pos,
            }

        return !found
    })

    return found
}

export const identifyNestedListTransaction = (tr: Transaction): Transaction => {
    const seen = new Set<string>()
    tr.doc.descendants((node, pos) => {
        if (!('entryId' in node.attrs))
            return

        const id = node.attrs.entryId

        if (
            !id
            || seen.has(id)
        ) {
            if (
                id
                && (node.type.name === 'list_item' || node.type.name === 'section')
                && node.attrs.itemType !== PLAIN_LIST_ITEM_TYPE
            )
                return

            const entryId = crypto.randomUUID()
            tr.setNodeMarkup(
                pos,
                undefined,
                {
                    ...node.attrs,
                    entryId,
                },
            )
            seen.add(entryId)
        } else
            seen.add(id)
    })

    return tr
}

// Section body blocks split in place without changing the section title.
export const splitNestedListBodyBlock: Command = (
    state,
    dispatch,
) => {
    const { $from } = state.selection

    if (
        !$from.parent.isTextblock
        || $from.depth < 2
        || $from.node(-1).type.name !== 'section'
        || $from.index(-1) === 0
    )
        return false

    return splitBlock(state, dispatch)
}

// The stock split command copies item attributes on a mid-text split.
export const splitNestedListItem: Command = (
    state,
    dispatch,
) => {
    const { $from } = state.selection

    if (
        $from.parent.type.name !== 'paragraph'
        || $from.depth < 2
        || $from.node(-1).type.name !== 'list_item'
        || $from.index(-1) !== 0
    )
        return false

    return splitListItem(state.schema.nodes.list_item)(
        state,
        dispatch && (tr => {
            const seen = new Set<string>()
            tr.doc.descendants((node, pos) => {
                const id = node.attrs.entryId

                if (
                    node.type.name !== 'list_item'
                    || !id
                )
                    return

                if (seen.has(id))
                    tr.setNodeMarkup(
                        pos,
                        undefined,
                        {
                            entryId: null,
                            itemType: PLAIN_LIST_ITEM_TYPE,
                            data: null,
                            tagIds: [],
                        },
                    )
                else
                    seen.add(id)
            })
            dispatch(
                identifyNestedListTransaction(tr),
            )
        }),
    )
}

const childrenOf = (node: ProseMirrorNode): ProseMirrorNode[] => {
    const children: ProseMirrorNode[] = []
    node.forEach(child => children.push(child))

    return children
}

// Moves an entire item subtree. It never calls a consumer or writes storage.
export const moveNestedListItem = (move: NestedListMove): Command =>
(state, dispatch) => {
    const source = findNestedListEntry(state.doc, move.entryId)
    const target = findNestedListEntry(state.doc, move.targetEntryId)

    if (
        !source
        || !target
        || source.node.type.name !== 'list_item'
        || target.node.type.name !== 'list_item'
    )
        return false

    if (
        target.pos >= source.pos
        && target.pos < source.pos + source.node.nodeSize
    )
        return false

    const remove = (node: ProseMirrorNode): ProseMirrorNode | undefined => {
        if (node.attrs.entryId === move.entryId)
            return undefined

        if (node.isText)
            return node

        const content = childrenOf(node).flatMap(child => {
            const next = remove(child)

            return next ? [next] : []
        })

        if (
            node.type.name === 'bullet_list'
            && content.length === 0
        )
            return undefined

        return node.type.create(
            node.attrs,
            content,
            node.marks,
        )
    }
    const insert = (node: ProseMirrorNode): ProseMirrorNode => {
        if (node.isText)
            return node

        let content = childrenOf(node).flatMap(child => {
            const next = insert(child)

            if (
                child.attrs.entryId !== move.targetEntryId
                || move.placement === 'inside'
            )
                return [next]

            return move.placement === 'before' ? [source.node, next] : [next, source.node]
        })

        if (
            node.attrs.entryId === move.targetEntryId
            && move.placement === 'inside'
        ) {
            const last = content.at(-1)

            if (last?.type.name === 'bullet_list')
                content = [...content.slice(0, -1), last.copy(
                    last.content.append(
                        Fragment.from(source.node),
                    ),
                )]
            else
                content.push(
                    state.schema.nodes.bullet_list.create({ entryId: crypto.randomUUID() }, source.node),
                )
        }

        return node.type.create(
            node.attrs,
            content,
            node.marks,
        )
    }
    const next = insert(remove(state.doc)!)

    try {
        next.check()
    } catch {
        return false
    }

    if (next.eq(state.doc))
        return false

    if (dispatch) {
        const tr = state.tr.replaceWith(
            0,
            state.doc.content.size,
            next.content,
        )
        const moved = findNestedListEntry(tr.doc, move.entryId)!
        tr.setSelection(
            TextSelection.near(
                tr.doc.resolve(moved.pos + 2),
            ),
        )
        dispatch(
            tr.scrollIntoView(),
        )
    }

    return true
}

// Explicit removal is still subject to the caller's transaction guard.
export const deleteNestedListItem = (entryId: string): Command =>
(state, dispatch) => {
    const entry = findNestedListEntry(state.doc, entryId)

    if (entry?.node.type.name !== 'list_item')
        return false

    const remove = (node: ProseMirrorNode): ProseMirrorNode | undefined => {
        if (node.attrs.entryId === entryId)
            return undefined

        if (node.isText)
            return node

        const content = childrenOf(node).flatMap(child => {
            const next = remove(child)

            return next ? [next] : []
        })

        if (
            node.type.name === 'bullet_list'
            && content.length === 0
        )
            return undefined

        if (
            node.type === state.schema.topNodeType
            && content.length === 0
        )
            content.push(
                state.schema.nodes.paragraph.create({ entryId: crypto.randomUUID() }),
            )

        return node.type.create(
            node.attrs,
            content,
            node.marks,
        )
    }
    const next = remove(state.doc)!
    next.check()

    if (dispatch)
        dispatch(
            state.tr.replaceWith(
                0,
                state.doc.content.size,
                next.content,
            ).scrollIntoView(),
        )

    return true
}

export type NestedListTextBlock = {
    type: 'paragraph' | 'heading'
    text?: string
    level?: 1 | 2 | 3
}

// Standalone text can precede a complete list, never split its rows.
// Its text is selected so the next keystroke replaces a placeholder.
export const insertNestedListBlockBefore = (
    entryId: string,
    block: NestedListTextBlock,
): Command =>
(state, dispatch) => {
    const entry = findNestedListEntry(state.doc, entryId)

    if (entry?.node.type.name !== 'list_item')
        return false

    const at = state.doc.resolve(entry.pos)
    const list = at.parent

    if (list.type.name !== 'bullet_list')
        return false

    const index = at.index()

    if (
        index !== 0
        || !['doc', 'section'].includes(at.node(-1).type.name)
    )
        return false

    const text = block.text ?? ''
    const inserted = state.schema.nodes[block.type].create(
        {
            entryId: crypto.randomUUID(),
            ...(block.type === 'heading' ? { level: block.level ?? 1 } : {}),
        },
        text ? state.schema.text(text) : undefined,
    )
    const listPos = at.before()

    if (!at.node(-1).canReplace(
        at.index(-1),
        at.index(-1),
        Fragment.from(inserted),
    ))
        return false

    if (dispatch) {
        const tr = state.tr.insert(listPos, inserted)
        const start = listPos + 1
        tr.setSelection(
            TextSelection.create(
                tr.doc,
                start,
                start + text.length,
            ),
        )
        dispatch(
            tr.scrollIntoView(),
        )
    }

    return true
}
