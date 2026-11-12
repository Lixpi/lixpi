import {
    WORKSPACE_OUTLINE_TEXT_MAX_LENGTH,
    WORKSPACE_TREE_ERROR,
    type WorkspaceMeta,
    type WorkspaceNavigationDocument,
} from '@lixpi/constants'
import {
    assertNestedListDocument,
    createNestedListSchema,
} from '@lixpi/prosemirror/shared/nested-list'
import { WorkspaceTreeError } from './workspace-tree-errors.ts'
import {
    type WorkspaceTreeRow,
} from './workspace-tree-repository.ts'

export type NavigationEntry = {
    node: WorkspaceNavigationDocument
    parentId: string
    ancestorIds: string[]
}

export type NavigationProjectionEntry = {
    entryId: string
    entryType: 'workspace' | 'heading'
    parentWorkspaceId?: string
    ancestorIds: string[]
    name: string
    tagIds: string[]
    level: 0 | 1 | 2 | 3
}

const ROOT = '$navigation-root'
const schema = createNestedListSchema()
export const navigationEntryId = (node: WorkspaceNavigationDocument): string => node.attrs?.entryId as string
export const navigationWorkspaceId = (node: WorkspaceNavigationDocument): string | undefined => node.type === 'list_item'
    && node.attrs?.itemType === 'workspace'
    ? (node.attrs.data as { workspaceId: string }).workspaceId
    : undefined

export const navigationText = (node: WorkspaceNavigationDocument): string => node.text ?? (node.content ?? []).map(navigationText).join('')

export const validateNavigationDocument = (document: WorkspaceNavigationDocument): WorkspaceNavigationDocument => {
    try {
        const parsed = schema.nodeFromJSON(document)
        assertNestedListDocument(parsed)
        parsed.descendants(node => {
            if (node.isText)
                return

            if (node.type.name === 'section')
                throw new Error('Navigation sections belong only to the composed editor')

            if (
                typeof node.attrs.entryId !== 'string'
                || !node.attrs.entryId
                || node.attrs.entryId === ROOT
            )
                throw new Error('Every navigation block needs a stable identity')

            if (
                node.textContent.length > WORKSPACE_OUTLINE_TEXT_MAX_LENGTH
                && (node.type.name === 'paragraph' || node.type.name === 'heading')
            )
                throw new Error('Navigation text is too long')

            if (node.type.name !== 'list_item')
                return

            if (node.attrs.itemType === 'workspace') {
                const data = node.attrs.data

                if (
                    !data
                    || typeof data.workspaceId !== 'string'
                    || data.workspaceId !== node.attrs.entryId
                    || Object.keys(data).length !== 1
                )
                    throw new Error('Invalid workspace binding')
            } else if (
                node.attrs.itemType !== 'text'
                || node.attrs.data !== null
            )
                throw new Error('Unknown navigation item type')
        })

        return parsed.toJSON() as WorkspaceNavigationDocument
    } catch {
        throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_INVALID')
    }
}

export const equalNavigationDocuments = (
    left: WorkspaceNavigationDocument,
    right: WorkspaceNavigationDocument,
): boolean => schema.nodeFromJSON(left).eq(
    schema.nodeFromJSON(right),
)

export const indexNavigationDocument = (document: WorkspaceNavigationDocument): Map<string, NavigationEntry> => {
    const entries = new Map<string, NavigationEntry>()
    const visit = (
        node: WorkspaceNavigationDocument,
        parentId: string,
        ancestorIds: string[],
    ): void => {
        if (node.type === 'text')
            return

        const id = node.type === 'doc' ? ROOT : navigationEntryId(node)
        entries.set(
            id,
            {
                node,
                parentId,
                ancestorIds,
            },
        )
        const workspaceId = navigationWorkspaceId(node)

        for (const child of node.content ?? [])
            visit(
                child,
                id,
                workspaceId ? [...ancestorIds, workspaceId] : ancestorIds,
            )
    }
    visit(
        document,
        '',
        [],
    )

    return entries
}

