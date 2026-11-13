import { createHash } from 'node:crypto'
import { settings } from '../../settings.ts'
import {
    assertNavigationRequestBounds,
    type NavigationPersistenceSettings,
} from './workspace-navigation-limits.ts'
import {
    WORKSPACE_HEADING_LEVELS,
    WORKSPACE_OUTLINE_TEXT_MAX_LENGTH,
    WORKSPACE_NOTE_MAX_LENGTH,
    WORKSPACE_TREE_ERROR,
    type AccessLevel,
    type WorkspaceNavigationDocument,
    type WorkspaceNavigationSnapshot,
    type UserWorkspaceNavigation,
    type SaveWorkspaceNavigationRequest,
    type SaveWorkspaceNavigationResult,
    type CreateWorkspaceHeadingRequest,
    type CreateWorkspaceRequest,
    type DeleteWorkspaceHeadingRequest,
    type DeleteWorkspaceResult,
    type MoveWorkspaceHeadingRequest,
    type MoveWorkspaceRequest,
    type Organization,
    type UpdateWorkspaceHeadingRequest,
    type UpdateWorkspaceRequest,
    type UserWorkspaceTrees,
    type WorkspaceHeadingLevel,
    type WorkspaceMeta,
    type WorkspaceTree,
    type WorkspaceTreePlacement,
} from '@lixpi/constants'

import {
    canEditWorkspace,
    hasAccessLevel,
} from './access.ts'
import { outlineSectionRange } from '@lixpi/prosemirror/shared/outline-sections'
import {
    wouldCreateCycle,
    sectionLevel,
} from './outline.ts'
import {
    needsRebalance,
    positionsBetween,
    rebalancePositions,
} from './positions.ts'
import {
    workspaceTreeEntrySortKey,
    workspaceTreePartitionKey,
} from './table-keys.ts'
import { WorkspaceNavigationReadFence } from './workspace-navigation-read-fence.ts'
import { WorkspaceAccessResolver } from './workspace-access-resolver.ts'
import { buildOrganizationTree } from './workspace-tree-builder.ts'
import { WorkspaceTreeError } from './workspace-tree-errors.ts'
import {
    WorkspaceTreeConflict,
    workspaceTreeChangeItemCount,
    type WorkspaceTreeChange,
    type WorkspaceNavigationHead,
    type WorkspaceNavigationMutation,
    type WorkspaceTreeLock,
    type WorkspaceTreeLockOperation,
    type WorkspaceTreeRepository,
    type WorkspaceTreeRow,
} from './workspace-tree-repository.ts'

import {
    createEmptyNavigationDocument,
    equalNavigationDocuments,
    indexNavigationDocument,
    mergeNavigationProjection,
    navigationEntryId,
    navigationProjectionEntries,
    navigationText,
    navigationWorkspaceId,
    projectNavigationDocument,
    reconcileNavigationProjection,
    validateNavigationDocument,
} from './workspace-navigation-document.ts'

// Organization data the tree needs from the application.
export type WorkspaceTreeOrganizations = {
    // The user's level in the organization, or undefined for a non-member.
    getMembershipLevel: (
        userId: string,
        organizationId: string,
    ) => Promise<AccessLevel | undefined>
    getOrganization: (organizationId: string) => Promise<Pick<Organization, 'organizationId' | 'name' | 'tags'> | undefined>
    listUserOrganizationIds: (userId: string) => Promise<string[]>
}

// Application work a subtree delete runs for each workspace. Both calls must
// be safe to repeat, because an interrupted delete runs them again.
export type WorkspaceTreeDeletionPorts = {
    stopConversations: (
        workspace: WorkspaceMeta,
        userId: string,
    ) => Promise<void>
    // Removes what the application stores for the workspace besides its full,
    // meta, grant and tree rows.
    cleanupWorkspace: (
        workspace: WorkspaceMeta,
        userId: string,
    ) => Promise<void>
}

export type WorkspaceTreeServiceOptions = {
    repository: WorkspaceTreeRepository
    organizations: WorkspaceTreeOrganizations
    deletion: WorkspaceTreeDeletionPorts
    // Extra fields stored on a new workspace's full row, such as its content.
    createWorkspaceContent?: () => Record<string, unknown>
    now?: () => number
    createId?: () => string
    lockTtlMs?: number
    lockRenewIntervalMs?: number
    navigationPersistence?: NavigationPersistenceSettings
}

export type CreatedWorkspace = {
    workspace: WorkspaceMeta
    tree: WorkspaceTree
}

type SectionEntry = {
    entryId: string
    entryType: 'workspace' | 'heading'
    toPosition: string
}

type MoveParameters = {
    workspaceId: string
    toParentId?: string
    toPosition: string
    newAncestorIds: string[]
}

type SectionMoveParameters = {
    fromParentId?: string
    toParentId?: string
    newAncestorIds: string[]
    entries: SectionEntry[]
}

type RebalanceParameters = {
    parentWorkspaceId?: string
    positions: Record<string, string>
}

type DeleteParameters = {
    workspaceId: string
    deletedWorkspaceIds: string[]
}

const DEFAULT_LOCK_TTL_MS = 30_000
const DEFAULT_LOCK_RENEW_INTERVAL_MS = 10_000
// One transaction holds 100 items. The lock guard takes one and an account
// fence the application may add takes another.
const MAX_COMMIT_ITEMS = 98

const sameList = (
    left: string[] | undefined,
    right: string[] | undefined,
): boolean => (left ?? []).length === (right ?? []).length
    && (left ?? []).every((value, index) => value === right?.[index])

const normalizeNote = (note: string | null | undefined): string | null | undefined => {
    if (note === undefined)
        return undefined

    if (
        note === null
        || note.trim() === ''
    )
        return null

    if (note.length > WORKSPACE_NOTE_MAX_LENGTH)
        throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.NOTE_TOO_LONG)

    return note
}

// A heading or note is a text block: it may be empty while the user types,
// and its text is kept as typed.
const requireBlockText = (text: unknown): string => {
    if (typeof text !== 'string')
        throw new WorkspaceTreeError('NAME_REQUIRED')

    if (text.length > WORKSPACE_OUTLINE_TEXT_MAX_LENGTH)
        throw new WorkspaceTreeError('WORKSPACE_NOTE_TOO_LONG')

    return text
}

const requireLevel = (level: unknown): WorkspaceHeadingLevel => {
    if (!(WORKSPACE_HEADING_LEVELS as readonly unknown[]).includes(level))
        throw new WorkspaceTreeError('INVALID_HEADING_LEVEL')

    return level as WorkspaceHeadingLevel
}

const treeRowKey = (
    organizationId: string,
    parentWorkspaceId: string | undefined,
    position: string,
    entryId: string,
): Pick<WorkspaceTreeRow, 'pk' | 'sk'> => ({
    pk: workspaceTreePartitionKey(organizationId, parentWorkspaceId),
    sk: workspaceTreeEntrySortKey(position, entryId),
})

// Owns the workspace tree: reads, placement, outline headings, annotations,
// moves, rebalancing and subtree deletion. Only one structure operation runs
// per organization at a time. Moves, section moves, rebalances and deletes
// hold the organization's lock and record their progress in it; every other
// mutation requires that no lock is held. Whoever finds an expired lock
// finishes its operation first.
export class WorkspaceTreeService {
    readonly access: WorkspaceAccessResolver
    private readonly repository: WorkspaceTreeRepository
    private readonly now: () => number
    private readonly createId: () => string
    private readonly lockTtlMs: number
    private readonly lockRenewIntervalMs: number

    constructor(private readonly options: WorkspaceTreeServiceOptions) {
        this.repository = options.repository
        this.access = new WorkspaceAccessResolver(options.repository)
        this.now = options.now ?? Date.now
        this.createId = options.createId ?? (() => crypto.randomUUID())
        this.lockTtlMs = options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS
        this.lockRenewIntervalMs = options.lockRenewIntervalMs ?? DEFAULT_LOCK_RENEW_INTERVAL_MS
    }

    // =========================================================================
    // READS
    // =========================================================================

