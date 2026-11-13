import {
    type WorkspaceMeta,
    type WorkspaceNavigationDocument,
} from '@lixpi/constants'

import { workspaceTreePartitionKey } from './table-keys.ts'
import {
    WorkspaceTreeConflict,
    type WorkspaceAccessChain,
    type WorkspaceGrantRow,
    type WorkspaceHeadingPointer,
    type WorkspaceNavigationHead,
    type WorkspaceNavigationFence,
    type WorkspaceNavigationMutation,
    type WorkspaceRowPatch,
    type WorkspaceTreeChange,
    type WorkspaceTreeCommit,
    type WorkspaceTreeLock,
    type WorkspaceTreeRepository,
    type WorkspaceTreeRow,
} from './workspace-tree-repository.ts'

import {
    nextNavigationAdmission,
    type NavigationPersistenceSettings,
} from './workspace-navigation-limits.ts'

const grantKey = (
    userId: string,
    workspaceId: string,
): string => `${userId}#${workspaceId}`

const applyPatch = <Row extends Record<string, unknown>>(
    row: Row,
    patch: WorkspaceRowPatch,
): Row => {
    const next: Record<string, unknown> = { ...row }

    for (const [field, value] of Object.entries(patch)) {
        if (value === undefined)
            continue

        if (value === null)
            delete next[field]
        else if (field === 'deletingAt')
            next[field] = next[field] ?? value
        else
            next[field] = structuredClone(value)
    }

    return next as Row
}

const sameList = (
    left: unknown,
    right: string[],
): boolean => Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index])

// Keeps the workspace tree in memory. Tests use it, and so can a repository
// that wants the tree without DynamoDB.
export class InMemoryWorkspaceTreeRepository implements WorkspaceTreeRepository {
    readonly metas = new Map<string, WorkspaceMeta>()
    readonly grants = new Map<string, WorkspaceGrantRow>()
    readonly treeRows = new Map<string, WorkspaceTreeRow>()
    readonly workspaces = new Map<string, Record<string, unknown>>()
    readonly headingPointers = new Map<string, WorkspaceHeadingPointer>()
    readonly locks = new Map<string, WorkspaceTreeLock>()
    readonly navigationRecords = new Map<string, WorkspaceNavigationHead | WorkspaceNavigationMutation>()
    readonly navigationDocuments = new Map<string, WorkspaceNavigationDocument>()

    readonly navigationAdmission = new Map<string, number>()

    admitNavigationWrite = async (
        userId: string,
        now: number,
        settings: Pick<NavigationPersistenceSettings, 'requestIntervalMs' | 'requestBurst'>,
    ): Promise<number> => {
        const admission = nextNavigationAdmission(
            this.navigationAdmission.get(userId),
            now,
            settings,
        )

        if (!admission.retryAfterMs)
            this.navigationAdmission.set(userId, admission.nextAt)

        return admission.retryAfterMs
    }

    recordUnchangedNavigation = async (
        organizationId: string,
        mutationId: string,
        receipt: WorkspaceNavigationMutation,
    ): Promise<boolean> => {
        const head = this.navigationRecords.get(`${organizationId}#HEAD`)
        const key = `${organizationId}#MUTATION#${mutationId}`

        if (
            this.locks.has(organizationId)
            || head?.revision !== receipt.revision
            || head.revisionId !== receipt.revisionId
            || this.navigationRecords.has(key)
        )
            return false

        this.navigationRecords.set(
            key,
            structuredClone(receipt),
        )

        return true
    }

    getNavigationRecord = async (
        organizationId: string,
        key: string,
    ): Promise<WorkspaceNavigationHead | WorkspaceNavigationMutation | undefined> => structuredClone(
        this.navigationRecords.get(`${organizationId}#${key}`),
    )

    getNavigationDocument = async (
        organizationId: string,
        revisionId: string,
    ): Promise<WorkspaceNavigationDocument> => {
        const document = this.navigationDocuments.get(`${organizationId}#${revisionId}`)

        if (!document)
            throw new Error('WORKSPACE_NAVIGATION_REVISION_MISSING')

        return structuredClone(document)
    }

    putNavigationDocument = async (
        organizationId: string,
        revisionId: string,
        document: WorkspaceNavigationDocument,
    ): Promise<void> => {
        const key = `${organizationId}#${revisionId}`

        if (this.navigationDocuments.has(key))
            throw new WorkspaceTreeConflict()

        this.navigationDocuments.set(
            key,
            structuredClone(document),
        )
    }

    // Runs before each commit is applied. Tests use it to simulate a crash.
    beforeCommit?: (commit: WorkspaceTreeCommit) => void

    putMeta(meta: WorkspaceMeta): void {
        this.metas.set(
            meta.workspaceId,
            structuredClone(meta),
        )
    }

