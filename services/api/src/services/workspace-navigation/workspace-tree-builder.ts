import {
    type Organization,
    type WorkspaceHeading,
    type WorkspaceTree,
    type WorkspaceTreeEntry,
} from '@lixpi/constants'

import { outlineSectionRange } from '@lixpi/prosemirror/shared/outline-sections'
import {
    type AccessibleWorkspace,
    type AccessibleForest,
} from './workspace-access-resolver.ts'
import {
    type WorkspaceTreeRow,
} from './workspace-tree-repository.ts'
import { sectionLevel } from './outline.ts'

export type OrganizationTreeInput = {
    organization: Pick<Organization, 'organizationId' | 'name' | 'tags'>
    // Whether the user belongs to the organization. Members see the
    // organization's empty root headings; grant-only users do not.
    member: boolean
    rootRows: WorkspaceTreeRow[]
    forest: AccessibleForest
}

export const headingFromRow = (row: WorkspaceTreeRow): WorkspaceHeading => ({
    headingId: row.entryId,
    organizationId: row.organizationId,
    ...(row.parentWorkspaceId ? { parentWorkspaceId: row.parentWorkspaceId } : {}),
    level: row.level ?? 1,
    name: row.name ?? '',
    ...(row.note ? { note: row.note } : {}),
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
})

const compareRows = (
    left: WorkspaceTreeRow,
    right: WorkspaceTreeRow,
): number => {
    if (left.sk < right.sk)
        return -1

    return left.sk > right.sk ? 1 : 0
}

// Builds one level. A heading is hidden when its section holds workspaces
// but the user can see none of them. A heading over an empty section shows
// when `showEmptyHeadings` allows it, so a new heading is visible before
// anything has been moved under it.
const buildLevel = ({
    rows,
    forest,
    showEmptyHeadings,
    promotedFor,
}: {
    rows: WorkspaceTreeRow[]
    forest: AccessibleForest
    showEmptyHeadings: boolean
    // At the root, a workspace the user cannot see is replaced by the
    // accessible workspaces under it.
    promotedFor?: (row: WorkspaceTreeRow) => AccessibleWorkspace[]
}): WorkspaceTreeEntry[] => {
    const sorted = [...rows].sort(compareRows)
    const sequence = sorted.map(
        row => ({
            entryId: row.entryId,
            ...(row.entryType === 'heading'
                && sectionLevel(row.level) !== undefined
                ? { headingLevel: sectionLevel(row.level) }
                : {}),
        }),
    )
    const visibleWorkspaceRows = new Set(
        sorted.filter(row => row.entryType === 'workspace' && (forest.workspaces.has(row.entryId) || (promotedFor?.(row).length ?? 0) > 0)).map(
            row => row.entryId,
        ),
    )
    const entries: WorkspaceTreeEntry[] = []

    sorted.forEach((row, index) => {
        if (row.entryType === 'heading') {
            const section = sorted.slice(index + 1, outlineSectionRange(sequence, index).end)
            const workspaceRows = section.filter(entry => entry.entryType === 'workspace')
            const visible = workspaceRows.some(entry => visibleWorkspaceRows.has(entry.entryId))

            if (
                visible
                || (workspaceRows.length === 0 && showEmptyHeadings)
            )
                entries.push({
                    entryType: 'heading',
                    heading: headingFromRow(row),
                })

            return
        }

        const accessible = forest.workspaces.get(row.entryId)

        if (accessible) {
            entries.push(
                buildWorkspaceEntry(accessible, forest),
            )

            return
        }

        for (const promoted of promotedFor?.(row) ?? [])
            entries.push(
                buildWorkspaceEntry(promoted, forest),
            )
    })

    return entries
}

const buildWorkspaceEntry = (
    accessible: AccessibleWorkspace,
    forest: AccessibleForest,
): WorkspaceTreeEntry => ({
    entryType: 'workspace',
    workspace: accessible.workspace,
    accessLevel: accessible.accessLevel,
    children: buildLevel({
        rows: forest.childRows.get(accessible.workspace.workspaceId) ?? [],
        forest,
        showEmptyHeadings: true,
    }),
})

// Builds the tree one user sees in one organization. A workspace whose parent
// the user cannot see becomes one of their roots, at the root position of its
// top-level ancestor; several of them under the same ancestor follow tree
// depth, then their position.
export const buildOrganizationTree = ({
    organization,
    member,
    rootRows,
    forest,
}: OrganizationTreeInput): WorkspaceTree => {
    const inOrganization = [...forest.workspaces.values()].filter(entry => entry.workspace.organizationId === organization.organizationId)
    const promotedByRoot = new Map<string, AccessibleWorkspace[]>()

    for (const entry of inOrganization) {
        const parentId = entry.workspace.parentWorkspaceId
        const rootAncestorId = entry.workspace.ancestorIds?.[0]

        if (
            !parentId
            || !rootAncestorId
            || forest.workspaces.has(parentId)
        )
            continue

        const promoted = promotedByRoot.get(rootAncestorId) ?? []
        promoted.push(entry)
        promotedByRoot.set(rootAncestorId, promoted)
    }

    for (const promoted of promotedByRoot.values())
        promoted.sort(
            (left, right) =>
                (left.workspace.ancestorIds?.length ?? 0) - (right.workspace.ancestorIds?.length ?? 0)
                || (left.workspace.position < right.workspace.position ? -1 : 1),
        )

    return {
        organizationId: organization.organizationId,
        organizationName: organization.name,
        tags: organization.tags ?? {},
        roots: buildLevel({
            rows: rootRows,
            forest,
            showEmptyHeadings: member,
            promotedFor: row => promotedByRoot.get(row.entryId) ?? [],
        }),
    }
}