    async getUserWorkspaceTree(userId: string): Promise<UserWorkspaceTrees> {
        const [grants, memberships] = await Promise.all([
            this.repository.listUserGrants(userId),
            this.options.organizations.listUserOrganizationIds(userId),
        ])
        const metas = await this.repository.getWorkspaceMetas(
            grants.map(grant => grant.workspaceId),
        )
        const organizations = new Set([
            ...memberships,
            ...metas.map(meta => meta.organizationId),
        ])

        // An expired lock belongs to an operation that died; finishing it
        // first lets the fence below pass instead of reporting busy.
        await Promise.all(
            [...organizations].map(async organizationId => {
                const lock = await this.repository.getLock(organizationId)

                if (
                    lock
                    && lock.expiresAt <= this.now()
                )
                    await this.resume(lock)
            }),
        )

        return await new WorkspaceNavigationReadFence(this.repository).run(
            [...organizations],
            async () => {
                const trees = await this.getUserWorkspaceTreeUnfenced(userId, memberships)

                if (trees.organizations.some(tree => !organizations.has(tree.organizationId)))
                    throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.BUSY)

                return trees
            },
        )
    }

    // Runs inside the caller's fence, so the forest is read without one of
    // its own.
    private async getUserWorkspaceTreeUnfenced(
        userId: string,
        memberOrganizationIds: string[],
    ): Promise<UserWorkspaceTrees> {
        const forest = await this.access.loadAccessibleForestUnfenced(userId)
        const organizationIds = [...new Set([
            ...memberOrganizationIds,
            ...[...forest.workspaces.values()].map(entry => entry.workspace.organizationId),
        ])]
        const members = new Set(memberOrganizationIds)
        const trees = await Promise.all(
            organizationIds.map(async organizationId => {
                const [organization, rootRows] = await Promise.all([
                    this.options.organizations.getOrganization(organizationId),
                    this.repository.listChildRows(organizationId, undefined),
                ])

                return organization
                    ? buildOrganizationTree({
                        organization,
                        member: members.has(organizationId),
                        rootRows,
                        forest,
                    })
                    : undefined
            }),
        )

        return { organizations: trees.filter((tree): tree is WorkspaceTree => Boolean(tree)) }
    }

    async getOrganizationTree(
        userId: string,
        organizationId: string,
    ): Promise<WorkspaceTree> {
        const trees = await this.getUserWorkspaceTree(userId)

        return (
            trees.organizations.find(tree => tree.organizationId === organizationId) ?? {
                organizationId,
                organizationName: '',
                tags: {},
                roots: [],
            }
        )
    }

    private async readProjection(organizationId: string): Promise<{
        rowsByParent: Map<string | undefined, WorkspaceTreeRow[]>
        metas: Map<string, WorkspaceMeta>
    }> {
        const rowsByParent = new Map<string | undefined, WorkspaceTreeRow[]>()
        const metas = new Map<string, WorkspaceMeta>()
        let parents: Array<string | undefined> = [undefined]

        while (parents.length) {
            const next: string[] = []

            for (const parentId of parents) {
                const rows = await this.repository.listChildRows(organizationId, parentId)
                rowsByParent.set(parentId, rows)

                const workspaceIds = rows.filter(row => row.entryType === 'workspace').map(row => row.entryId)
                const workspaceMetas = await this.repository.getWorkspaceMetas(workspaceIds)
                const foundIds = new Set(
                    workspaceMetas.map(meta => meta.workspaceId),
                )

                if (workspaceIds.some(id => !foundIds.has(id)))
                    throw new Error('WORKSPACE_NAVIGATION_PROJECTION_INCOMPLETE')

                for (const meta of workspaceMetas) {
                    if (metas.has(meta.workspaceId))
                        throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.CYCLE)

                    metas.set(meta.workspaceId, meta)
                    next.push(meta.workspaceId)
                }
            }

            parents = next
        }

        return {
            rowsByParent,
            metas,
        }
    }

    private async navigationHead(organizationId: string): Promise<WorkspaceNavigationHead | undefined> {
        return await this.repository.getNavigationRecord(organizationId, 'HEAD')
    }

    private async ensureNavigationHead(
        userId: string,
        organizationId: string,
    ): Promise<WorkspaceNavigationHead> {
        let head = await this.navigationHead(organizationId)

        if (!head) {
            await this.runLocked(
                userId,
                organizationId,
                'initializeNavigation',
                organizationId,
                {},
            )
            head = await this.navigationHead(organizationId)
        }

        return head!
    }

    // Every organization's snapshot from one tree read. The heads are read
    // first, all in one consistent read, then the tree, then each document,
    // and one closing read confirms no head moved and no lock appeared, so
    // each tree matches the document it is shown with. Workspaces reached
    // through a grant stay in the grant's organization, so the memberships
    // and the granted workspaces name every organization the tree can hold.
    async getUserWorkspaceNavigation(userId: string): Promise<UserWorkspaceNavigation> {
        const [grants, memberships] = await Promise.all([
            this.repository.listUserGrants(userId),
            this.options.organizations.listUserOrganizationIds(userId),
        ])
        const metas = await this.repository.getWorkspaceMetas(
            grants.map(grant => grant.workspaceId),
        )
        const candidates = [...new Set([
            ...memberships,
            ...metas.map(meta => meta.organizationId),
        ])]
        const heads = await this.repository.readNavigationFences(candidates)
        const trees = await this.getUserWorkspaceTree(userId)

        // A first visit creates the head; that path checks permission
        // before creating it, one organization at a time.
        if (trees.organizations.some(tree => !heads.get(tree.organizationId)?.head))
            return {
                organizations: await Promise.all(
                    trees.organizations.map(async tree => await this.getNavigationSnapshot(userId, tree.organizationId)),
                ),
            }

        const organizations = await Promise.all(
            trees.organizations.map(async tree => {
                const head = heads.get(tree.organizationId)!.head!
                const member = await this.options.organizations.getMembershipLevel(userId, tree.organizationId)

                return await this.projectSnapshot(
                    tree,
                    member,
                    head,
                )
            }),
        )
        await this.confirmHeads(
            organizations.map(
                snapshot => ({
                    organizationId: snapshot.organizationId,
                    revisionId: heads.get(snapshot.organizationId)!.revisionId!,
                }),
            ),
        )

        return { organizations }
    }

    async getNavigationSnapshot(
        userId: string,
        organizationId: string,
    ): Promise<WorkspaceNavigationSnapshot> {
        let head = await this.navigationHead(organizationId)

        // Creating a missing head needs permission, which the tree shows.
        if (!head) {
            const [tree, member] = await Promise.all([
                this.getOrganizationTree(userId, organizationId),
                this.options.organizations.getMembershipLevel(userId, organizationId),
            ])

            if (
                !member
                && !tree.roots.some(entry => entry.entryType === 'workspace')
            )
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.PERMISSION_DENIED)

            head = await this.ensureNavigationHead(userId, organizationId)
        }

        const [tree, member] = await Promise.all([
            this.getOrganizationTree(userId, organizationId),
            this.options.organizations.getMembershipLevel(userId, organizationId),
        ])
        const snapshot = await this.projectSnapshot(
            tree,
            member,
            head,
        )
        await this.confirmHeads([{
            organizationId,
            revisionId: head.revisionId,
        }])

        return snapshot
    }

    // Fails busy when any head moved or a lock appeared since it was read.
    private async confirmHeads(expected: Array<{
        organizationId: string
        revisionId: string
    }>): Promise<void> {
        if (!expected.length)
            return

        const current = await this.repository.readNavigationFences(
            expected.map(entry => entry.organizationId),
        )

        for (const {
            organizationId,
            revisionId,
        } of expected) {
            const fence = current.get(organizationId)

            if (
                !fence
                || fence.locked
                || fence.revisionId !== revisionId
            )
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.BUSY)
        }
    }

    // Projects the navigation document at `head` onto what the tree lets
    // the user see. The caller confirms the head afterwards.
    private async projectSnapshot(
        tree: WorkspaceTree,
        member: AccessLevel | undefined,
        head: WorkspaceNavigationHead,
    ): Promise<WorkspaceNavigationSnapshot> {
        const { organizationId } = tree
        const visible = new Set<string>()
        const visibleHeadings = new Set<string>()
        const visit = (entries: WorkspaceTree['roots']): void => {
            for (const entry of entries)
                if (entry.entryType === 'workspace') {
                    visible.add(entry.workspace.workspaceId)
                    visit(entry.children)
                } else
                    visibleHeadings.add(entry.heading.headingId)
        }
        visit(tree.roots)

        if (
            !member
            && !visible.size
        )
            throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.PERMISSION_DENIED)

        const document = projectNavigationDocument(
            await this.repository.getNavigationDocument(organizationId, head.revisionId),
            visible,
            Boolean(member),
            visibleHeadings,
        )

        return {
            organizationId,
            revision: head.revision,
            schemaVersion: 1,
            document,
            tree,
        }
    }

    async saveNavigation(
        userId: string,
        request: SaveWorkspaceNavigationRequest,
    ): Promise<SaveWorkspaceNavigationResult> {
        const limits = this.options.navigationPersistence ?? settings.navigationPersistence
        assertNavigationRequestBounds(request, limits)
        const retryAfterMs = await this.repository.admitNavigationWrite(
            userId,
            this.now(),
            limits,
        )

        if (retryAfterMs)
            return {
                error: 'WORKSPACE_NAVIGATION_RATE_LIMITED',
                retryAfterMs,
            }

        const submitted = validateNavigationDocument(request.document)
        const deletedIds = [...new Set(request.deletedWorkspaceIds ?? [])].sort()
        const createdIds = [...new Set(request.createdWorkspaceIds ?? [])].sort()

        if (
            [...deletedIds, ...createdIds].some(id => typeof id !== 'string' || !id || id.length > 200)
            || createdIds.some(id => deletedIds.includes(id))
        )
            throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_INVALID')

        const requestHash = createHash('sha256').update(
            JSON.stringify({
                baseRevision: request.baseRevision,
                document: submitted,
                deletedWorkspaceIds: deletedIds,
                createdWorkspaceIds: createdIds,
            }),
        ).digest('hex')
        const previous = (await this.repository.getNavigationRecord(request.organizationId, `MUTATION#${request.mutationId}`)) as WorkspaceNavigationMutation | undefined

        if (previous) {
            if (
                previous.userId !== userId
                || previous.requestHash !== requestHash
            )
                throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_MUTATION_REUSED')

            return { snapshot: await this.getNavigationSnapshot(userId, request.organizationId) }
        }

        const baseline = await this.getNavigationSnapshot(userId, request.organizationId)

        if (baseline.revision !== request.baseRevision)
            return {
                error: 'WORKSPACE_NAVIGATION_STALE',
                snapshot: baseline,
            }

        const head = (await this.navigationHead(request.organizationId))!

        if (head.revision !== request.baseRevision)
            return {
                error: 'WORKSPACE_NAVIGATION_STALE',
                snapshot: await this.getNavigationSnapshot(userId, request.organizationId),
            }

        if (
            !deletedIds.length
            && !createdIds.length
            && equalNavigationDocuments(submitted, baseline.document)
        ) {
            const recorded = await this.repository.recordUnchangedNavigation(
                request.organizationId,
                request.mutationId,
                {
                    ...head,
                    userId,
                    requestHash,
                },
            )

            if (recorded)
                return { snapshot: baseline }

            const receipt = (await this.repository.getNavigationRecord(request.organizationId, `MUTATION#${request.mutationId}`)) as WorkspaceNavigationMutation | undefined

            if (receipt) {
                if (
                    receipt.userId !== userId
                    || receipt.requestHash !== requestHash
                )
                    throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_MUTATION_REUSED')

                return { snapshot: await this.getNavigationSnapshot(userId, request.organizationId) }
            }

            return {
                error: 'WORKSPACE_NAVIGATION_STALE',
                snapshot: await this.getNavigationSnapshot(userId, request.organizationId),
            }
        }

        const full = await this.repository.getNavigationDocument(request.organizationId, head.revisionId)
        const oldEntries = navigationProjectionEntries(baseline.document).filter(entry => entry.entryType === 'workspace')
        const newEntries = navigationProjectionEntries(submitted).filter(entry => entry.entryType === 'workspace')
        const visibleIds = new Set(
            oldEntries.map(entry => entry.entryId),
        )
        const submittedIds = new Set(
            newEntries.map(entry => entry.entryId),
        )
        const deleted = new Set(deletedIds)
        const created = new Set(createdIds)

        if (
            newEntries.some(entry => (!visibleIds.has(entry.entryId) && !created.has(entry.entryId)) || deleted.has(entry.entryId))
            || createdIds.some(id => !submittedIds.has(id) || visibleIds.has(id))
        )
            throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_UNKNOWN_WORKSPACE')

        if (
            oldEntries.some(entry => !submittedIds.has(entry.entryId) && !deleted.has(entry.entryId))
            || deletedIds.some(id => !visibleIds.has(id))
        )
            throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_EXPLICIT_DELETE_REQUIRED')

        for (const id of createdIds)
            if (await this.repository.getWorkspaceMeta(id))
                throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_ID_COLLISION')

        for (const id of deletedIds)
            await this.requireWorkspaceAccess(
                userId,
                id,
                'owner',
            )

        const target = mergeNavigationProjection(
            full,
            baseline.document,
            submitted,
            deleted,
            this.createId,
        )
        const expectedIds = new Set([
            ...navigationProjectionEntries(full).filter(entry => entry.entryType === 'workspace' && !deleted.has(entry.entryId)).map(
                entry => entry.entryId,
            ),
            ...created,
        ])
        const actualIds = navigationProjectionEntries(target).filter(entry => entry.entryType === 'workspace').map(entry => entry.entryId)

        if (
            actualIds.length !== expectedIds.size
            || actualIds.some(id => !expectedIds.has(id))
        )
            throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_HIDDEN_ENTRY')

        await this.validateNavigationPermissions(
            userId,
            request.organizationId,
            full,
            target,
            deleted,
            created,
        )
        const revisionId = this.createId()
        await this.repository.putNavigationDocument(
            request.organizationId,
            revisionId,
            target,
        )

        try {
            const completed = await this.runLocked(
                userId,
                request.organizationId,
                'saveNavigation',
                request.mutationId,
                {
                    navigationBase: head,
                    navigationTarget: {
                        revision: head.revision + 1,
                        revisionId,
                        schemaVersion: 1,
                    },
                    deletedWorkspaceIds: deletedIds,
                    createdWorkspaceIds: createdIds,
                    mutationId: request.mutationId,
                    requestHash,
                },
            )

            if (completed.parameters.navigationAborted)
                throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_ID_COLLISION')
        } catch (error) {
            if (
                error instanceof WorkspaceTreeError
                && error.code === 'WORKSPACE_NAVIGATION_STALE'
            )
                return {
                    error: 'WORKSPACE_NAVIGATION_STALE',
                    snapshot: await this.getNavigationSnapshot(userId, request.organizationId),
                }

            throw error
        }

        return { snapshot: await this.getNavigationSnapshot(userId, request.organizationId) }
    }

    private async validateNavigationPermissions(
        userId: string,
        organizationId: string,
        before: WorkspaceNavigationDocument,
        after: WorkspaceNavigationDocument,
        deleted: Set<string>,
        created = new Set<string>(),
        resolver = this.access,
    ): Promise<void> {
        const oldIndex = indexNavigationDocument(before)
        const nextIndex = indexNavigationDocument(after)
        const oldWorkspaces = new Map(
            navigationProjectionEntries(before).filter(entry => entry.entryType === 'workspace').map(entry => [entry.entryId, entry]),
        )
        const newWorkspaces = new Map(
            navigationProjectionEntries(after).filter(entry => entry.entryType === 'workspace').map(entry => [entry.entryId, entry]),
        )
        const requireAccess = async (
            id: string,
            required: AccessLevel = 'editor',
        ): Promise<WorkspaceMeta> => {
            const resolution = await resolver.resolve({
                userId,
                workspaceId: id,
            })

            if (
                resolution.status !== 'granted'
                || !hasAccessLevel(resolution.grant.accessLevel, required)
            )
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.PERMISSION_DENIED)

            if (resolution.workspace.organizationId !== organizationId)
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.CROSS_ORGANIZATION)

            return resolution.workspace
        }
        const requireCreation = async (id: string): Promise<void> => {
            const entry = newWorkspaces.get(id)!
            const ancestor = [...entry.ancestorIds].reverse().find(candidate => !created.has(candidate))

            if (ancestor)
                await requireAccess(ancestor)
            else if (!(await this.options.organizations.getMembershipLevel(userId, organizationId)))
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.PERMISSION_DENIED)
        }
        const requireContext = async (workspaceId?: string): Promise<void> => {
            if (
                workspaceId
                && created.has(workspaceId)
            ) {
                await requireCreation(workspaceId)

                return
            }

            if (workspaceId)
                await requireAccess(workspaceId)
            else {
                const level = await this.options.organizations.getMembershipLevel(userId, organizationId)

                if (
                    !level
                    || !canEditWorkspace(level)
                )
                    throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.PERMISSION_DENIED)
            }
        }

        for (const id of deleted)
            await requireAccess(id, 'owner')

        for (const [id, entry] of newWorkspaces) {
            const old = oldWorkspaces.get(id)

            if (!old) {
                if (!created.has(id))
                    throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_UNKNOWN_WORKSPACE')

                await requireCreation(id)
                await this.requireOrganizationTags(organizationId, entry.tagIds)

                continue
            }

            await this.requireOrganizationTags(organizationId, entry.tagIds)

            if (JSON.stringify(old) === JSON.stringify(entry))
                continue

            await requireAccess(id)

            if (old.parentWorkspaceId !== entry.parentWorkspaceId)
                await requireContext(entry.parentWorkspaceId)
        }

        for (const [id] of oldWorkspaces)
            if (
                !newWorkspaces.has(id)
                && !deleted.has(id)
            )
                throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_EXPLICIT_DELETE_REQUIRED')

        const own = (node: WorkspaceNavigationDocument): string =>
            JSON.stringify({
                type: node.type,
                attrs: node.attrs,
                text: node.type === 'paragraph'
                    || node.type === 'heading'
                    ? navigationText(node)
                    : undefined,
                children: (node.content ?? []).filter(child => child.type !== 'text').map(navigationEntryId),
            })

        for (const id of new Set([
            ...oldIndex.keys(),
            ...nextIndex.keys(),
        ])) {
            if (id === '$navigation-root')
                continue

            const old = oldIndex.get(id)
            const next = nextIndex.get(id)

            if (
                old
                && next
                && old.parentId === next.parentId
                && own(old.node) === own(next.node)
            )
                continue

            if (
                deleted.has(id)
                || (old?.ancestorIds.some(ancestor => deleted.has(ancestor)) && !next)
            )
                continue

            // Workspace labels and their paragraph are authorized on the
            // workspace itself, including a visible root under a hidden parent.
            const workspaceId = (next && navigationWorkspaceId(next.node))
                || (old && navigationWorkspaceId(old.node))

            if (workspaceId) {
                if (created.has(workspaceId))
                    await requireCreation(workspaceId)
                else {
                    await requireAccess(workspaceId)

                    if (
                        old
                        && next
                        && old.parentId !== next.parentId
                    )
                        await requireContext(
                            next.ancestorIds.at(-1),
                        )
                }

                continue
            }

            const context = next ? next.ancestorIds.at(-1) : old?.ancestorIds.at(-1)

            // List wrappers only arrange their children. Their workspace
            // children are individually authorized above; they carry no
            // text or permission boundary of their own.
            if ((next?.node ?? old?.node)?.type === 'bullet_list') {
                const oldIds = (old?.node.content ?? []).map(navigationEntryId)
                const nextIds = (next?.node.content ?? []).map(navigationEntryId)
                const retainedBefore = oldIds.filter(id => nextIds.includes(id))
                const retainedAfter = nextIds.filter(id => oldIds.includes(id))

                if (!sameList(retainedBefore, retainedAfter)) {
                    await requireContext(context)

                    for (const childId of retainedAfter)
                        if (newWorkspaces.has(childId))
                            await requireAccess(childId)
                }

                continue
            }

            if (
                !context
                && created.size
                && old?.node.type === 'paragraph'
                && !navigationText(old.node)
                && !next
            )
                continue

            if (
                !context
                && deleted.size
                && next?.node.type === 'paragraph'
                && !navigationText(next.node)
            )
                continue

            if (
                old
                && next
                && old.ancestorIds.at(-1) !== next.ancestorIds.at(-1)
            )
                await requireContext(
                    old.ancestorIds.at(-1),
                )

            await requireContext(context)
        }
    }

    private navigationCreationIdentity(lock: WorkspaceTreeLock): string {
        return createHash('sha256').update(
            JSON.stringify([
                lock.organizationId, lock.userId, lock.parameters.mutationId, lock.parameters.requestHash,
            ]),
        ).digest('hex')
    }

    private async rollbackNavigationCreations(lock: WorkspaceTreeLock): Promise<void> {
        const identity = this.navigationCreationIdentity(lock)

        for (const id of lock.parameters.createdWorkspaceIds as string[]) {
            if ((await this.repository.getWorkspaceCreationIdentity(id)) !== identity)
                continue

            await this.commitLocked(
                lock,
                [
                    {
                        type: 'deleteGrant',
                        workspaceId: id,
                        userId: lock.userId,
                    },
                    {
                        type: 'deleteWorkspace',
                        workspaceId: id,
                    },
                ],
            )
        }
    }

    private async executeSaveNavigation(lock: WorkspaceTreeLock): Promise<void> {
        if (lock.parameters.navigationAborted) {
            await this.rollbackNavigationCreations(lock)

            return
        }

        const target = lock.parameters.navigationTarget as WorkspaceNavigationHead
        const document = await this.repository.getNavigationDocument(lock.organizationId, target.revisionId)
        const deletedIds = new Set(lock.parameters.deletedWorkspaceIds as string[])
        const {
            rowsByParent,
            metas,
        } = await this.readProjection(lock.organizationId)
        const desired = navigationProjectionEntries(document)
        const createdIds = new Set(lock.parameters.createdWorkspaceIds as string[])

        try {
            for (const entry of desired.filter(candidate => candidate.entryType === 'workspace' && createdIds.has(candidate.entryId))) {
                const existing = await this.repository.getWorkspaceMeta(entry.entryId)

                if (existing) {
                    if (
                        existing.organizationId !== lock.organizationId
                        || (await this.repository.getWorkspaceCreationIdentity(entry.entryId)) !== this.navigationCreationIdentity(lock)
                    )
                        throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_ID_COLLISION')

                    continue
                }

                const now = this.now()
                await this.commitLocked(
                    lock,
                    [{
                        type: 'createWorkspace',
                        workspace: {
                            ...(this.options.createWorkspaceContent?.() ?? {}),
                            navigationCreationIdentity: this.navigationCreationIdentity(lock),
                            workspaceId: entry.entryId,
                            organizationId: lock.organizationId,
                            name: entry.name,
                            tagIds: entry.tagIds,
                            ...(entry.parentWorkspaceId ? { parentWorkspaceId: entry.parentWorkspaceId } : {}),
                            ancestorIds: entry.ancestorIds,
                            position: '',
                            createdAt: now,
                            updatedAt: now,
                        },
                        grant: {
                            userId: lock.userId,
                            workspaceId: entry.entryId,
                            accessLevel: 'owner',
                            createdAt: now,
                            updatedAt: now,
                        },
                    }],
                )
            }
        } catch (error) {
            if (
                !(error instanceof WorkspaceTreeConflict)
                && !(error instanceof WorkspaceTreeError && error.code === 'WORKSPACE_NAVIGATION_ID_COLLISION')
            )
                throw error

            lock.parameters.navigationAborted = true
            await this.repository.updateLock(
                lock.organizationId,
                lock.operationId,
                {
                    phase: 'abortCreate',
                    parameters: lock.parameters,
                },
            )
            await this.rollbackNavigationCreations(lock)

            return
        }

        const wanted = new Set(
            desired.map(entry => entry.entryId),
        )
        const changes: WorkspaceTreeChange[] = []
        const oldRows = [...rowsByParent.values()].flat()
        const base = lock.parameters.navigationBase as WorkspaceNavigationHead
        const sourceEntries = navigationProjectionEntries(await this.repository.getNavigationDocument(lock.organizationId, base.revisionId))

        for (const entry of sourceEntries.filter(candidate => candidate.entryType === 'heading')) {
            if (oldRows.some(row => row.entryId === entry.entryId))
                continue

            const pointer = await this.repository.getHeadingPointer(lock.organizationId, entry.entryId)

            if (!pointer)
                continue

            oldRows.push({
                ...treeRowKey(
                    lock.organizationId,
                    pointer.parentWorkspaceId,
                    pointer.position,
                    entry.entryId,
                ),
                organizationId: lock.organizationId,
                parentWorkspaceId: pointer.parentWorkspaceId,
                position: pointer.position,
                entryId: entry.entryId,
                entryType: 'heading',
                createdAt: this.now(),
                updatedAt: this.now(),
            })
        }

        // Keep explicitly deleted workspace indexes until cleanup; surviving
        // children are moved first, so deletion never follows a stale parent.
        for (const row of oldRows)
            if (
                !wanted.has(row.entryId)
                && !deletedIds.has(row.entryId)
                && !deletedIds.has(row.parentWorkspaceId ?? '')
            ) {
                changes.push({
                    type: 'deleteTreeRow',
                    key: row,
                })

                if (row.entryType === 'heading')
                    changes.push({
                        type: 'deleteHeadingPointer',
                        organizationId: lock.organizationId,
                        headingId: row.entryId,
                    })
            }

        const groups = new Map<string | undefined, typeof desired>()

        for (const entry of desired) {
            const group = groups.get(entry.parentWorkspaceId) ?? []
            group.push(entry)
            groups.set(entry.parentWorkspaceId, group)
        }

        for (const [parentId, entries] of groups) {
            const positions = rebalancePositions(entries.length)

            for (const [index, entry] of entries.entries()) {
                let old = oldRows.find(row => row.entryId === entry.entryId)

                if (
                    !old
                    && entry.entryType === 'workspace'
                ) {
                    const meta = await this.repository.getWorkspaceMeta(entry.entryId)

                    if (meta?.position)
                        old = {
                            ...treeRowKey(
                                lock.organizationId,
                                meta.parentWorkspaceId,
                                meta.position,
                                meta.workspaceId,
                            ),
                            entryId: meta.workspaceId,
                            entryType: 'workspace',
                            organizationId: lock.organizationId,
                            parentWorkspaceId: meta.parentWorkspaceId,
                            position: meta.position,
                            createdAt: meta.createdAt,
                            updatedAt: meta.updatedAt,
                        }
                }

                const position = positions[index]
                const key = treeRowKey(
                    lock.organizationId,
                    parentId,
                    position,
                    entry.entryId,
                )

                if (
                    old
                    && (old.pk !== key.pk || old.sk !== key.sk)
                )
                    changes.push({
                        type: 'deleteTreeRow',
                        key: old,
                    })

                changes.push({
                    type: 'putTreeRow',
                    row: {
                        ...key,
                        entryType: entry.entryType,
                        entryId: entry.entryId,
                        organizationId: lock.organizationId,
                        ...(parentId ? { parentWorkspaceId: parentId } : {}),
                        position,
                        ...(entry.entryType === 'heading' ? {
                            name: entry.name,
                            level: entry.level,
                            ...(old?.note ? { note: old.note } : {}),
                        } : {}),
                        createdAt: old?.createdAt ?? this.now(),
                        updatedAt: this.now(),
                    },
                })

                if (entry.entryType === 'workspace') {
                    const meta = metas.get(entry.entryId) ?? (await this.repository.getWorkspaceMeta(entry.entryId))

                    if (!meta)
                        throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.NOT_FOUND)

                    changes.push({
                        type: 'patchWorkspace',
                        workspaceId: entry.entryId,
                        patch: {
                            name: entry.name,
                            tagIds: entry.tagIds,
                            parentWorkspaceId: parentId ?? null,
                            ancestorIds: entry.ancestorIds,
                            position,
                            updatedAt: this.now(),
                        },
                    })
                } else
                    changes.push({
                        type: 'putHeadingPointer',
                        pointer: {
                            organizationId: lock.organizationId,
                            headingId: entry.entryId,
                            parentWorkspaceId: parentId,
                            position,
                        },
                    })
            }
        }

        await this.commitLocked(lock, changes)

        for (const id of deletedIds) {
            const root = await this.repository.getWorkspaceMeta(id)

            if (!root)
                continue

            if ((await this.listDescendants(root)).some(meta => !deletedIds.has(meta.workspaceId)))
                throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_DELETE_TOPOLOGY')

            const deletion = lock.parameters.deletion as DeleteParameters | undefined
            await this.executeDelete(lock, deletion?.workspaceId === id ? deletion : {
                workspaceId: id,
                deletedWorkspaceIds: [],
            })
        }
    }

    // =========================================================================
    // PERMISSIONS
    // =========================================================================

    private async requireWorkspaceAccess(
        userId: string,
        workspaceId: string,
        required: AccessLevel,
    ): Promise<WorkspaceMeta> {
        const resolution = await this.access.resolve({
            userId,
            workspaceId,
        })

        if (resolution.status === 'not-found')
            throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.NOT_FOUND)

        if (resolution.status === 'denied')
            throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.PERMISSION_DENIED)

        if (resolution.status === 'deleting')
            throw new WorkspaceTreeError('WORKSPACE_DELETING')

        if (!hasAccessLevel(resolution.grant.accessLevel, required))
            throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.PERMISSION_DENIED)

        return resolution.workspace
    }

    // Structure under a workspace needs editor on it. The organization root
    // needs organization editor, or only membership when `anyMember` is set,
    // which is how root workspaces are created.
    private async requireParentAccess({
        userId,
        organizationId,
        parentWorkspaceId,
        anyMember = false,
    }: {
        userId: string
        organizationId: string
        parentWorkspaceId: string | undefined
        anyMember?: boolean
    }): Promise<WorkspaceMeta | undefined> {
        if (parentWorkspaceId) {
            const parent = await this.requireWorkspaceAccess(
                userId,
                parentWorkspaceId,
                'editor',
            )

            if (parent.organizationId !== organizationId)
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.CROSS_ORGANIZATION)

            return parent
        }

        const level = await this.options.organizations.getMembershipLevel(userId, organizationId)

        if (
            !level
            || (!anyMember && !canEditWorkspace(level))
        )
            throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.PERMISSION_DENIED)

        return undefined
    }

    // =========================================================================
    // PLACEMENT
    // =========================================================================

    // Resolves neighbor ids to the positions on either side of the new place.
    // `afterEntryId` names the sibling the entry follows and `beforeEntryId`
    // the sibling it precedes. Without either, the entry goes last. Entries
    // that are moving are left out of the sibling list.
    private resolveGap(
        siblings: WorkspaceTreeRow[],
        placement: WorkspaceTreePlacement,
    ): {
        low?: string
        high?: string
    } {
        const indexOf = (entryId: string): number => {
            const index = siblings.findIndex(row => row.entryId === entryId)

            if (index < 0)
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.STALE)

            return index
        }
        let insertAt = siblings.length

        if (placement.afterEntryId) {
            insertAt = indexOf(placement.afterEntryId) + 1

            if (
                placement.beforeEntryId
                && siblings[insertAt]?.entryId !== placement.beforeEntryId
            )
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.STALE)
        } else if (placement.beforeEntryId)
            insertAt = indexOf(placement.beforeEntryId)

        return {
            low: siblings[insertAt - 1]?.position,
            high: siblings[insertAt]?.position,
        }
    }

    // A standalone text block cannot be inserted between members of one list.
    private async assertWholeListGap(
        organizationId: string,
        siblings: WorkspaceTreeRow[],
        placement: WorkspaceTreePlacement,
    ): Promise<void> {
        const insertAt = placement.afterEntryId
            ? siblings.findIndex(row => row.entryId === placement.afterEntryId) + 1
            : placement.beforeEntryId
                ? siblings.findIndex(row => row.entryId === placement.beforeEntryId)
                : siblings.length
        const left = siblings[insertAt - 1]
        const right = siblings[insertAt]

        if (
            !left
            || !right
        )
            return

        const head = await this.navigationHead(organizationId)

        if (!head)
            throw new Error('WORKSPACE_NAVIGATION_REVISION_MISSING')

        const document = await this.repository.getNavigationDocument(organizationId, head.revisionId)
        const index = indexNavigationDocument(document)
        const leftAncestors = new Set<string>()
        let cursor = left.entryId

        while (cursor) {
            leftAncestors.add(cursor)
            cursor = index.get(cursor)?.parentId ?? ''
        }

        cursor = right.entryId

        while (cursor) {
            if (leftAncestors.has(cursor)) {
                const type = index.get(cursor)?.node.type

                if (
                    type === 'list_item'
                    || type === 'bullet_list'
                )
                    throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_INVALID')

                break
            }

            cursor = index.get(cursor)?.parentId ?? ''
        }
    }

    private async settleNavigationLock(organizationId: string): Promise<void> {
        const held = await this.repository.getLock(organizationId)

        if (
            held
            && held.expiresAt > this.now()
        )
            throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.BUSY)

        if (held)
            await this.resume(held)
    }

    // Computes `count` positions for the gap. When the gap is too narrow, or
    // the positions would grow past the rebalance length, the level is
    // rebalanced under the lock and the gap is resolved again.
    private async placeInLevel({
        userId,
        organizationId,
        parentWorkspaceId,
        placement,
        moving,
        count,
        standalone = false,
    }: {
        userId: string
        organizationId: string
        parentWorkspaceId: string | undefined
        placement: WorkspaceTreePlacement
        moving: Set<string>
        count: number
        standalone?: boolean
    }): Promise<{
        positions: string[]
        navigationRevisionId?: string
    }> {
        await this.settleNavigationLock(organizationId)

        for (let attempt = 0; attempt < 2; attempt += 1) {
            const head = await this.navigationHead(organizationId)
            const siblings = (await this.repository.listChildRows(organizationId, parentWorkspaceId)).filter(row => !moving.has(row.entryId))
            const gap = this.resolveGap(siblings, placement)

            if (standalone)
                await this.assertWholeListGap(
                    organizationId,
                    siblings,
                    placement,
                )

            const fits = gap.low === undefined
                || gap.high === undefined
                || gap.low < gap.high

            if (fits) {
                const positions = positionsBetween(
                    gap.low,
                    gap.high,
                    count,
                )

                if (
                    !positions.some(needsRebalance)
                    || attempt > 0
                )
                    return {
                        positions,
                        navigationRevisionId: head?.revisionId,
                    }
            }

            await this.rebalance(
                userId,
                organizationId,
                parentWorkspaceId,
            )
        }

        throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.STALE)
    }

    // =========================================================================
    // LOCK-FREE MUTATIONS
    // =========================================================================

    // Commits a change set that needs no lock. When the commit fails, a held
    // lock means another structure change is running: an expired one is
    // finished here and the commit retried once, a live one is reported as
    // busy. Otherwise the caller's view was stale.
    private async commitWithoutLock(
        userId: string,
        organizationId: string,
        changes: WorkspaceTreeChange[],
        expectedNavigationRevisionId?: string,
    ): Promise<void> {
        await this.runLocked(
            userId,
            organizationId,
            'mutation',
            organizationId,
            {
                changes,
                ...(expectedNavigationRevisionId ? { expectedNavigationRevisionId } : {}),
            },
        )
    }

    private async requireOrganizationTags(
        organizationId: string,
        tagIds: string[],
    ): Promise<string[]> {
        const organization = await this.options.organizations.getOrganization(organizationId)
        const known = new Set(
            Object.keys(organization?.tags ?? {}),
        )
        const unique = [...new Set(tagIds)]

        if (unique.some(tagId => typeof tagId !== 'string' || !known.has(tagId)))
            throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.TAG_UNKNOWN)

        return unique
    }

    async createWorkspace(
        userId: string,
        request: CreateWorkspaceRequest,
    ): Promise<CreatedWorkspace> {
        const name = requireBlockText(request.name)
        const parent = await this.requireParentAccess({
            userId,
            organizationId: request.organizationId,
            parentWorkspaceId: request.parentWorkspaceId,
            anyMember: true,
        })
        const {
            positions: [position],
        } = await this.placeInLevel({
            userId,
            organizationId: request.organizationId,
            parentWorkspaceId: request.parentWorkspaceId,
            placement: request,
            moving: new Set(),
            count: 1,
        })
        const now = this.now()
        const workspace: WorkspaceMeta = {
            workspaceId: this.createId(),
            organizationId: request.organizationId,
            name,
            tagIds: [],
            ...(parent ? { parentWorkspaceId: parent.workspaceId } : {}),
            ancestorIds: parent ? [...(parent.ancestorIds ?? []), parent.workspaceId] : [],
            position,
            createdAt: now,
            updatedAt: now,
        }

        await this.commitWithoutLock(
            userId,
            request.organizationId,
            [
                {
                    type: 'createWorkspace',
                    workspace: {
                        ...(this.options.createWorkspaceContent?.() ?? {}),
                        ...workspace,
                    },
                    grant: {
                        userId,
                        workspaceId: workspace.workspaceId,
                        accessLevel: 'owner',
                        createdAt: now,
                        updatedAt: now,
                    },
                },
                {
                    type: 'putTreeRow',
                    row: {
                        ...treeRowKey(
                            request.organizationId,
                            parent?.workspaceId,
                            position,
                            workspace.workspaceId,
                        ),
                        entryType: 'workspace',
                        entryId: workspace.workspaceId,
                        organizationId: request.organizationId,
                        ...(parent ? { parentWorkspaceId: parent.workspaceId } : {}),
                        position,
                        createdAt: now,
                        updatedAt: now,
                    },
                    requireAbsent: true,
                },
                // The parent must still exist, keep its ancestors and not be
                // in the middle of a delete when the child is added.
                ...(parent
                    ? [{
                        type: 'checkWorkspace' as const,
                        workspaceId: parent.workspaceId,
                        expect: {
                            ancestorIds: parent.ancestorIds ?? [],
                            notDeleting: true,
                        },
                    }]
                    : []),
            ],
        )

        return {
            workspace,
            tree: await this.getOrganizationTree(userId, request.organizationId),
        }
    }

    async updateWorkspace(
        userId: string,
        request: UpdateWorkspaceRequest,
    ): Promise<WorkspaceTree> {
        const workspace = await this.requireWorkspaceAccess(
            userId,
            request.workspaceId,
            'editor',
        )
        const note = normalizeNote(request.note)
        const tagIds = request.tagIds === undefined
            ? undefined
            : await this.requireOrganizationTags(workspace.organizationId, request.tagIds)

        await this.commitWithoutLock(
            userId,
            workspace.organizationId,
            [{
                type: 'patchWorkspace',
                workspaceId: workspace.workspaceId,
                patch: {
                    ...(request.name !== undefined ? { name: requireBlockText(request.name) } : {}),
                    ...(note !== undefined ? { note } : {}),
                    ...(tagIds !== undefined ? { tagIds } : {}),
                    updatedAt: this.now(),
                },
                expect: { notDeleting: true },
            }],
        )

        return await this.getOrganizationTree(userId, workspace.organizationId)
    }

    private async requireHeading(
        organizationId: string,
        headingId: string,
    ): Promise<WorkspaceTreeRow> {
        const pointer = await this.repository.getHeadingPointer(organizationId, headingId)
        const row = pointer
            ? (await this.repository.listChildRows(organizationId, pointer.parentWorkspaceId)).find(entry => entry.entryId === headingId)
            : undefined

        if (
            !row
            || row.entryType !== 'heading'
        )
            throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.NOT_FOUND)

        return row
    }

    async createHeading(
        userId: string,
        request: CreateWorkspaceHeadingRequest,
    ): Promise<WorkspaceTree> {
        const name = requireBlockText(request.name)
        const level = requireLevel(request.level)

        if (
            request.parentWorkspaceId
            && level !== 0
        )
            throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_INVALID')

        const note = normalizeNote(request.note)
        await this.requireParentAccess({
            userId,
            organizationId: request.organizationId,
            parentWorkspaceId: request.parentWorkspaceId,
        })
        const {
            positions: [position],
            navigationRevisionId,
        } = await this.placeInLevel({
            userId,
            organizationId: request.organizationId,
            parentWorkspaceId: request.parentWorkspaceId,
            placement: request,
            moving: new Set(),
            count: 1,
            standalone: !request.parentWorkspaceId,
        })
        const now = this.now()
        const headingId = this.createId()

        await this.commitWithoutLock(
            userId,
            request.organizationId,
            [
                {
                    type: 'putTreeRow',
                    row: {
                        ...treeRowKey(
                            request.organizationId,
                            request.parentWorkspaceId,
                            position,
                            headingId,
                        ),
                        entryType: 'heading',
                        entryId: headingId,
                        organizationId: request.organizationId,
                        ...(request.parentWorkspaceId ? { parentWorkspaceId: request.parentWorkspaceId } : {}),
                        position,
                        name,
                        level,
                        ...(note ? { note } : {}),
                        createdAt: now,
                        updatedAt: now,
                    },
                    requireAbsent: true,
                },
                {
                    type: 'putHeadingPointer',
                    pointer: {
                        organizationId: request.organizationId,
                        headingId,
                        ...(request.parentWorkspaceId ? { parentWorkspaceId: request.parentWorkspaceId } : {}),
                        position,
                    },
                },
            ],
            navigationRevisionId,
        )

        return await this.getOrganizationTree(userId, request.organizationId)
    }

    async updateHeading(
        userId: string,
        request: UpdateWorkspaceHeadingRequest,
    ): Promise<WorkspaceTree> {
        await this.settleNavigationLock(request.organizationId)
        const head = await this.navigationHead(request.organizationId)
        const row = await this.requireHeading(request.organizationId, request.headingId)

        await this.requireParentAccess({
            userId,
            organizationId: request.organizationId,
            parentWorkspaceId: row.parentWorkspaceId,
        })
        const level = request.level === undefined ? row.level : requireLevel(request.level)

        if (!head)
            throw new Error('WORKSPACE_NAVIGATION_REVISION_MISSING')

        if (level !== 0) {
            const document = await this.repository.getNavigationDocument(request.organizationId, head.revisionId)
            const node = indexNavigationDocument(document).get(row.entryId)?.node

            if (
                row.parentWorkspaceId
                || node?.type === 'list_item'
            )
                throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_INVALID')
        }

        const note = normalizeNote(request.note)
        const next: WorkspaceTreeRow = {
            ...row,
            ...(request.name !== undefined ? { name: requireBlockText(request.name) } : {}),
            ...(request.level !== undefined ? { level } : {}),
            updatedAt: this.now(),
        }

        if (note === null)
            delete next.note
        else if (note !== undefined)
            next.note = note

        await this.commitWithoutLock(
            userId,
            request.organizationId,
            [{
                type: 'putTreeRow',
                row: next,
            }],
            head.revisionId,
        )

        return await this.getOrganizationTree(userId, request.organizationId)
    }

    // Deleting a heading leaves its entries in place, where they join the
    // enclosing section.
    async deleteHeading(
        userId: string,
        request: DeleteWorkspaceHeadingRequest,
    ): Promise<WorkspaceTree> {
        const row = await this.requireHeading(request.organizationId, request.headingId)
        await this.requireParentAccess({
            userId,
            organizationId: request.organizationId,
            parentWorkspaceId: row.parentWorkspaceId,
        })

        await this.commitWithoutLock(
            userId,
            request.organizationId,
            [
                {
                    type: 'deleteTreeRow',
                    key: row,
                },
                {
                    type: 'deleteHeadingPointer',
                    organizationId: request.organizationId,
                    headingId: request.headingId,
                },
            ],
        )

        return await this.getOrganizationTree(userId, request.organizationId)
    }

    // =========================================================================
    // LOCKED OPERATIONS
    // =========================================================================

    // Takes the organization's lock for one operation, runs it while renewing
    // the lock, and releases it. A failure leaves the lock in place so the
    // startup sweep or the next structure change finishes the operation.
    private async runLocked(
        userId: string,
        organizationId: string,
        operation: WorkspaceTreeLockOperation,
        entryId: string,
        parameters: Record<string, unknown>,
    ): Promise<WorkspaceTreeLock> {
        const now = this.now()
        const lock: WorkspaceTreeLock = {
            organizationId,
            operationId: this.createId(),
            operation,
            entryId,
            userId,
            phase: 'start',
            parameters,
            acquiredAt: now,
            expiresAt: now + this.lockTtlMs,
        }

        if (!(await this.repository.acquireLock(lock))) {
            const held = await this.repository.getLock(organizationId)

            if (
                held
                && held.expiresAt > this.now()
            )
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.BUSY)

            if (held)
                await this.resume(held)

            if (!(await this.repository.acquireLock(lock)))
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.BUSY)
        }

        try {
            await this.validateLockedOperation(lock)
        } catch (error) {
            await this.repository.releaseLock(organizationId, lock.operationId)

            throw error
        }

        await this.execute(lock)

        return lock
    }

    private async validateLockedOperation(lock: WorkspaceTreeLock): Promise<void> {
        const expected = lock.parameters.expectedNavigationRevisionId

        if (
            typeof expected === 'string'
            && (await this.navigationHead(lock.organizationId))?.revisionId !== expected
        )
            throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.STALE)

        const resolver = new WorkspaceAccessResolver(this.repository, false)
        const workspace = async (
            id: string,
            required: AccessLevel = 'editor',
        ): Promise<WorkspaceMeta> => {
            const resolution = await resolver.resolve({
                userId: lock.userId,
                workspaceId: id,
            })

            if (
                resolution.status !== 'granted'
                || !hasAccessLevel(resolution.grant.accessLevel, required)
            )
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.PERMISSION_DENIED)

            if (resolution.workspace.organizationId !== lock.organizationId)
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.CROSS_ORGANIZATION)

            return resolution.workspace
        }
        const parent = async (
            id?: string,
            anyMember = false,
        ): Promise<string[]> => {
            if (id) {
                const meta = await workspace(id)

                return [...(meta.ancestorIds ?? []), id]
            }

            const level = await this.options.organizations.getMembershipLevel(lock.userId, lock.organizationId)

            if (
                !level
                || (!anyMember && !canEditWorkspace(level))
            )
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.PERMISSION_DENIED)

            return []
        }

        if (lock.operation === 'saveNavigation') {
            const receipt = (await this.repository.getNavigationRecord(lock.organizationId, `MUTATION#${lock.parameters.mutationId}`)) as WorkspaceNavigationMutation | undefined

            if (
                receipt
                && (receipt.userId !== lock.userId || receipt.requestHash !== lock.parameters.requestHash)
            )
                throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_MUTATION_REUSED')

            const current = await this.navigationHead(lock.organizationId)
            const base = lock.parameters.navigationBase as WorkspaceNavigationHead

            if (current?.revisionId !== base.revisionId)
                throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_STALE')

            for (const id of lock.parameters.createdWorkspaceIds as string[])
                if (await this.repository.getWorkspaceMeta(id))
                    throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_ID_COLLISION')

            await this.validateNavigationPermissions(
                lock.userId,
                lock.organizationId,
                await this.repository.getNavigationDocument(lock.organizationId, base.revisionId),
                await this.repository.getNavigationDocument(
                    lock.organizationId,
                    (lock.parameters.navigationTarget as WorkspaceNavigationHead).revisionId,
                ),
                new Set(lock.parameters.deletedWorkspaceIds as string[]),
                new Set(lock.parameters.createdWorkspaceIds as string[]),
                resolver,
            )
        } else if (lock.operation === 'mutation') {
            for (const change of lock.parameters.changes as WorkspaceTreeChange[]) {
                if (change.type === 'createWorkspace')
                    await parent(change.workspace.parentWorkspaceId, true)
                else if (change.type === 'patchWorkspace')
                    await workspace(change.workspaceId)
                else if (
                    change.type === 'putTreeRow'
                    && change.row.entryType === 'heading'
                )
                    await parent(change.row.parentWorkspaceId)
                else if (
                    change.type === 'deleteTreeRow'
                    && (change.key as WorkspaceTreeRow).entryType === 'heading'
                )
                    await parent((change.key as WorkspaceTreeRow).parentWorkspaceId)

                if (
                    change.type === 'checkWorkspace'
                    || change.type === 'patchWorkspace'
                ) {
                    const meta = await this.repository.getWorkspaceMeta(change.workspaceId)

                    if (
                        !meta
                        || (change.expect?.notDeleting && meta.deletingAt !== undefined)
                        || (change.expect?.ancestorIds && !sameList(change.expect.ancestorIds, meta.ancestorIds))
                    )
                        throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.STALE)
                }
            }
        } else if (lock.operation === 'delete')
            await workspace(lock.entryId, 'owner')
        else if (
            lock.operation === 'move'
            || lock.operation === 'sectionMove'
        ) {
            const parameters = lock.parameters as MoveParameters & SectionMoveParameters
            const ancestors = await parent(parameters.toParentId)
            const ids = lock.operation === 'move' ? [parameters.workspaceId] : parameters.entries.filter(entry => entry.entryType === 'workspace').map(
                entry => entry.entryId,
            )

            for (const id of ids) {
                await workspace(id)

                if (ancestors.includes(id))
                    throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.CYCLE)
            }

            if (!sameList(ancestors, parameters.newAncestorIds))
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.STALE)

            if (lock.operation === 'sectionMove')
                await parent(parameters.fromParentId)
        }
    }

    private async execute(lock: WorkspaceTreeLock): Promise<void> {
        const renewal = setInterval(
            () => void this.repository.renewLock(
                lock.organizationId,
                lock.operationId,
                this.now() + this.lockTtlMs,
            ),
            this.lockRenewIntervalMs,
        )
        ;(renewal as { unref?: () => void }).unref?.()

        try {
            let base = lock.parameters.navigationBase as WorkspaceNavigationHead | undefined

            if (!base) {
                base = await this.navigationHead(lock.organizationId)

                if (!base) {
                    if ((await this.repository.listChildRows(lock.organizationId, undefined)).length)
                        throw new Error('WORKSPACE_NAVIGATION_REVISION_MISSING')

                    const document = createEmptyNavigationDocument(this.createId)
                    base = {
                        revision: 0,
                        revisionId: this.createId(),
                        schemaVersion: 1,
                    }
                    await this.repository.putNavigationDocument(
                        lock.organizationId,
                        base.revisionId,
                        document,
                    )
                    await this.commitLocked(
                        lock,
                        [{
                            type: 'putNavigationRecord',
                            key: 'HEAD',
                            value: base,
                        }],
                    )
                }

                lock.parameters.navigationBase = base
                await this.repository.updateLock(
                    lock.organizationId,
                    lock.operationId,
                    {
                        phase: lock.phase,
                        parameters: lock.parameters,
                    },
                )
            }

            if (lock.operation !== 'initializeNavigation') {
                if (lock.operation === 'move')
                    await this.executeMove(lock)
                else if (lock.operation === 'sectionMove')
                    await this.executeSectionMove(lock)
                else if (lock.operation === 'rebalance')
                    await this.executeRebalance(lock)
                else if (lock.operation === 'delete')
                    await this.executeDelete(lock)
                else if (lock.operation === 'saveNavigation')
                    await this.executeSaveNavigation(lock)
                else {
                    const changes: WorkspaceTreeChange[] = []

                    for (const change of lock.parameters.changes as WorkspaceTreeChange[]) {
                        if (
                            change.type === 'createWorkspace'
                            && (await this.repository.getWorkspaceMeta(change.workspace.workspaceId))
                        )
                            continue

                        changes.push(change.type === 'putTreeRow' ? {
                            ...change,
                            requireAbsent: false,
                        } : change)
                    }

                    await this.commitLocked(lock, changes)
                }

                if (lock.parameters.navigationAborted) {
                    await this.repository.releaseLock(lock.organizationId, lock.operationId)

                    return
                }

                let target = lock.parameters.navigationTarget as WorkspaceNavigationHead | undefined

                if (!target) {
                    const projection = await this.readProjection(lock.organizationId)
                    const source = await this.repository.getNavigationDocument(lock.organizationId, base.revisionId)
                    const document = reconcileNavigationProjection(
                        source,
                        projection.rowsByParent,
                        projection.metas,
                        this.createId,
                    )
                    target = {
                        revision: base.revision + 1,
                        revisionId: this.createId(),
                        schemaVersion: 1,
                    }
                    await this.repository.putNavigationDocument(
                        lock.organizationId,
                        target.revisionId,
                        document,
                    )
                    lock.parameters.navigationTarget = target
                    await this.repository.updateLock(
                        lock.organizationId,
                        lock.operationId,
                        {
                            phase: 'publish',
                            parameters: lock.parameters,
                        },
                    )
                }

                await this.commitLocked(
                    lock,
                    [
                        {
                            type: 'putNavigationRecord',
                            key: 'HEAD',
                            value: target,
                        },
                        ...(lock.operation === 'saveNavigation' ? [{
                            type: 'putNavigationRecord' as const,
                            key: `MUTATION#${lock.parameters.mutationId}`,
                            requireAbsent: true,
                            value: {
                                ...target,
                                userId: lock.userId,
                                requestHash: lock.parameters.requestHash as string,
                            },
                        }] : []),
                    ],
                )
            }
        } finally {
            clearInterval(renewal)
        }

        await this.repository.releaseLock(lock.organizationId, lock.operationId)
    }

    // Finishes an expired operation as a new holder. Another process that
    // takes it over first wins, and this call returns without running it.
    private async resume(expired: WorkspaceTreeLock): Promise<void> {
        const now = this.now()
        const next = {
            operationId: this.createId(),
            acquiredAt: now,
            expiresAt: now + this.lockTtlMs,
        }

        if (!(await this.repository.takeOverLock(expired, next)))
            return

        await this.execute({
            ...expired,
            ...next,
        })
    }

    // Finishes every operation whose holder stopped renewing its lock. The
    // application calls this at startup.
    async resumeExpiredOperations(): Promise<number> {
        let resumed = 0

        for (const lock of await this.repository.listLocks()) {
            if (lock.expiresAt > this.now())
                continue

            await this.resume(lock)
            resumed += 1
        }

        return resumed
    }

    // Commits changes under the lock, split so each commit fits one
    // transaction.
    private async commitLocked(
        lock: WorkspaceTreeLock,
        changes: WorkspaceTreeChange[],
    ): Promise<void> {
        let batch: WorkspaceTreeChange[] = []
        let items = 0

        for (const change of changes) {
            const count = workspaceTreeChangeItemCount(change)

            if (items + count > MAX_COMMIT_ITEMS) {
                await this.repository.commit({
                    organizationId: lock.organizationId,
                    lockOperationId: lock.operationId,
                    changes: batch,
                })
                batch = []
                items = 0
            }

            batch.push(change)
            items += count
        }

        if (batch.length)
            await this.repository.commit({
                organizationId: lock.organizationId,
                lockOperationId: lock.operationId,
                changes: batch,
            })
    }

    // Walks the subtree under a workspace through the tree rows, parent
    // first, and returns the meta row of every descendant.
    private async listDescendants(root: WorkspaceMeta): Promise<WorkspaceMeta[]> {
        const descendants: WorkspaceMeta[] = []
        let frontier = [root]

        while (frontier.length) {
            const rows = (await Promise.all(
                frontier.map(async parent => await this.repository.listChildRows(parent.organizationId, parent.workspaceId)),
            )).flat()
            const metas = await this.repository.getWorkspaceMetas(
                rows.filter(row => row.entryType === 'workspace').map(row => row.entryId),
            )
            descendants.push(...metas)
            frontier = metas
        }

        return descendants
    }

    // Rewrites the ancestor chain of every descendant of `workspace` so it
    // starts with `newAncestorIds`. Each descendant's new chain is computed
    // from its current one, so running this again after an interruption
    // produces the same result.
    private async rewriteDescendantAncestors(
        lock: WorkspaceTreeLock,
        workspace: WorkspaceMeta,
        newAncestorIds: string[],
    ): Promise<void> {
        const changes: WorkspaceTreeChange[] = []

        for (const descendant of await this.listDescendants(workspace)) {
            const index = (descendant.ancestorIds ?? []).indexOf(workspace.workspaceId)

            if (index < 0)
                continue

            const nextChain = [...newAncestorIds, ...descendant.ancestorIds.slice(index)]

            if (sameList(nextChain, descendant.ancestorIds))
                continue

            changes.push({
                type: 'patchWorkspace',
                workspaceId: descendant.workspaceId,
                patch: {
                    ancestorIds: nextChain,
                    updatedAt: this.now(),
                },
                expect: { ancestorIds: descendant.ancestorIds },
            })
        }

        await this.commitLocked(lock, changes)
    }

    // Moves one workspace row to its target place. Already moved workspaces
    // are left alone. A move to another parent first rewrites the ancestor
    // chains under the workspace; a reorder within a level skips that walk.
    private async swapWorkspace(
        lock: WorkspaceTreeLock,
        workspaceId: string,
        toParentId: string | undefined,
        toPosition: string,
        newAncestorIds: string[],
    ): Promise<void> {
        const meta = await this.repository.getWorkspaceMeta(workspaceId)

        if (!meta)
            return

        if (!sameList(meta.ancestorIds, newAncestorIds))
            await this.rewriteDescendantAncestors(
                lock,
                meta,
                newAncestorIds,
            )

        if (
            meta.parentWorkspaceId === toParentId
            && meta.position === toPosition
            && sameList(meta.ancestorIds, newAncestorIds)
        )
            return

        const now = this.now()
        await this.commitLocked(
            lock,
            [
                {
                    type: 'deleteTreeRow',
                    key: treeRowKey(
                        meta.organizationId,
                        meta.parentWorkspaceId,
                        meta.position,
                        workspaceId,
                    ),
                },
                {
                    type: 'putTreeRow',
                    row: {
                        ...treeRowKey(
                            meta.organizationId,
                            toParentId,
                            toPosition,
                            workspaceId,
                        ),
                        entryType: 'workspace',
                        entryId: workspaceId,
                        organizationId: meta.organizationId,
                        ...(toParentId ? { parentWorkspaceId: toParentId } : {}),
                        position: toPosition,
                        createdAt: meta.createdAt,
                        updatedAt: now,
                    },
                },
                {
                    type: 'patchWorkspace',
                    workspaceId,
                    patch: {
                        parentWorkspaceId: toParentId ?? null,
                        ancestorIds: newAncestorIds,
                        position: toPosition,
                        updatedAt: now,
                    },
                    expect: { ancestorIds: meta.ancestorIds ?? [] },
                },
            ],
        )
    }

    private async swapHeading(
        lock: WorkspaceTreeLock,
        headingId: string,
        toParentId: string | undefined,
        toPosition: string,
    ): Promise<void> {
        const pointer = await this.repository.getHeadingPointer(lock.organizationId, headingId)

        if (
            !pointer
            || (pointer.parentWorkspaceId === toParentId && pointer.position === toPosition)
        )
            return

        const row = (await this.repository.listChildRows(lock.organizationId, pointer.parentWorkspaceId)).find(entry => entry.entryId === headingId)

        if (!row)
            return

        const moved: WorkspaceTreeRow = {
            ...row,
            ...treeRowKey(
                lock.organizationId,
                toParentId,
                toPosition,
                headingId,
            ),
            position: toPosition,
            updatedAt: this.now(),
        }

        if (toParentId)
            moved.parentWorkspaceId = toParentId
        else
            delete moved.parentWorkspaceId

        await this.commitLocked(
            lock,
            [
                {
                    type: 'deleteTreeRow',
                    key: row,
                },
                {
                    type: 'putTreeRow',
                    row: moved,
                },
                {
                    type: 'putHeadingPointer',
                    pointer: {
                        organizationId: lock.organizationId,
                        headingId,
                        ...(toParentId ? { parentWorkspaceId: toParentId } : {}),
                        position: toPosition,
                    },
                },
            ],
        )
    }

    private async executeMove(lock: WorkspaceTreeLock): Promise<void> {
        const parameters = lock.parameters as MoveParameters

        await this.swapWorkspace(
            lock,
            parameters.workspaceId,
            parameters.toParentId,
            parameters.toPosition,
            parameters.newAncestorIds,
        )
    }

    private async executeSectionMove(lock: WorkspaceTreeLock): Promise<void> {
        const parameters = lock.parameters as SectionMoveParameters

        for (const entry of parameters.entries) {
            if (entry.entryType === 'workspace')
                await this.swapWorkspace(
                    lock,
                    entry.entryId,
                    parameters.toParentId,
                    entry.toPosition,
                    parameters.newAncestorIds,
                )
            else
                await this.swapHeading(
                    lock,
                    entry.entryId,
                    parameters.toParentId,
                    entry.toPosition,
                )
        }
    }

    private async executeRebalance(lock: WorkspaceTreeLock): Promise<void> {
        const parameters = lock.parameters as RebalanceParameters

        for (const row of await this.repository.listChildRows(lock.organizationId, parameters.parentWorkspaceId)) {
            const position = parameters.positions[row.entryId]

            if (
                !position
                || position === row.position
            )
                continue

            if (row.entryType === 'heading')
                await this.swapHeading(
                    lock,
                    row.entryId,
                    parameters.parentWorkspaceId,
                    position,
                )
            else {
                const meta = await this.repository.getWorkspaceMeta(row.entryId)

                if (meta)
                    await this.swapWorkspace(
                        lock,
                        row.entryId,
                        parameters.parentWorkspaceId,
                        position,
                        meta.ancestorIds ?? [],
                    )
            }
        }
    }

    private async rebalance(
        userId: string,
        organizationId: string,
        parentWorkspaceId: string | undefined,
    ): Promise<void> {
        const rows = await this.repository.listChildRows(organizationId, parentWorkspaceId)
        const positions = rebalancePositions(rows.length)

        await this.runLocked(
            userId,
            organizationId,
            'rebalance',
            parentWorkspaceId ?? organizationId,
            {
                ...(parentWorkspaceId ? { parentWorkspaceId } : {}),
                positions: Object.fromEntries(
                    rows.map((row, index) => [row.entryId, positions[index]]),
                ),
            } satisfies RebalanceParameters,
        )
    }

    // Resolves the destination of a move and checks the D6 rules for it.
    private async resolveDestination(
        userId: string,
        organizationId: string,
        toParentId: string | undefined,
    ): Promise<string[]> {
        const parent = await this.requireParentAccess({
            userId,
            organizationId,
            parentWorkspaceId: toParentId,
        })

        return parent ? [...(parent.ancestorIds ?? []), parent.workspaceId] : []
    }

    async moveWorkspace(
        userId: string,
        request: MoveWorkspaceRequest,
    ): Promise<WorkspaceTree> {
        const workspace = await this.requireWorkspaceAccess(
            userId,
            request.workspaceId,
            'editor',
        )

        if (request.parentWorkspaceId) {
            const destination = await this.repository.getWorkspaceMeta(request.parentWorkspaceId)

            if (!destination)
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.NOT_FOUND)

            if (destination.organizationId !== workspace.organizationId)
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.CROSS_ORGANIZATION)

            if (wouldCreateCycle({
                workspaceId: workspace.workspaceId,
                targetParentId: destination.workspaceId,
                targetAncestorIds: destination.ancestorIds ?? [],
            }))
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.CYCLE)
        }

        const newAncestorIds = await this.resolveDestination(
            userId,
            workspace.organizationId,
            request.parentWorkspaceId,
        )
        const {
            positions: [toPosition],
        } = await this.placeInLevel({
            userId,
            organizationId: workspace.organizationId,
            parentWorkspaceId: request.parentWorkspaceId,
            placement: request,
            moving: new Set([workspace.workspaceId]),
            count: 1,
        })

        await this.runLocked(
            userId,
            workspace.organizationId,
            'move',
            workspace.workspaceId,
            {
                workspaceId: workspace.workspaceId,
                ...(request.parentWorkspaceId ? { toParentId: request.parentWorkspaceId } : {}),
                toPosition,
                newAncestorIds,
            } satisfies MoveParameters,
        )

        return await this.getOrganizationTree(userId, workspace.organizationId)
    }

    // Moves a heading with its whole outline section, in order.
    async moveHeading(
        userId: string,
        request: MoveWorkspaceHeadingRequest,
    ): Promise<WorkspaceTree> {
        await this.settleNavigationLock(request.organizationId)
        const head = await this.navigationHead(request.organizationId)
        const heading = await this.requireHeading(request.organizationId, request.headingId)
        await this.requireParentAccess({
            userId,
            organizationId: request.organizationId,
            parentWorkspaceId: heading.parentWorkspaceId,
        })
        const siblings = await this.repository.listChildRows(request.organizationId, heading.parentWorkspaceId)
        const index = siblings.findIndex(row => row.entryId === heading.entryId)
        const range = outlineSectionRange(
            siblings.map(
                row => ({
                    entryId: row.entryId,
                    ...(row.entryType === 'heading'
                        && sectionLevel(row.level) !== undefined
                        ? { headingLevel: sectionLevel(row.level) }
                        : {}),
                }),
            ),
            index,
        )
        const section = siblings.slice(range.start, range.end)

        if (
            request.parentWorkspaceId
            && section.some(row => row.entryType === 'heading' && row.level !== 0)
        )
            throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_INVALID')

        if (!head)
            throw new Error('WORKSPACE_NAVIGATION_REVISION_MISSING')

        const document = await this.repository.getNavigationDocument(request.organizationId, head.revisionId)
        const sourceNode = indexNavigationDocument(document).get(heading.entryId)?.node

        if (
            sourceNode?.type === 'list_item'
            && sourceNode.content?.some(child => child.type === 'bullet_list' && child.content?.length)
        )
            throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_INVALID')

        const moving = new Set(
            section.map(row => row.entryId),
        )

        if (
            request.parentWorkspaceId
            && moving.has(request.parentWorkspaceId)
        )
            throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.CYCLE)

        if (request.parentWorkspaceId) {
            const destination = await this.repository.getWorkspaceMeta(request.parentWorkspaceId)

            if (!destination)
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.NOT_FOUND)

            if (destination.organizationId !== request.organizationId)
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.CROSS_ORGANIZATION)

            if ((destination.ancestorIds ?? []).some(id => moving.has(id)))
                throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.CYCLE)
        }

        for (const row of section.filter(entry => entry.entryType === 'workspace'))
            await this.requireWorkspaceAccess(
                userId,
                row.entryId,
                'editor',
            )

        const newAncestorIds = await this.resolveDestination(
            userId,
            request.organizationId,
            request.parentWorkspaceId,
        )
        const {
            positions,
            navigationRevisionId,
        } = await this.placeInLevel({
            userId,
            organizationId: request.organizationId,
            parentWorkspaceId: request.parentWorkspaceId,
            placement: request,
            moving,
            count: section.length,
            standalone: !request.parentWorkspaceId && (
                sourceNode?.type !== 'list_item'
                || Boolean(heading.parentWorkspaceId)
            ),
        })

        if (navigationRevisionId !== head.revisionId)
            throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.STALE)

        await this.runLocked(
            userId,
            request.organizationId,
            'sectionMove',
            request.headingId,
            {
                ...(heading.parentWorkspaceId ? { fromParentId: heading.parentWorkspaceId } : {}),
                ...(request.parentWorkspaceId ? { toParentId: request.parentWorkspaceId } : {}),
                newAncestorIds,
                ...(navigationRevisionId ? { expectedNavigationRevisionId: navigationRevisionId } : {}),
                entries: section.map(
                    (row, offset) => ({
                        entryId: row.entryId,
                        entryType: row.entryType,
                        toPosition: positions[offset],
                    }),
                ),
            } satisfies SectionMoveParameters & { expectedNavigationRevisionId?: string },
        )

        return await this.getOrganizationTree(userId, request.organizationId)
    }

    // =========================================================================
    // SUBTREE DELETE
    // =========================================================================

    // Deletes a workspace and everything under it. Every workspace is marked
    // as deleting first, parent first, which denies access to the whole
    // subtree at once. Then each workspace's conversations are stopped, and
    // the workspaces are cleaned up and removed deepest first, the target last.
    async deleteWorkspace(
        userId: string,
        workspaceId: string,
    ): Promise<DeleteWorkspaceResult> {
        const resolution = await this.access.resolve({
            userId,
            workspaceId,
        })

        if (resolution.status === 'not-found')
            throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.NOT_FOUND)

        if (
            resolution.status === 'denied'
            || resolution.grant.accessLevel !== 'owner'
        )
            throw new WorkspaceTreeError(WORKSPACE_TREE_ERROR.PERMISSION_DENIED)

        const organizationId = resolution.workspace.organizationId
        const lock = await this.runLocked(
            userId,
            organizationId,
            'delete',
            workspaceId,
            {
                workspaceId,
                deletedWorkspaceIds: [],
            } satisfies DeleteParameters,
        )
        const deletedWorkspaceIds = (lock.parameters as DeleteParameters).deletedWorkspaceIds

        return {
            deletedWorkspaceIds,
            tree: await this.getOrganizationTree(userId, organizationId),
        }
    }

    // Counts the workspaces a delete would remove, for the confirmation.
    async countSubtree(
        userId: string,
        workspaceId: string,
    ): Promise<number> {
        const workspace = await this.requireWorkspaceAccess(
            userId,
            workspaceId,
            'viewer',
        )

        return 1 + (await this.listDescendants(workspace)).length
    }

    private async executeDelete(
        lock: WorkspaceTreeLock,
        parameters: DeleteParameters = lock.parameters as DeleteParameters,
    ): Promise<void> {
        if (lock.operation === 'saveNavigation')
            lock.parameters.deletion = parameters

        const root = await this.repository.getWorkspaceMeta(parameters.workspaceId)

        if (!root)
            return

        const subtree = [root, ...(await this.listDescendants(root))]
        const deletingAt = this.now()

        await this.repository.updateLock(
            lock.organizationId,
            lock.operationId,
            { phase: 'mark' },
        )
        await this.commitLocked(
            lock,
            subtree.filter(workspace => workspace.deletingAt === undefined).map(
                workspace => ({
                    type: 'patchWorkspace' as const,
                    workspaceId: workspace.workspaceId,
                    patch: {
                        deletingAt,
                        updatedAt: deletingAt,
                    },
                }),
            ),
        )

        await this.repository.updateLock(
            lock.organizationId,
            lock.operationId,
            { phase: 'stop' },
        )

        for (const workspace of subtree)
            await this.options.deletion.stopConversations(workspace, lock.userId)

        await this.repository.updateLock(
            lock.organizationId,
            lock.operationId,
            { phase: 'remove' },
        )
        const deepestFirst = [...subtree].sort((left, right) => (right.ancestorIds?.length ?? 0) - (left.ancestorIds?.length ?? 0))

        for (const workspace of deepestFirst) {
            await this.options.deletion.cleanupWorkspace(workspace, lock.userId)
            const [grants, rows] = await Promise.all([
                this.repository.listWorkspaceGrants(workspace.workspaceId),
                this.repository.listChildRows(workspace.organizationId, workspace.workspaceId),
            ])

            const cleanupChanges: WorkspaceTreeChange[] = [
                ...rows.filter(row => row.entryType === 'heading').flatMap(
                    row => [
                        {
                            type: 'deleteTreeRow' as const,
                            key: row,
                        },
                        {
                            type: 'deleteHeadingPointer' as const,
                            organizationId: workspace.organizationId,
                            headingId: row.entryId,
                        },
                    ],
                ),
                ...grants.map(
                    grant => ({
                        type: 'deleteGrant' as const,
                        userId: grant.userId,
                        workspaceId: workspace.workspaceId,
                    }),
                ),
            ]
            const removalChanges: WorkspaceTreeChange[] = [
                {
                    type: 'deleteTreeRow',
                    key: treeRowKey(
                        workspace.organizationId,
                        workspace.parentWorkspaceId,
                        workspace.position,
                        workspace.workspaceId,
                    ),
                },
                {
                    type: 'deleteWorkspace',
                    workspaceId: workspace.workspaceId,
                },
            ]

            // Never split the parent-index removal from the full/meta
            // removal: recovery discovers descendants through that index.
            if (cleanupChanges.reduce((count, change) => count + workspaceTreeChangeItemCount(change), 0) + 3 > MAX_COMMIT_ITEMS) {
                await this.commitLocked(lock, cleanupChanges)
                await this.commitLocked(lock, removalChanges)
            } else
                await this.commitLocked(lock, [...cleanupChanges, ...removalChanges])

            parameters.deletedWorkspaceIds = [...new Set([
                ...parameters.deletedWorkspaceIds,
                workspace.workspaceId,
            ])]
            await this.repository.updateLock(
                lock.organizationId,
                lock.operationId,
                {
                    phase: 'remove',
                    parameters: lock.parameters,
                },
            )
        }
    }
}
