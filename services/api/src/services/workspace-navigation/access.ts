import {
    type AccessLevel,
    type WorkspaceAccessGrant,
} from '@lixpi/constants'

// Access is inherited downward and never reduced. A user's effective access to
// a workspace is the highest level among their grants on the workspace and its
// ancestors, so a grant on a child can raise access within that subtree but
// cannot lower what a parent grant gives.

export const ACCESS_LEVEL_RANK: Readonly<Record<AccessLevel, number>> = {
    viewer: 1,
    editor: 2,
    owner: 3,
}

export type WorkspaceGrantRecord = {
    workspaceId: string
    accessLevel: AccessLevel
}

export const hasAccessLevel = (
    accessLevel: AccessLevel | undefined,
    required: AccessLevel,
): boolean => accessLevel !== undefined
    && ACCESS_LEVEL_RANK[accessLevel] >= ACCESS_LEVEL_RANK[required]

export const canEditWorkspace = (accessLevel: AccessLevel | undefined): boolean => hasAccessLevel(accessLevel, 'editor')

export const higherAccessLevel = (
    left: AccessLevel | undefined,
    right: AccessLevel | undefined,
): AccessLevel | undefined => {
    if (!left)
        return right

    if (!right)
        return left

    return ACCESS_LEVEL_RANK[right] > ACCESS_LEVEL_RANK[left] ? right : left
}

// Picks the grant that gives the highest level on the chain from the root to
// the workspace. When two grants give the same level, the one nearest the
// workspace wins, so a fence checks the most specific grant.
export const resolveEffectiveAccess = ({
    workspaceId,
    ancestorIds,
    grants,
}: {
    workspaceId: string
    ancestorIds: string[]
    grants: WorkspaceGrantRecord[]
}): WorkspaceAccessGrant | undefined => {
    const chain = [...ancestorIds, workspaceId]
    let best: {
        depth: number
        grant: WorkspaceGrantRecord
    } | undefined

    for (const grant of grants) {
        const depth = chain.indexOf(grant.workspaceId)

        if (depth < 0)
            continue

        const rank = ACCESS_LEVEL_RANK[grant.accessLevel]
        const bestRank = best ? ACCESS_LEVEL_RANK[best.grant.accessLevel] : 0

        if (
            !best
            || rank > bestRank
            || (rank === bestRank && depth > best.depth)
        )
            best = {
                depth,
                grant,
            }
    }

    return best
        ? {
            grantWorkspaceId: best.grant.workspaceId,
            accessLevel: best.grant.accessLevel,
            ancestorIds: [...ancestorIds],
        }
        : undefined
}
