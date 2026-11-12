import {
    WORKSPACE_TREE_ERROR,
    type AccessLevel,
    type WorkspaceAccessGrant,
    type WorkspaceMeta,
} from '@lixpi/constants'

import { WorkspaceTreeError } from './workspace-tree-errors.ts'
import { WorkspaceNavigationReadFence } from './workspace-navigation-read-fence.ts'
import {
    higherAccessLevel,
    resolveEffectiveAccess,
} from './access.ts'
import {
    type WorkspaceGrantRow,
    type WorkspaceTreeRepository,
    type WorkspaceTreeRow,
} from './workspace-tree-repository.ts'

export type WorkspaceAccessResolution =
    | {
        status: 'granted'
        workspace: WorkspaceMeta
        grant: WorkspaceAccessGrant
    }
    // The user has access, but the workspace or one of its ancestors is being
    // deleted. Only the delete path continues from this state.
    | {
        status: 'deleting'
        workspace: WorkspaceMeta
        grant: WorkspaceAccessGrant
        // When the deletion that covers the workspace started.
        deletingAt: number
    }
    | { status: 'denied' }
    | { status: 'not-found' }

export type AccessibleWorkspace = {
    workspace: WorkspaceMeta
    accessLevel: AccessLevel
}

// Everything a user can reach, with the child rows of each reachable
// workspace as they were read while walking the tree.
export type AccessibleForest = {
    workspaces: Map<string, AccessibleWorkspace>
    childRows: Map<string, WorkspaceTreeRow[]>
}

// A concurrent move can change a workspace's ancestors between reading its
// meta row and reading its chain. The chain read is retried this many times
// before the latest chain is used.
const CHAIN_READ_ATTEMPTS = 3

// Returned when a fenced chain was too long to read with its lock at once.
const CHAIN_NOT_FENCED = Symbol('chain-not-fenced')

// The organizations each user's accessible forest spanned when last read.
// Only a guess for which organizations to fence; bounded so it cannot grow
// with the number of users the process has served.
const FOREST_ORGANIZATIONS_LIMIT = 10_000
const forestOrganizations = new Map<string, ReadonlySet<string>>()

const rememberForestOrganizations = (
    userId: string,
    organizations: ReadonlySet<string>,
): void => {
    forestOrganizations.delete(userId)
    forestOrganizations.set(userId, organizations)

    if (forestOrganizations.size > FOREST_ORGANIZATIONS_LIMIT)
        forestOrganizations.delete(forestOrganizations.keys().next().value!)
}

const sameAncestors = (
    left: string[] | undefined,
    right: string[] | undefined,
): boolean => (left ?? []).length === (right ?? []).length
    && (left ?? []).every((id, index) => id === right?.[index])

export class WorkspaceAccessResolver {
    constructor(
        private readonly repository: WorkspaceTreeRepository,
        private readonly fenceReads = true,
    ) {}

    // Two reads: the workspace's meta row, to learn its chain and
    // organization, then the chain, the user's grants on it and the
    // organization's tree lock in one consistent read. That read sees either
    // no tree operation in progress or a lock, which makes the access check
    // busy, so it fences the decision without separate lock and head reads.
    async resolve(request: {
        userId: string
        workspaceId: string
    }): Promise<WorkspaceAccessResolution> {
        const workspace = await this.repository.getWorkspaceMeta(request.workspaceId)

        if (!workspace)
            return { status: 'not-found' }

        if (!this.fenceReads)
            return await this.resolveChain(
                request,
                workspace,
                false,
            )

        const resolution = await this.resolveChain(
            request,
            workspace,
            true,
        )

        if (resolution !== CHAIN_NOT_FENCED)
            return resolution

        // A chain too long for one consistent read is fenced around its reads.
        return await new WorkspaceNavigationReadFence(this.repository).run(
            [workspace.organizationId],
            async () => {
                const fresh = await this.repository.getWorkspaceMeta(request.workspaceId)

                return fresh ? await this.resolveChain(
                    request,
                    fresh,
                    false,
                ) : { status: 'not-found' }
            },
        )
    }

