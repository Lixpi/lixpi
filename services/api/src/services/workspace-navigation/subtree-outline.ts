import {
    WORKSPACE_NOTE_LEVEL,
    type WorkspaceHeadingLevel,
} from '@lixpi/constants'

// One line of a workspace's subtree as an agent sees it: names and structure,
// never content.
export type WorkspaceSubtreeEntry = {
    entryType: 'workspace' | 'heading'
    id: string
    name: string
    // 1 for the workspace's direct children.
    depth: number
    level?: WorkspaceHeadingLevel
    note?: string
    parentWorkspaceId?: string
}

export const SUBTREE_OUTLINE_LIMIT = 200

// Renders the subtree as an indented outline for a system prompt, capped at
// `limit` entries with a pointer to the listing tool for the rest.
export const formatWorkspaceSubtreeOutline = (
    entries: WorkspaceSubtreeEntry[],
    limit = SUBTREE_OUTLINE_LIMIT,
): string => {
    if (entries.length === 0)
        return 'This workspace has no sub-workspaces.'

    const lines = entries.slice(0, limit).map(entry => {
        const indent = '  '.repeat(entry.depth - 1)
        const note = entry.note ? ` (${entry.note})` : ''

        if (
            entry.entryType === 'heading'
            && entry.level === WORKSPACE_NOTE_LEVEL
        )
            return `${indent}${entry.name}${note}`

        return entry.entryType === 'heading'
            ? `${indent}${'#'.repeat(entry.level ?? 1)} ${entry.name}${note}`
            : `${indent}- ${entry.name} [workspace ${entry.id}]${note}`
    })

    if (entries.length > limit)
        lines.push(`… ${entries.length - limit} more entries; call list_workspace_tree to see them.`)

    return lines.join('\n')
}