    putGrant(grant: WorkspaceGrantRow): void {
        this.grants.set(
            grantKey(grant.userId, grant.workspaceId),
            { ...grant },
        )
    }

    deleteGrant(
        userId: string,
        workspaceId: string,
    ): void {
        this.grants.delete(
            grantKey(userId, workspaceId),
        )
    }

    putTreeRow(row: WorkspaceTreeRow): void {
        this.treeRows.set(`${row.pk}|${row.sk}`, { ...row })
    }

    deleteTreeRow(row: Pick<WorkspaceTreeRow, 'pk' | 'sk'>): void {
        this.treeRows.delete(`${row.pk}|${row.sk}`)
    }

    getWorkspaceCreationIdentity = async (workspaceId: string): Promise<string | undefined> =>
        this.workspaces.get(workspaceId)?.navigationCreationIdentity as string | undefined

    getWorkspaceMeta = async (workspaceId: string): Promise<WorkspaceMeta | undefined> => {
        const meta = this.metas.get(workspaceId)

        return meta ? structuredClone(meta) : undefined
    }

    getWorkspaceMetas = async (workspaceIds: string[]): Promise<WorkspaceMeta[]> =>
        [...new Set(workspaceIds)].flatMap(workspaceId => {
            const meta = this.metas.get(workspaceId)

            return meta ? [structuredClone(meta)] : []
        })

    readNavigationFences = async (organizationIds: string[]): Promise<Map<string, WorkspaceNavigationFence>> =>
        new Map(
            [...new Set(organizationIds)].map(organizationId => {
                const head = this.navigationRecords.get(`${organizationId}#HEAD`) as WorkspaceNavigationHead | undefined

                return [organizationId, {
                    locked: this.locks.has(organizationId),
                    ...(head?.revisionId
                        ? {
                            revisionId: head.revisionId,
                            head: {
                                revision: head.revision,
                                revisionId: head.revisionId,
                                schemaVersion: head.schemaVersion,
                            },
                        }
                        : {}),
                }]
            }),
        )

    readAccessChain = async (
        userId: string,
        workspaceIds: string[],
        organizationId?: string,
    ): Promise<WorkspaceAccessChain> => ({
        ...(organizationId === undefined ? {} : { locked: this.locks.has(organizationId) }),
        metas: new Map(
            workspaceIds.flatMap(workspaceId => {
                const meta = this.metas.get(workspaceId)

                return meta ? [[workspaceId, structuredClone(meta)] as const] : []
            }),
        ),
        grants: workspaceIds.flatMap(workspaceId => {
            const grant = this.grants.get(
                grantKey(userId, workspaceId),
            )

            return grant ? [{ ...grant }] : []
        }),
    })

    listUserGrants = async (userId: string): Promise<WorkspaceGrantRow[]> => [...this.grants.values()].filter(grant => grant.userId === userId).map(
        grant => ({ ...grant }),
    )

    listWorkspaceGrants = async (workspaceId: string): Promise<WorkspaceGrantRow[]> => [...this.grants.values()].filter(
        grant => grant.workspaceId === workspaceId,
    ).map(grant => ({ ...grant }))

    listChildRows = async (
        organizationId: string,
        parentWorkspaceId: string | undefined,
    ): Promise<WorkspaceTreeRow[]> => {
        const pk = workspaceTreePartitionKey(organizationId, parentWorkspaceId)

        return [...this.treeRows.values()].filter(row => row.pk === pk)
            .sort(
                (left, right) => left.sk < right.sk
                    ? -1
                    : left.sk > right.sk
                        ? 1
                        : 0,
            ).map(row => ({ ...row }))
    }

    getHeadingPointer = async (
        organizationId: string,
        headingId: string,
    ): Promise<WorkspaceHeadingPointer | undefined> => {
        const pointer = this.headingPointers.get(`${organizationId}#${headingId}`)

        return pointer ? { ...pointer } : undefined
    }

    commit = async (commit: WorkspaceTreeCommit): Promise<void> => {
        this.beforeCommit?.(commit)
        const lock = this.locks.get(commit.organizationId)

        if (commit.lockOperationId ? lock?.operationId !== commit.lockOperationId : lock)
            throw new WorkspaceTreeConflict()

        for (const change of commit.changes) {
            if (
                change.type === 'putNavigationRecord'
                && change.requireAbsent
                && this.navigationRecords.has(`${commit.organizationId}#${change.key}`)
            )
                throw new WorkspaceTreeConflict()

            this.assertCondition(change)
        }

        for (const change of commit.changes)
            this.apply(change, commit.organizationId)
    }