    // Resolves a user's effective access to one workspace from consistent
    // reads of its ancestor chain and the user's grants on that chain. When
    // `fenced`, the organization's lock joins the chain read; a held lock
    // makes the check busy unless the workspace is already being deleted.
    private async resolveChain(
        {
            userId,
            workspaceId,
        }: {
            userId: string
            workspaceId: string
        },
        initial: WorkspaceMeta,
        fenced: true,
    ): Promise<WorkspaceAccessResolution | typeof CHAIN_NOT_FENCED>
    private async resolveChain(
        request: {
            userId: string
            workspaceId: string
        },
        initial: WorkspaceMeta,
        fenced: false,
    ): Promise<WorkspaceAccessResolution>
    private async resolveChain(
        {
            userId,
            workspaceId,
        }: {
            userId: string
            workspaceId: string
        },
        initial: WorkspaceMeta,
        fenced: boolean,
    ): Promise<WorkspaceAccessResolution | typeof CHAIN_NOT_FENCED> {
        let workspace: WorkspaceMeta | undefined = initial

        for (let attempt = 1; attempt <= CHAIN_READ_ATTEMPTS; attempt += 1) {
            if (!workspace)
                return { status: 'not-found' }

            const ancestorIds = workspace.ancestorIds ?? []
            const chain = await this.repository.readAccessChain(
                userId,
                [...ancestorIds, workspaceId],
                fenced ? workspace.organizationId : undefined,
            )

            if (
                fenced
                && chain.locked === undefined
            )
                return CHAIN_NOT_FENCED

            const current = chain.metas.get(workspaceId)

            if (!current) {
                if (chain.locked)
                    throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.BUSY)

                return { status: 'not-found' }
            }

            if (
                (!sameAncestors(current.ancestorIds, ancestorIds) || current.organizationId !== workspace.organizationId)
                && attempt < CHAIN_READ_ATTEMPTS
            ) {
                workspace = current

                continue
            }

            const grant = resolveEffectiveAccess({
                workspaceId,
                ancestorIds: current.ancestorIds ?? [],
                grants: chain.grants,
            })

            const deletingAt = grant
                ? [...(current.ancestorIds ?? []), workspaceId].map(id => chain.metas.has(id) ? chain.metas.get(id)?.deletingAt : 0).find(
                    value => value !== undefined,
                )
                : undefined

            // A deletion in progress holds the lock, and only the delete path
            // continues from it, so that state is reported as it is.
            if (
                chain.locked
                && !(grant && deletingAt !== undefined)
            )
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.BUSY)

            if (!grant)
                return { status: 'denied' }

