import {
    type WorkspaceNavigationDocument,
    type WorkspaceNavigationSnapshot,
    type WorkspaceTreeEntry,
} from '@lixpi/constants'
import {
    type Node as ProseMirrorNode,
} from 'prosemirror-model'
import { isHistoryTransaction } from 'prosemirror-history'
import {
    type EditorState,
    type Transaction,
} from 'prosemirror-state'

export const WORKSPACE_ITEM_TYPE = 'workspace'
export const ORGANIZATION_ITEM_TYPE = 'workspace-organization'

export type WorkspaceNavigationEntry = {
    organizationId: string
    workspaceId: string
    editable: boolean
    owner: boolean
    name: string
}

export const workspaceNavigationEntries = (snapshots: Iterable<WorkspaceNavigationSnapshot>): Map<string, WorkspaceNavigationEntry> => {
    const result = new Map<string, WorkspaceNavigationEntry>()

    for (const snapshot of snapshots) {
        const visit = (entries: WorkspaceTreeEntry[]): void => {
            for (const entry of entries) {
                if (entry.entryType !== 'workspace')
                    continue

                result.set(
                    entry.workspace.workspaceId,
                    {
                        organizationId: snapshot.organizationId,
                        workspaceId: entry.workspace.workspaceId,
                        editable: entry.accessLevel === 'owner' || entry.accessLevel === 'editor',
                        owner: entry.accessLevel === 'owner',
                        name: entry.workspace.name,
                    },
                )
                visit(entry.children)
            }
        }
        visit(snapshot.tree.roots)
    }

    return result
}

const scopedBlockPrefix = (organizationId: string): string => `navigation-block:${encodeURIComponent(organizationId)}:`

const mapBlockIds = (
    node: WorkspaceNavigationDocument,
    map: (id: string) => string,
): WorkspaceNavigationDocument => ({
    ...node,
    ...(node.attrs
        && typeof node.attrs.entryId === 'string'
        && !(node.type === 'list_item' && node.attrs.itemType === WORKSPACE_ITEM_TYPE)
        ? { attrs: {
            ...node.attrs,
            entryId: map(node.attrs.entryId),
        } }
        : {}),
    ...(node.content ? { content: node.content.map(child => mapBlockIds(child, map)) } : {}),
})

const mapTags = (
    node: WorkspaceNavigationDocument,
    map: (id: string) => string,
): WorkspaceNavigationDocument => ({
    ...node,
    ...(node.attrs
        && Array.isArray(node.attrs.tagIds)
        ? { attrs: {
            ...node.attrs,
            tagIds: node.attrs.tagIds.map(
                id => map(
                    String(id),
                ),
            ),
        } }
        : {}),
    ...(node.content ? { content: node.content.map(child => mapTags(child, map)) } : {}),
})

// Organization wrappers belong only to the composed view. Each server snapshot
// remains an ordinary document with raw organization tag IDs.
export const composeWorkspaceNavigation = (snapshots: Iterable<WorkspaceNavigationSnapshot>): WorkspaceNavigationDocument => {
    const organizations = [...snapshots]

    if (!organizations.length)
        return {
            type: 'doc',
            content: [{
                type: 'paragraph',
                attrs: { entryId: 'navigation-empty' },
            }],
        }

    return {
        type: 'doc',
        content: organizations.map(
            snapshot => ({
                type: 'section',
                attrs: {
                    entryId: `navigation-organization:${snapshot.organizationId}`,
                    itemType: ORGANIZATION_ITEM_TYPE,
                    data: { organizationId: snapshot.organizationId },
                    tagIds: [],
                },
                content: [
                    {
                        type: 'paragraph',
                        attrs: { entryId: `navigation-organization-title:${snapshot.organizationId}` },
                        ...(snapshot.tree.organizationName
                                ? { content: [{
                                    type: 'text',
                                    text: snapshot.tree.organizationName,
                                }] }
                                : {}),
                    },
                    ...(mapBlockIds(
                        mapTags(snapshot.document, id => `${snapshot.organizationId}:${id}`),
                        id => `${scopedBlockPrefix(snapshot.organizationId)}${id}`,
                    ).content ?? []),
                ],
            }),
        ),
    }
}

export const splitWorkspaceNavigation = (
    doc: ProseMirrorNode,
    emptyBodyId: (organizationId: string) => string = () => crypto.randomUUID(),
): Map<string, WorkspaceNavigationDocument> => {
    const documents = new Map<string, WorkspaceNavigationDocument>()

    doc.forEach(organization => {
        if (
            organization.type.name !== 'section'
            || organization.attrs.itemType !== ORGANIZATION_ITEM_TYPE
        )
            return

        const organizationId = String(organization.attrs.data?.organizationId ?? '')
        const content: WorkspaceNavigationDocument[] = []
        organization.forEach((
            block,
            _offset,
            index,
        ) => {
            if (index > 0)
                content.push(
                    block.toJSON(),
                )
        })
        const prefix = `${organizationId}:`
        documents.set(
            organizationId,
            mapBlockIds(
                mapTags(
                    {
                        type: 'doc',
                        content: content.length ? content : [{
                            type: 'paragraph',
                            attrs: { entryId: emptyBodyId(organizationId) },
                        }],
                    },
                    id => id.startsWith(prefix) ? id.slice(prefix.length) : id,
                ),
                id => {
                    const scoped = scopedBlockPrefix(organizationId)

                    return id.startsWith(scoped) ? id.slice(scoped.length) : id
                },
            ),
        )
    })

    return documents
}