export const navigationProjectionEntries = (document: WorkspaceNavigationDocument): NavigationProjectionEntry[] => {
    const entries: NavigationProjectionEntry[] = []
    const visit = (
        node: WorkspaceNavigationDocument,
        ancestorIds: string[],
        label = false,
    ): void => {
        const workspaceId = navigationWorkspaceId(node)

        if (
            workspaceId
            || node.type === 'list_item'
            || (!label && (node.type === 'paragraph' || node.type === 'heading'))
        ) {
            entries.push({
                entryId: navigationEntryId(node),
                entryType: workspaceId ? 'workspace' : 'heading',
                parentWorkspaceId: ancestorIds.at(-1),
                ancestorIds,
                name: node.type === 'list_item' ? navigationText(node.content![0]) : navigationText(node),
                tagIds: (node.attrs?.tagIds ?? []) as string[],
                level: node.type === 'heading' ? node.attrs!.level as 1 | 2 | 3 : 0,
            })
        }

        for (const [index, child] of (node.content ?? []).entries())
            visit(
                child,
                workspaceId ? [...ancestorIds, workspaceId] : ancestorIds,
                node.type === 'list_item' && index === 0,
            )
    }
    visit(document, [])

    return entries
}

export const projectNavigationDocument = (
    document: WorkspaceNavigationDocument,
    visibleWorkspaceIds: Set<string>,
    organizationMember: boolean,
    visibleHeadingIds?: Set<string>,
): WorkspaceNavigationDocument => {
    const visit = (
        node: WorkspaceNavigationDocument,
        textVisible: boolean,
    ): WorkspaceNavigationDocument[] => {
        const workspaceId = navigationWorkspaceId(node)

        if (
            node.type === 'heading'
            && visibleHeadingIds
            && !visibleHeadingIds.has(
                navigationEntryId(node),
            )
        )
            return []

        if (
            node.type === 'list_item'
            && !workspaceId
        ) {
            const descendants = navigationProjectionEntries({
                type: 'doc',
                content: [node],
            }).filter(entry => entry.entryType === 'workspace')

            if (
                descendants.length
                && descendants.every(entry => !visibleWorkspaceIds.has(entry.entryId))
            )
                return []
        }

        if (
            workspaceId
            && !visibleWorkspaceIds.has(workspaceId)
        )
            return (node.content ?? []).flatMap(child => visit(child, false)).flatMap(
                child => (child.type === 'bullet_list' ? (child.content ?? []) : []),
            )

        if (node.type === 'text')
            return textVisible ? [structuredClone(node)] : []

        if (
            !textVisible
            && node.type === 'list_item'
            && !workspaceId
        )
            return (node.content ?? []).flatMap(child => visit(child, false)).flatMap(
                child => (child.type === 'bullet_list' ? (child.content ?? []) : []),
            )

        if (
            !textVisible
            && (node.type === 'paragraph' || node.type === 'heading')
        )
            return []

        const content = (node.content ?? []).flatMap(child => visit(child, Boolean(workspaceId) || textVisible))

        if (
            node.type === 'bullet_list'
            && !content.length
        )
            return []

        return [{
            ...structuredClone(node),
            content,
        }]
    }
    const projected = visit(document, organizationMember)[0]

    if (!projected.content?.length)
        projected.content = [{
            type: 'paragraph',
            attrs: { entryId: 'navigation-empty' },
            content: [],
        }]

    return projected
}

const plainItem = (
    entryId: string,
    label: WorkspaceNavigationDocument,
): WorkspaceNavigationDocument => ({
    type: 'list_item',
    attrs: {
        entryId,
        itemType: 'text',
        data: null,
        tagIds: [],
    },
    content: [label],
})

const block = (
    type: string,
    entryId: string,
    text = '',
    attrs: Record<string, any> = {},
): WorkspaceNavigationDocument => ({
    type,
    attrs: {
        entryId,
        ...attrs,
    },
    content: text ? [{
        type: 'text',
        text,
    }] : [],
})

export const createEmptyNavigationDocument = (createId: () => string): WorkspaceNavigationDocument => ({
    type: 'doc',
    content: [block(
        'paragraph',
        createId(),
    )],
})

