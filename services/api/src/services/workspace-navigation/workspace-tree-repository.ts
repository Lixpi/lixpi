import {
    type AccessLevel,
    type WorkspaceHeadingLevel,
    type WorkspaceMeta,
    type WorkspaceNavigationDocument,
} from '@lixpi/constants'

import {
    type NavigationPersistenceSettings,
} from './workspace-navigation-limits.ts'

// One grant row of the access list. A grant row is the only record of a
// user's access to a workspace.
export type WorkspaceGrantRow = {
    userId: string
    workspaceId: string
    accessLevel: AccessLevel
    createdAt?: number
    updatedAt?: number
}

// One entry in a parent's ordered children. Workspace rows mirror the meta
// row's position. Heading rows are the only record of a heading.
export type WorkspaceTreeRow = {
    pk: string
    sk: string
    entryType: 'workspace' | 'heading'
    entryId: string
    organizationId: string
    parentWorkspaceId?: string
    position: string
    name?: string
    level?: WorkspaceHeadingLevel
    note?: string
    createdAt: number
    updatedAt: number
}

// Finds a heading's row from its id alone. Stored in the tree table beside
// the heading's own row and written in the same transactions.
export type WorkspaceHeadingPointer = {
    organizationId: string
    headingId: string
    parentWorkspaceId?: string
    position: string
}

// The consistent view of one ancestor chain: the meta rows of every
// workspace on it and the user's grant rows on those workspaces.
export type WorkspaceAccessChain = {
    metas: Map<string, WorkspaceMeta>
    grants: WorkspaceGrantRow[]
    // Whether the organization's tree lock was held at the moment of the
    // read. Set only when the read was fenced on an organization and the
    // whole chain fit one consistent read; otherwise undefined.
    locked?: boolean
}

// The state of one organization's navigation at a single consistent instant.
export type WorkspaceNavigationFence = {
    locked: boolean
    revisionId?: string
    head?: WorkspaceNavigationHead
}

// A change to the fields a workspace's full and meta rows share. `null`
// removes an optional field. `deletingAt` is only ever set once.
export type WorkspaceRowPatch = {
    name?: string
    note?: string | null
    tagIds?: string[]
    parentWorkspaceId?: string | null
    ancestorIds?: string[]
    position?: string | null
    deletingAt?: number
    updatedAt: number
}

export type WorkspaceNavigationHead = {
    revision: number
    revisionId: string
    schemaVersion: 1
}

export type WorkspaceNavigationMutation = WorkspaceNavigationHead & {
    userId: string
    requestHash: string
}

export type WorkspaceTreeChange =
    | {
        type: 'putNavigationRecord'
        key: string
        value: WorkspaceNavigationHead | WorkspaceNavigationMutation
        requireAbsent?: boolean
    }
    | {
        type: 'putTreeRow'
        row: WorkspaceTreeRow
        requireAbsent?: boolean
    }
    | {
        type: 'deleteTreeRow'
        key: Pick<WorkspaceTreeRow, 'pk' | 'sk'>
    }
    | {
        type: 'patchWorkspace'
        workspaceId: string
        patch: WorkspaceRowPatch
        // Conditions on the meta row. The commit fails as stale when they
        // no longer hold.
        expect?: {
            ancestorIds?: string[]
            notDeleting?: boolean
        }
    }
    // A condition on a workspace's meta row that writes nothing.
    | {
        type: 'checkWorkspace'
        workspaceId: string
        expect: {
            ancestorIds?: string[]
            notDeleting?: boolean
        }
    }
    | {
        type: 'createWorkspace'
        // The full item, which carries the meta fields and any content the
        // application stores with a workspace.
        workspace: WorkspaceMeta & Record<string, unknown>
        grant: WorkspaceGrantRow
    }
    | {
        type: 'deleteWorkspace'
        workspaceId: string
    }
    | {
        type: 'deleteGrant'
        userId: string
        workspaceId: string
    }
    | {
        type: 'putHeadingPointer'
        pointer: WorkspaceHeadingPointer
    }
    | {
        type: 'deleteHeadingPointer'
        organizationId: string
        headingId: string
    }

// How many storage items a change writes, so a caller can split a large
// change set into commits that fit one transaction.
export const workspaceTreeChangeItemCount = (change: WorkspaceTreeChange): number => {
    if (change.type === 'createWorkspace')
        return 3

    if (
        change.type === 'patchWorkspace'
        || change.type === 'deleteWorkspace'
    )
        return 2

    return 1
}

export type WorkspaceTreeLockOperation = 'move' | 'sectionMove' | 'delete' | 'rebalance' | 'saveNavigation' | 'mutation' | 'initializeNavigation'