    private assertCondition(change: WorkspaceTreeChange): void {
        if (
            change.type === 'putTreeRow'
            && change.requireAbsent
            && this.treeRows.has(`${change.row.pk}|${change.row.sk}`)
        )
            throw new WorkspaceTreeConflict()

        if (
            change.type === 'patchWorkspace'
            || change.type === 'checkWorkspace'
        ) {
            const meta = this.metas.get(change.workspaceId)

            if (
                !meta
                || (change.expect?.notDeleting && meta.deletingAt !== undefined)
                || (change.expect?.ancestorIds && !sameList(meta.ancestorIds, change.expect.ancestorIds))
            )
                throw new WorkspaceTreeConflict()
        }

        if (
            change.type === 'createWorkspace'
            && this.metas.has(change.workspace.workspaceId)
        )
            throw new WorkspaceTreeConflict()
    }

    private apply(
        change: WorkspaceTreeChange,
        organizationId: string,
    ): void {
        if (change.type === 'putNavigationRecord')
            this.navigationRecords.set(
                `${organizationId}#${change.key}`,
                structuredClone(change.value),
            )
        else if (change.type === 'putTreeRow')
            this.putTreeRow(change.row)
        else if (change.type === 'deleteTreeRow')
            this.deleteTreeRow(change.key)
        else if (change.type === 'checkWorkspace')
            return
        else if (change.type === 'patchWorkspace') {
            this.metas.set(
                change.workspaceId,
                applyPatch(this.metas.get(change.workspaceId)!, change.patch),
            )
            this.workspaces.set(
                change.workspaceId,
                applyPatch(this.workspaces.get(change.workspaceId) ?? { workspaceId: change.workspaceId }, change.patch),
            )
        } else if (change.type === 'createWorkspace') {
            const {
                workspaceId,
                organizationId,
                name,
                note,
                tagIds,
                parentWorkspaceId,
                ancestorIds,
                position,
                createdAt,
                updatedAt,
            } = change.workspace
            this.workspaces.set(
                workspaceId,
                structuredClone(change.workspace),
            )
            this.putMeta({
                workspaceId,
                organizationId,
                name,
                ...(note ? { note } : {}),
                tagIds,
                ...(parentWorkspaceId ? { parentWorkspaceId } : {}),
                ancestorIds,
                position,
                createdAt,
                updatedAt,
            })
            this.putGrant(change.grant)
        } else if (change.type === 'deleteWorkspace') {
            this.metas.delete(change.workspaceId)
            this.workspaces.delete(change.workspaceId)
        } else if (change.type === 'deleteGrant')
            this.deleteGrant(change.userId, change.workspaceId)
        else if (change.type === 'putHeadingPointer')
            this.headingPointers.set(`${change.pointer.organizationId}#${change.pointer.headingId}`, { ...change.pointer })
        else
            this.headingPointers.delete(`${change.organizationId}#${change.headingId}`)
    }

    getLock = async (organizationId: string): Promise<WorkspaceTreeLock | undefined> => {
        const lock = this.locks.get(organizationId)

        return lock ? structuredClone(lock) : undefined
    }

    acquireLock = async (lock: WorkspaceTreeLock): Promise<boolean> => {
        if (this.locks.has(lock.organizationId))
            return false

        this.locks.set(
            lock.organizationId,
            structuredClone(lock),
        )

        return true
    }

    takeOverLock = async (
        expired: Pick<WorkspaceTreeLock, 'organizationId' | 'operationId' | 'expiresAt'>,
        next: Pick<WorkspaceTreeLock, 'operationId' | 'acquiredAt' | 'expiresAt'>,
    ): Promise<boolean> => {
        const lock = this.locks.get(expired.organizationId)

        if (
            lock?.operationId !== expired.operationId
            || lock.expiresAt !== expired.expiresAt
        )
            return false

        this.locks.set(
            expired.organizationId,
            {
                ...lock,
                ...next,
            },
        )

        return true
    }

    renewLock = async (
        organizationId: string,
        operationId: string,
        expiresAt: number,
    ): Promise<boolean> => {
        const lock = this.locks.get(organizationId)

        if (lock?.operationId !== operationId)
            return false

        lock.expiresAt = expiresAt

        return true
    }

    updateLock = async (
        organizationId: string,
        operationId: string,
        update: Pick<WorkspaceTreeLock, 'phase'> & Partial<Pick<WorkspaceTreeLock, 'parameters'>>,
    ): Promise<void> => {
        const lock = this.locks.get(organizationId)

        if (lock?.operationId !== operationId)
            throw new WorkspaceTreeConflict()

        lock.phase = update.phase

        if (update.parameters)
            lock.parameters = structuredClone(update.parameters)
    }

    releaseLock = async (
        organizationId: string,
        operationId: string,
    ): Promise<void> => {
        if (this.locks.get(organizationId)?.operationId === operationId)
            this.locks.delete(organizationId)
    }

    listLocks = async (): Promise<WorkspaceTreeLock[]> => [...this.locks.values()].map(lock => structuredClone(lock))
}
