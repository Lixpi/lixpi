import {
    Fragment,
    type Node as ProseMirrorNode,
} from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import {
    type EditorView,
} from 'prosemirror-view'
import { findNestedListEntry } from '@lixpi/prosemirror/frontend/nested-list'

const selectText = (
    view: EditorView,
    entryId: string,
    length: number,
): void => {
    const found = findNestedListEntry(view.state.doc, entryId)

    if (!found)
        return

    view.dispatch(
        view.state.tr.setSelection(
            TextSelection.create(
                view.state.doc,
                found.pos + 1,
                found.pos + 1 + length,
            ),
        ),
    )
    view.focus()
}

export const insertWorkspaceItem = (
    view: EditorView,
    parentEntryId: string,
    workspaceId: string,
    name: string,
): boolean => {
    const parent = findNestedListEntry(view.state.doc, parentEntryId)

    if (
        !parent
        || !['list_item', 'section'].includes(parent.node.type.name)
    )
        return false

    const schema = view.state.schema
    const title = schema.nodes.paragraph.create({ entryId: crypto.randomUUID() }, name ? schema.text(name) : undefined)
    const item = schema.nodes.list_item.create(
        {
            entryId: workspaceId,
            itemType: 'workspace',
            data: { workspaceId },
            tagIds: [],
        },
        title,
    )
    const last = parent.node.lastChild
    const tr = view.state.tr

    if (last?.type.name === 'bullet_list') {
        const listPos = parent.pos + parent.node.nodeSize - last.nodeSize - 1
        tr.insert(listPos + last.nodeSize - 1, item)
    } else {
        const list = schema.nodes.bullet_list.create({ entryId: crypto.randomUUID() }, item)
        tr.insert(parent.pos + parent.node.nodeSize - 1, list)
    }

    const before = view.state.doc
    view.dispatch(tr)

    if (view.state.doc.eq(before))
        return false

    selectText(
        view,
        String(title.attrs.entryId),
        name.length,
    )

    return true
}

export const insertWorkspaceItemAfter = (
    view: EditorView,
    targetEntryId: string,
    workspaceId: string,
    name: string,
): boolean => {
    const target = findNestedListEntry(view.state.doc, targetEntryId)

    if (
        !target
        || !['list_item', 'paragraph', 'heading'].includes(target.node.type.name)
    )
        return false

    const at = view.state.doc.resolve(target.pos)

    if (
        target.node.type.name !== 'list_item'
        && at.parent.type.name === 'list_item'
        && at.index() === 0
    )
        return false

    const schema = view.state.schema
    const title = schema.nodes.paragraph.create({ entryId: crypto.randomUUID() }, name ? schema.text(name) : undefined)
    const item = schema.nodes.list_item.create(
        {
            entryId: workspaceId,
            itemType: 'workspace',
            data: { workspaceId },
            tagIds: [],
        },
        title,
    )
    const insertion = target.node.type.name === 'list_item'
        ? item
        : schema.nodes.bullet_list.create({ entryId: crypto.randomUUID() }, item)
    const position = target.pos + target.node.nodeSize

    if (!at.parent.canReplace(
        at.index() + 1,
        at.index() + 1,
        Fragment.from(insertion),
    ))
        return false

    const before = view.state.doc
    view.dispatch(
        view.state.tr.insert(position, insertion),
    )

    if (view.state.doc.eq(before))
        return false

    selectText(
        view,
        String(title.attrs.entryId),
        name.length,
    )

    return true
}

export const workspaceIdsInSubtree = (node: ProseMirrorNode): string[] => {
    const ids: string[] = []
    const add = (candidate: ProseMirrorNode): void => {
        if (
            candidate.type.name === 'list_item'
            && candidate.attrs.itemType === 'workspace'
        )
            ids.push(
                String(candidate.attrs.entryId),
            )
    }

    add(node)
    node.descendants(add)

    return ids
}