// Applies stable block identities to the complete document. Invisible blocks
// keep their original parents and sibling anchors. A promoted visible root
// retains its inaccessible workspace parent unless its workspace parent is
// explicitly changed in the submitted projection.
export const mergeNavigationProjection = (
    full: WorkspaceNavigationDocument,
    baseline: WorkspaceNavigationDocument,
    submitted: WorkspaceNavigationDocument,
    deletedWorkspaceIds: Set<string>,
    createId: () => string,
): WorkspaceNavigationDocument => {
    const fullIndex = indexNavigationDocument(full)
    const baseIndex = indexNavigationDocument(baseline)
    const nextIndex = indexNavigationDocument(submitted)
    const merged = new Map<string, NavigationEntry>()
    const deleted = new Set<string>()

    for (const [id, entry] of fullIndex)
        if (
            deletedWorkspaceIds.has(id)
            || entry.ancestorIds.some(ancestor => deletedWorkspaceIds.has(ancestor))
        )
            deleted.add(id)

    // Surviving submitted nodes may have moved out of an explicitly deleted
    // workspace. Their identities and complete subtrees remain available.
    for (const [id, entry] of nextIndex)
        if (!deletedWorkspaceIds.has(id))
            deleted.delete(id)

    for (const [id, entry] of fullIndex)
        if (
            !deleted.has(id)
            && (!baseIndex.has(id) || nextIndex.has(id))
        )
            merged.set(
                id,
                structuredClone(entry),
            )

    for (const [id, next] of nextIndex) {
        const original = fullIndex.get(id)
        const base = baseIndex.get(id)

        if (
            original
            && !base
            && id !== ROOT
        )
            throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_HIDDEN_ENTRY')

        let parentId = next.parentId

        if (
            original
            && base
        ) {
            const promoted = navigationWorkspaceId(original.node)
                && original.ancestorIds.at(-1) !== base.ancestorIds.at(-1)

            if (
                promoted
                && next.ancestorIds.at(-1) === base.ancestorIds.at(-1)
            ) {
                if (next.parentId !== base.parentId)
                    throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_HIDDEN_PARENT')

                parentId = original.parentId
            } else if (
                original.parentId !== base.parentId
                && next.parentId === base.parentId
            )
                parentId = original.parentId
        }

        merged.set(
            id,
            {
                ...structuredClone(next),
                parentId,
            },
        )
    }

    // Deleted visual groups lift their retained, hidden children to the next
    // surviving container without deleting or reparenting a workspace domain.
    for (const entry of merged.values()) {
        const seen = new Set<string>()

        while (
            entry.parentId
            && !merged.has(entry.parentId)
        ) {
            if (seen.has(entry.parentId))
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.CYCLE)

            seen.add(entry.parentId)
            entry.parentId = fullIndex.get(entry.parentId)?.parentId ?? ROOT
        }
    }

    const building = new Set<string>()
    const build = (id: string): WorkspaceNavigationDocument => {
        if (building.has(id))
            throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.CYCLE)

        building.add(id)
        const entry = merged.get(id)!
        const originalChildren = (fullIndex.get(id)?.node.content ?? []).filter(node => node.type !== 'text').map(navigationEntryId)
        const desiredChildren = (nextIndex.get(id)?.node.content ?? []).filter(node => node.type !== 'text').map(navigationEntryId)
        const candidates = [...merged].filter(([, child]) => child.parentId === id).map(([childId]) => childId)
        const ordered = desiredChildren.filter(childId => candidates.includes(childId))

        for (const childId of originalChildren.filter(candidate => candidates.includes(candidate) && !ordered.includes(candidate))) {
            const prior = originalChildren
                .slice(
                    0,
                    originalChildren.indexOf(childId),
                )
                .reverse().find(candidate => ordered.includes(candidate))
            ordered.splice(
                prior ? ordered.indexOf(prior) + 1 : 0,
                0,
                childId,
            )
        }

        ordered.push(...candidates.filter(childId => !ordered.includes(childId)))
        let content = ordered.map(build)

        if (
            entry.node.type === 'paragraph'
            || entry.node.type === 'heading'
        )
            content = structuredClone(entry.node.content ?? [])

        if (entry.node.type !== 'bullet_list') {
            const normalized: WorkspaceNavigationDocument[] = []

            for (const child of content) {
                if (child.type !== 'list_item') {
                    normalized.push(child)

                    continue
                }

                if (normalized.at(-1)?.type !== 'bullet_list')
                    normalized.push({
                        type: 'bullet_list',
                        attrs: { entryId: createId() },
                        content: [],
                    })

                normalized.at(-1)!.content!.push(child)
            }

            content = normalized
        }

        content = content.filter(child => child.type !== 'bullet_list' || child.content?.length)
        building.delete(id)

        return {
            ...entry.node,
            content,
        }
    }
    const result = build(ROOT)

    if (!result.content?.length)
        result.content = [block(
            'paragraph',
            createId(),
        )]

    if (building.size)
        throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.CYCLE)

    return validateNavigationDocument(result)
}