            return deletingAt === undefined
                ? {
                    status: 'granted',
                    workspace: current,
                    grant,
                }
                : {
                    status: 'deleting',
                    workspace: current,
                    grant,
                    deletingAt,
                }
        }

        return { status: 'not-found' }
    }

    // Lists every workspace the user can reach: each granted workspace and its
    // whole subtree, with the effective level of each. Workspaces being
    // deleted, and everything under them, are left out. Each tree level is
    // loaded with parallel queries.
    async listAccessibleWorkspaces(userId: string): Promise<AccessibleWorkspace[]> {
        return [...(await this.loadAccessibleForest(userId)).workspaces.values()]
    }

    // The fence needs the organizations the forest spans before reading it.
    // The set last seen for the user is reused as the guess; a forest that
    // reaches an organization outside it is read again with a fresh set, so
    // the guess never decides what the user can reach.
    async loadAccessibleForest(userId: string): Promise<AccessibleForest> {
        if (!this.fenceReads)
            return await this.loadAccessibleForestUnfenced(userId)

        const remembered = forestOrganizations.get(userId)

        if (remembered) {
            const forest = await this.loadFencedForest(userId, remembered)

            if (forest)
                return forest
        }

        const grants = await this.repository.listUserGrants(userId)
        const metas = await this.repository.getWorkspaceMetas(
            grants.map(grant => grant.workspaceId),
        )
        const organizations = new Set(
            metas.map(meta => meta.organizationId),
        )
        const forest = await this.loadFencedForest(userId, organizations)

        if (!forest)
            throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.BUSY)

        return forest
    }

    // Reads the forest inside a fence over `organizations`. Returns undefined
    // when the forest spans an organization outside them.
    private async loadFencedForest(
        userId: string,
        organizations: ReadonlySet<string>,
    ): Promise<AccessibleForest | undefined> {
        const forest = await new WorkspaceNavigationReadFence(this.repository).run(
            [...organizations],
            async () => await this.loadAccessibleForestUnfenced(userId),
        )
        const spanned = new Set(
            [...forest.workspaces.values()].map(entry => entry.workspace.organizationId),
        )

        if ([...spanned].some(organizationId => !organizations.has(organizationId)))
            return undefined

        rememberForestOrganizations(userId, spanned)

        return forest
    }

    // Reads the forest without a fence. Only a caller that already fences
    // every organization the forest can reach may use it.
    async loadAccessibleForestUnfenced(userId: string): Promise<AccessibleForest> {
        const grants = await this.repository.listUserGrants(userId)
        const childRowsByParent = new Map<string, WorkspaceTreeRow[]>()

        if (grants.length === 0)
            return {
                workspaces: new Map(),
                childRows: childRowsByParent,
            }

        const grantLevels = new Map<string, AccessLevel>()

        for (const grant of grants)
            grantLevels.set(grant.workspaceId, higherAccessLevel(
                grantLevels.get(grant.workspaceId),
                grant.accessLevel,
            )!)

        const grantedMetas = await this.repository.getWorkspaceMetas([...grantLevels.keys()])
        const ancestorIds = [...new Set(
            grantedMetas.flatMap(meta => meta.ancestorIds ?? []),
        )]
        const ancestorMetas = new Map(
            (await this.repository.getWorkspaceMetas(ancestorIds)).map(meta => [meta.workspaceId, meta]),
        )
        const accessible = new Map<string, AccessibleWorkspace>()
        let frontier: AccessibleWorkspace[] = []

        for (const meta of grantedMetas) {
            const chain = meta.ancestorIds ?? []

            if (
                meta.deletingAt !== undefined
                || chain.some(id => !ancestorMetas.get(id) || ancestorMetas.get(id)?.deletingAt !== undefined)
            )
                continue

            // A granted workspace under another granted workspace is reached
            // from that ancestor, which also carries the inherited level.
            if (chain.some(id => grantLevels.has(id)))
                continue

            const entry = {
                workspace: meta,
                accessLevel: grantLevels.get(meta.workspaceId)!,
            }
            accessible.set(meta.workspaceId, entry)
            frontier.push(entry)
        }

        while (frontier.length > 0) {
            const childRows = await Promise.all(
                frontier.map(
                    async parent => ({
                        parent,
                        rows: await this.repository.listChildRows(parent.workspace.organizationId, parent.workspace.workspaceId),
                    }),
                ),
            )

            for (const {
                parent,
                rows,
            } of childRows)
                childRowsByParent.set(parent.workspace.workspaceId, rows)

            const childIds = childRows.flatMap(({ rows }) => rows.filter(row => row.entryType === 'workspace').map(row => row.entryId))
            const childMetas = new Map(
                (await this.repository.getWorkspaceMetas(childIds)).map(meta => [meta.workspaceId, meta]),
            )
            const next: AccessibleWorkspace[] = []

            for (const {
                parent,
                rows,
            } of childRows) {
                for (const row of rows) {
                    const meta = childMetas.get(row.entryId)

                    if (
                        row.entryType !== 'workspace'
                        || !meta
                        || meta.deletingAt !== undefined
                        || accessible.has(meta.workspaceId)
                    )
                        continue

                    const entry = {
                        workspace: meta,
                        accessLevel: higherAccessLevel(
                            parent.accessLevel,
                            grantLevels.get(meta.workspaceId),
                        )!,
                    }
                    accessible.set(meta.workspaceId, entry)
                    next.push(entry)
                }
            }

            frontier = next
        }

        return {
            workspaces: accessible,
            childRows: childRowsByParent,
        }
    }

    // Lists everyone with access to a workspace: the union of users holding a
    // grant on it or on any of its ancestors.
    async listUsersWithAccess(workspace: Pick<WorkspaceMeta, 'workspaceId' | 'ancestorIds'>): Promise<string[]> {
        const current = await this.repository.getWorkspaceMeta(workspace.workspaceId)

        if (!current)
            return []

        if (!this.fenceReads)
            return await this.listUsersWithAccessUnfenced(current)

        return await new WorkspaceNavigationReadFence(this.repository).run(
            [current.organizationId],
            async () => {
                const fresh = await this.repository.getWorkspaceMeta(workspace.workspaceId)

                return fresh ? await this.listUsersWithAccessUnfenced(fresh) : []
            },
        )
    }

    private async listUsersWithAccessUnfenced(workspace: Pick<WorkspaceMeta, 'workspaceId' | 'ancestorIds'>): Promise<string[]> {
        const grantLists = await Promise.all(
            [...(workspace.ancestorIds ?? []), workspace.workspaceId].map(async workspaceId => await this.repository.listWorkspaceGrants(workspaceId)),
        )

        return [...new Set(
            grantLists.flat().map((grant: WorkspaceGrantRow) => grant.userId),
        )]
    }
}
