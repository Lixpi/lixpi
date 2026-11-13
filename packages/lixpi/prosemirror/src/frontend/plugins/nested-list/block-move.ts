import {
    Fragment,
    type Node as ProseMirrorNode,
} from 'prosemirror-model'
import {
    PluginKey,
    TextSelection,
    type Command,
    type Transaction,
} from 'prosemirror-state'
import { assertNestedListDocument } from '../../../shared/nested-list.ts'
import { findNestedListEntry } from './commands.ts'
import {
    type NestedListMove,
} from './types.ts'

const moveTransactionKey = new PluginKey('nestedListMove')

export const isNestedListMoveTransaction = (transaction: Transaction): boolean => transaction.getMeta(moveTransactionKey) === true

const childrenOf = (node: ProseMirrorNode): ProseMirrorNode[] => {
    const children: ProseMirrorNode[] = []
    node.forEach(child => children.push(child))

    return children
}

const movable = (
    doc: ProseMirrorNode,
    entry: {
        node: ProseMirrorNode
        pos: number
    },
): boolean => {
    if (
        entry.node.type.name === 'list_item'
        || entry.node.type.name === 'section'
    )
        return true

    if (
        entry.node.type.name !== 'paragraph'
        && entry.node.type.name !== 'heading'
    )
        return false

    const position = doc.resolve(entry.pos)

    return !['list_item', 'section'].includes(position.parent.type.name) || position.index() !== 0
}

// Moves complete items or standalone blocks while keeping list rows together.
export const moveNestedListBlock = (move: NestedListMove): Command =>
(state, dispatch) => {
    const source = findNestedListEntry(state.doc, move.entryId)
    const target = findNestedListEntry(state.doc, move.targetEntryId)

    if (
        !source
        || !target
        || source.node.type.name === 'section'
        || !movable(state.doc, source)
        || !movable(state.doc, target)
        || (move.placement === 'inside' && !['list_item', 'section'].includes(target.node.type.name))
        || (target.pos >= source.pos && target.pos < source.pos + source.node.nodeSize)
    )
        return false

    const sourceIsItem = source.node.type.name === 'list_item'

    if (
        !sourceIsItem
        && target.node.type.name === 'list_item'
    ) {
        const at = state.doc.resolve(target.pos)

        if (
            move.placement === 'inside'
            || at.parent.type.name !== 'bullet_list'
            || !['doc', 'section'].includes(at.node(-1).type.name)
            || (move.placement === 'before' && at.index() !== 0)
            || (move.placement === 'after' && at.index() !== at.parent.childCount - 1)
        )
            return false
    }

    const remove = (node: ProseMirrorNode): ProseMirrorNode | undefined => {
        if (node.attrs.entryId === move.entryId)
            return undefined

        if (node.isText)
            return node

        const children = childrenOf(node).flatMap(child => {
            const retained = remove(child)

            return retained ? [retained] : []
        })

        if (
            node.type.name === 'bullet_list'
            && !children.length
        )
            return undefined

        return node.copy(
            Fragment.fromArray(children),
        )
    }
    const list = (items: ProseMirrorNode[]): ProseMirrorNode => state.schema.nodes.bullet_list.create({ entryId: crypto.randomUUID() }, items)
    const insert = (node: ProseMirrorNode): ProseMirrorNode[] => {
        if (node.isText)
            return [node]

        const children = childrenOf(node)

        if (
            node.type.name === 'bullet_list'
            && !sourceIsItem
            && move.placement !== 'inside'
        ) {
            const targetIndex = children.findIndex(child => child.attrs.entryId === move.targetEntryId)

            if (targetIndex >= 0)
                return move.placement === 'before'
                    ? [source.node, node]
                    : [node, source.node]
        }

        let content = children.flatMap(insert)

        if (
            node.attrs.entryId === move.targetEntryId
            && move.placement === 'inside'
        ) {
            const last = content.at(-1)

            if (
                sourceIsItem
                && last?.type.name === 'bullet_list'
            )
                content = [
                    ...content.slice(0, -1),
                    last.copy(
                        last.content.append(
                            Fragment.from(source.node),
                        ),
                    ),
                ]
            else
                content.push(sourceIsItem ? list([source.node]) : source.node)
        }

        const updated = node.copy(
            Fragment.fromArray(content),
        )

        if (
            node.attrs.entryId !== move.targetEntryId
            || move.placement === 'inside'
        )
            return [updated]

        const inserted = sourceIsItem
            && node.type.name !== 'list_item'
            ? list([source.node])
            : source.node

        return move.placement === 'before'
            ? [inserted, updated]
            : [updated, inserted]
    }
    const retained = remove(state.doc)

    if (!retained)
        return false

    const next = insert(retained)[0]

    try {
        assertNestedListDocument(next)
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
                tr.doc.resolve(moved.pos + (sourceIsItem ? 2 : 1)),
            ),
        )
        dispatch(
            tr.setMeta(moveTransactionKey, true).scrollIntoView(),
        )
    }

    return true
}