// Synchronizes existing domain mutation APIs without rebuilding ordinary
// document blocks. Only domain entries whose parent/order changed are moved.
export const reconcileNavigationProjection = (
    document: WorkspaceNavigationDocument,
    rowsByParent: Map<string | undefined, WorkspaceTreeRow[]>,
    metas: Map<string, WorkspaceMeta>,
    createId: () => string,
): WorkspaceNavigationDocument => {
    const next = structuredClone(document)
    const desiredRows = [...rowsByParent.values()].flat()
    const wanted = new Map(
        desiredRows.map(row => [row.entryId, row]),
    )
    const nodes = new Map<string, WorkspaceNavigationDocument>()
    const parentNodes = new Map<string, WorkspaceNavigationDocument>()
    const collect = (node: WorkspaceNavigationDocument): void => {
        if (node.attrs?.entryId)
            nodes.set(
                navigationEntryId(node),
                node,
            )

        for (const child of node.content ?? []) {
            if (child.attrs?.entryId)
                parentNodes.set(
                    navigationEntryId(child),
                    node,
                )

            collect(child)
        }
    }
    collect(next)
    const detach = (id: string): void => {
        const parent = parentNodes.get(id)

        if (parent)
            parent.content = (parent.content ?? []).filter(child => navigationEntryId(child) !== id)
    }
    const detachPlainItem = (id: string): void => {
        const parent = parentNodes.get(id)
        const node = nodes.get(id)
        const index = parent?.content?.findIndex(child => navigationEntryId(child) === id) ?? -1

        if (
            !parent
            || !node
            || index < 0
        )
            return

        const children = (node.content ?? []).filter(child => child.type === 'bullet_list').flatMap(child => child.content ?? [])
        parent.content!.splice(
            index,
            1,
            ...children,
        )

        for (const child of children)
            parentNodes.set(
                navigationEntryId(child),
                parent,
            )
    }

    for (const entry of navigationProjectionEntries(next)) {
        if (!wanted.has(entry.entryId)) {
            if (
                nodes.get(entry.entryId)?.type === 'list_item'
                && entry.entryType === 'heading'
            )
                detachPlainItem(entry.entryId)
            else
                detach(entry.entryId)

            continue
        }

        const row = wanted.get(entry.entryId)!
        const node = nodes.get(entry.entryId)!
        const meta = metas.get(entry.entryId)

        if (
            entry.entryType === 'workspace'
            && meta
        ) {
            node.attrs!.tagIds = meta.tagIds ?? []
            node.content![0].content = meta.name ? [{
                type: 'text',
                text: meta.name,
            }] : []
        } else if (entry.entryType === 'heading') {
            const label = node.type === 'list_item' ? node.content![0] : node
            label.content = row.name ? [{
                type: 'text',
                text: row.name,
            }] : []

            if (node.type !== 'list_item') {
                node.type = row.level ? 'heading' : 'paragraph'
                node.attrs = {
                    ...node.attrs,
                    entryId: row.entryId,
                }

                if (row.level)
                    node.attrs.level = row.level
                else
                    delete node.attrs.level
            }
        }
    }

    const projection = navigationProjectionEntries(next)
    const projectionById = new Map(
        projection.map(entry => [entry.entryId, entry]),
    )
    const orders = new Map<string | undefined, string[]>()
    const immediateChild = (
        node: WorkspaceNavigationDocument,
        container: WorkspaceNavigationDocument,
    ): WorkspaceNavigationDocument | undefined => {
        let current = node

        while (true) {
            const parent = parentNodes.get(
                navigationEntryId(current),
            )

            if (parent === container)
                return current

            if (!parent)
                return undefined

            current = parent
        }
    }

    for (const entry of projection) {
        const order = orders.get(entry.parentWorkspaceId) ?? []
        order.push(entry.entryId)
        orders.set(entry.parentWorkspaceId, order)
    }

    for (const [parentId, rows] of rowsByParent) {
        let previous: WorkspaceNavigationDocument | undefined

        for (const row of rows) {
            let node = nodes.get(row.entryId)
            const oldEntry = projectionById.get(row.entryId)

            if (!node) {
                if (row.entryType === 'workspace') {
                    const meta = metas.get(row.entryId)!
                    node = {
                        type: 'list_item',
                        attrs: {
                            entryId: row.entryId,
                            itemType: 'workspace',
                            data: { workspaceId: row.entryId },
                            tagIds: meta.tagIds ?? [],
                        },
                        content: [block(
                            'paragraph',
                            createId(),
                            meta.name,
                        )],
                    }
                } else if (parentId)
                    node = plainItem(
                        row.entryId,
                        block(
                            'paragraph',
                            createId(),
                            row.name ?? '',
                        ),
                    )
                else
                    node = block(
                        row.level ? 'heading' : 'paragraph',
                        row.entryId,
                        row.name ?? '',
                        row.level ? { level: row.level } : {},
                    )

                nodes.set(row.entryId, node)
            } else if (
                row.entryType === 'heading'
                && parentId
                && node.type === 'paragraph'
            ) {
                node = plainItem(
                    row.entryId,
                    {
                        ...structuredClone(node),
                        attrs: {
                            ...node.attrs,
                            entryId: createId(),
                        },
                    },
                )
                nodes.set(row.entryId, node)
            } else if (
                row.entryType === 'heading'
                && !parentId
                && oldEntry?.parentWorkspaceId
                && node.type === 'list_item'
            ) {
                node = {
                    ...structuredClone(node.content![0]),
                    attrs: {
                        ...node.content![0].attrs,
                        entryId: row.entryId,
                    },
                }
                nodes.set(row.entryId, node)
            }

            const currentOrder = orders.get(parentId) ?? []
            orders.set(parentId, currentOrder)
            const previousId = previous ? navigationEntryId(previous) : undefined
            const expectedIndex = previousId ? currentOrder.indexOf(previousId) + 1 : 0

            if (
                !oldEntry
                || oldEntry.parentWorkspaceId !== parentId
                || currentOrder.indexOf(row.entryId) !== expectedIndex
            ) {
                detach(row.entryId)
                const container = parentId ? nodes.get(parentId)! : next
                const nextRow = rows.slice(rows.indexOf(row) + 1).find(candidate => nodes.has(candidate.entryId))
                const nextNode = nextRow ? nodes.get(nextRow.entryId) : undefined
                const nextParent = nextRow ? parentNodes.get(nextRow.entryId) : undefined
                const sourceOrder = orders.get(oldEntry?.parentWorkspaceId)

                if (sourceOrder?.includes(row.entryId))
                    sourceOrder.splice(
                        sourceOrder.indexOf(row.entryId),
                        1,
                    )

                const insertAt = previousId ? currentOrder.indexOf(previousId) + 1 : 0
                currentOrder.splice(
                    insertAt,
                    0,
                    row.entryId,
                )

                if (
                    node.type !== 'list_item'
                    && container.type === 'doc'
                ) {
                    const before = nextNode ? immediateChild(nextNode, container) : undefined
                    const after = previous ? immediateChild(previous, container) : undefined
                    const anchor = before
                        && before !== after
                        ? before
                        : undefined
                    const index = anchor
                        ? container.content!.indexOf(anchor)
                        : after
                            ? container.content!.indexOf(after) + 1
                            : container.content!.length
                    container.content!.splice(
                        index,
                        0,
                        node,
                    )
                    parentNodes.set(row.entryId, container)
                } else if (
                    !previous
                    && nextNode
                    && nextParent
                    && (nextParent.type === 'bullet_list') === (node.type === 'list_item')
                ) {
                    nextParent.content!.splice(
                        nextParent.content!.indexOf(nextNode),
                        0,
                        node,
                    )
                    parentNodes.set(row.entryId, nextParent)
                } else if (
                    previous
                    && parentNodes.get(
                        navigationEntryId(previous),
                    )?.type === (node.type === 'list_item' ? 'bullet_list' : container.type)
                ) {
                    const parent = parentNodes.get(
                        navigationEntryId(previous),
                    )!
                    parent.content!.splice(
                        parent.content!.indexOf(previous) + 1,
                        0,
                        node,
                    )
                    parentNodes.set(row.entryId, parent)
                } else if (node.type === 'list_item') {
                    const list = {
                        type: 'bullet_list',
                        attrs: { entryId: createId() },
                        content: [node],
                    }
                    const anchor = nextNode ? immediateChild(nextNode, container) : undefined
                    const index = anchor ? container.content!.indexOf(anchor) : container.content!.length
                    container.content!.splice(
                        index,
                        0,
                        list,
                    )
                    parentNodes.set(row.entryId, list)
                } else {
                    container.content!.push(node)
                    parentNodes.set(row.entryId, container)
                }
            }

            previous = node
        }
    }

    const prune = (node: WorkspaceNavigationDocument): void => {
        node.content?.forEach(prune)
        node.content = node.content?.filter(child => child.type !== 'bullet_list' || child.content?.length)
    }
    prune(next)

    if (!next.content?.length)
        next.content = [block(
            'paragraph',
            createId(),
        )]

    return validateNavigationDocument(next)
}