// The single structure operation an organization may run at a time. The row
// records what the operation is doing, so whoever finds it expired can finish
// it. `parameters` holds the operation's recorded inputs as plain JSON.
export type WorkspaceTreeLock = {
    organizationId: string
    operationId: string
    operation: WorkspaceTreeLockOperation
    entryId: string
    userId: string
    phase: string
    parameters: Record<string, unknown>
    acquiredAt: number
    expiresAt: number
}

export type WorkspaceTreeCommit = {
    organizationId: string
    // The operation that holds the organization's lock. A commit without one
    // requires that no lock is held.
    lockOperationId?: string
    changes: WorkspaceTreeChange[]
}

// Storage the workspace tree needs. The DynamoDB implementation lives beside
// this port; another repository can supply its own.
export type WorkspaceTreeRepository = {
    // Returns the delay until another write may be admitted, or zero after
    // atomically reserving capacity shared by every API process.
    admitNavigationWrite: (
        userId: string,
        now: number,
        settings: Pick<NavigationPersistenceSettings, 'requestIntervalMs' | 'requestBurst'>,
    ) => Promise<number>
    // Records a no-op only while this head is current, no operation holds the
    // lock, and this mutation ID has never been acknowledged.
    recordUnchangedNavigation: (
        organizationId: string,
        mutationId: string,
        receipt: WorkspaceNavigationMutation,
    ) => Promise<boolean>
    getWorkspaceCreationIdentity: (workspaceId: string) => Promise<string | undefined>
    getNavigationRecord: (
        organizationId: string,
        key: string,
    ) => Promise<WorkspaceNavigationMutation | WorkspaceNavigationHead | undefined>
    getNavigationDocument: (
        organizationId: string,
        revisionId: string,
    ) => Promise<WorkspaceNavigationDocument>
    // Stages an immutable revision before it is referenced by a lock or head.
    // Staging never publishes it and never changes the domain projection.
    putNavigationDocument: (
        organizationId: string,
        revisionId: string,
        document: WorkspaceNavigationDocument,
    ) => Promise<void>
    getWorkspaceMeta: (workspaceId: string) => Promise<WorkspaceMeta | undefined>
    getWorkspaceMetas: (workspaceIds: string[]) => Promise<WorkspaceMeta[]>
    // Reads every listed meta row and the user's grants on them in one
    // consistent read. With an organization, its tree lock joins the same
    // read, so the chain doubles as a navigation fence.
    readAccessChain: (
        userId: string,
        workspaceIds: string[],
        organizationId?: string,
    ) => Promise<WorkspaceAccessChain>
    // Reads each organization's lock and navigation head in one consistent
    // read.
    readNavigationFences: (organizationIds: string[]) => Promise<Map<string, WorkspaceNavigationFence>>
    listUserGrants: (userId: string) => Promise<WorkspaceGrantRow[]>
    listWorkspaceGrants: (workspaceId: string) => Promise<WorkspaceGrantRow[]>
    listChildRows: (
        organizationId: string,
        parentWorkspaceId: string | undefined,
    ) => Promise<WorkspaceTreeRow[]>
    getHeadingPointer: (
        organizationId: string,
        headingId: string,
    ) => Promise<WorkspaceHeadingPointer | undefined>
    // Applies every change atomically. Throws WorkspaceTreeConflict when a
    // condition fails, including the lock guard.
    commit: (commit: WorkspaceTreeCommit) => Promise<void>
    getLock: (organizationId: string) => Promise<WorkspaceTreeLock | undefined>
    // Writes the lock only when the organization holds none.
    acquireLock: (lock: WorkspaceTreeLock) => Promise<boolean>
    // Replaces an expired lock with a new holder, only when it still matches
    // what the caller read.
    takeOverLock: (
        expired: Pick<WorkspaceTreeLock, 'organizationId' | 'operationId' | 'expiresAt'>,
        next: Pick<WorkspaceTreeLock, 'operationId' | 'acquiredAt' | 'expiresAt'>,
    ) => Promise<boolean>
    renewLock: (
        organizationId: string,
        operationId: string,
        expiresAt: number,
    ) => Promise<boolean>
    updateLock: (
        organizationId: string,
        operationId: string,
        update: Pick<WorkspaceTreeLock, 'phase'> & Partial<Pick<WorkspaceTreeLock, 'parameters'>>,
    ) => Promise<void>
    releaseLock: (
        organizationId: string,
        operationId: string,
    ) => Promise<void>
    listLocks: () => Promise<WorkspaceTreeLock[]>
}

// A commit whose conditions no longer held. The service decides whether that
// means another operation holds the lock or the caller's view was stale.
export class WorkspaceTreeConflict extends Error {
    constructor(readonly cause?: unknown) {
        super('WORKSPACE_TREE_CONFLICT')
        this.name = 'WorkspaceTreeConflict'
    }
}