type Binding = {
    node: ProseMirrorNode
    organizationId: string
    parentWorkspaceId?: string
}

const bindings = (doc: ProseMirrorNode): Map<string, Binding> | undefined => {
    const result = new Map<string, Binding>()
    let valid = true
    const visit = (
        node: ProseMirrorNode,
        organizationId: string,
        parentWorkspaceId?: string,
    ): void => {
        let parent = parentWorkspaceId

        if (
            node.type.name === 'list_item'
            && node.attrs.itemType === WORKSPACE_ITEM_TYPE
        ) {
            const id = node.attrs.data?.workspaceId

            if (
                typeof id !== 'string'
                || id !== node.attrs.entryId
                || result.has(id)
            ) {
                valid = false

                return
            }

            result.set(
                id,
                {
                    node,
                    organizationId,
                    parentWorkspaceId,
                },
            )
            parent = id
        }

        node.forEach(
            child => visit(
                child,
                organizationId,
                parent,
            ),
        )
    }
    doc.forEach(
        organization => void visit(
            organization,
            String(organization.attrs.data?.organizationId ?? ''),
        ),
    )

    return valid ? result : undefined
}

export const workspaceIdsInDocument = (doc: ProseMirrorNode): Set<string> => new Set(bindings(doc)?.keys() ?? [])

export const findNavigationEntry = (
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
        if (node.attrs.entryId === entryId) {
            found = {
                node,
                pos,
            }

            return false
        }

        return !found
    })

    return found
}

// This policy protects application identities. The generic editor does not
// know workspaces, organizations or permissions.
export const workspaceNavigationGuard = (
    entries: () => ReadonlyMap<string, WorkspaceNavigationEntry>,
    explicitDeletions: () => ReadonlySet<string>,
    authorizedCreations: () => ReadonlySet<string> = () => new Set(),
    confirmedDeletions: () => ReadonlySet<string> = () => new Set(),
    explicitRemovals: () => ReadonlySet<string> = () => new Set(),
    forbiddenRestorations: () => ReadonlySet<string> = () => new Set(),
) =>
(transaction: Transaction, state: EditorState): boolean => {
    if (!transaction.docChanged)
        return true

    const before = state.doc
    const after = transaction.doc

    if (before.childCount !== after.childCount)
        return false

    for (let index = 0; index < before.childCount; index += 1) {
        const previous = before.child(index)
        const next = after.child(index)

        if (
            previous.type.name !== 'section'
            || next.type.name !== 'section'
            || previous.attrs.itemType !== ORGANIZATION_ITEM_TYPE
            || next.attrs.itemType !== ORGANIZATION_ITEM_TYPE
            || previous.attrs.entryId !== next.attrs.entryId
            || JSON.stringify(previous.attrs) !== JSON.stringify(next.attrs)
            || !previous.firstChild?.eq(next.firstChild!)
        )
            return false
    }

    const oldBindings = bindings(before)
    const newBindings = bindings(after)

    if (
        !oldBindings
        || !newBindings
    )
        return false

    for (const id of oldBindings.keys()) {
        if (
            !newBindings.has(id)
            && !explicitDeletions().has(id)
            && !explicitRemovals().has(id)
            && !(isHistoryTransaction(transaction) && (confirmedDeletions().has(id) || authorizedCreations().has(id)))
        )
            return false
    }

    for (const [id, binding] of newBindings) {
        if (forbiddenRestorations().has(id))
            return false

        const entry = entries().get(id)

        if (
            !entry
            || entry.organizationId !== binding.organizationId
        )
            return false

        const previous = oldBindings.get(id)

        if (
            !previous
            && !explicitDeletions().has(id)
            && !authorizedCreations().has(id)
        )
            return false

        if (
            !entry.editable
            && previous
            && (JSON.stringify(
                previous.node.content.content.filter(child => child.type.name !== 'bullet_list').map(child => child.toJSON()),
            ) !== JSON.stringify(
                binding.node.content.content.filter(child => child.type.name !== 'bullet_list').map(child => child.toJSON()),
            ) ||
                JSON.stringify(previous.node.attrs.tagIds) !== JSON.stringify(binding.node.attrs.tagIds) ||
                previous.parentWorkspaceId !== binding.parentWorkspaceId)
        )
            return false
    }

    return true
}
