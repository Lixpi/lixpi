import {
    WORKSPACE_ACCESS_BY_WORKSPACE_INDEX,
    type WorkspaceAccessGrant,
    type WorkspaceMeta,
    type WorkspaceNavigationDocument,
} from '@lixpi/constants'

import {
    workspaceHeadingPointerPartitionKey,
    workspaceTreePartitionKey,
    WORKSPACE_HEADING_POINTER_SORT_KEY,
} from './table-keys.ts'
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

export type WorkspaceTreeTables = {
    workspaces: string
    workspacesMeta: string
    workspacesAccessList: string
    workspaceTree: string
    workspaceTreeLocks: string
}

// One operation of a DynamoDB transaction, in the shape
// @lixpi/dynamodb-service accepts.
export type TransactOperation =
    | {
        type: 'check'
        tableName: string
        key: Record<string, unknown>
        conditionExpression: string
        expressionAttributeNames?: Record<string, string>
        expressionAttributeValues?: Record<string, unknown>
    }
    | {
        type: 'put'
        tableName: string
        item: Record<string, unknown>
        conditionExpression?: string
        expressionAttributeNames?: Record<string, string>
        expressionAttributeValues?: Record<string, unknown>
    }
    | {
        type: 'update'
        tableName: string
        key: Record<string, unknown>
        updateExpression?: string
        expressionAttributeNames?: Record<string, string>
        expressionAttributeValues?: Record<string, unknown>
        conditionExpression?: string
    }
    | {
        type: 'delete'
        tableName: string
        key: Record<string, unknown>
        conditionExpression?: string
        expressionAttributeNames?: Record<string, string>
        expressionAttributeValues?: Record<string, unknown>
    }

type QueryResult = { items: unknown[] } | undefined

// The database calls the repository makes. @lixpi/dynamodb-service satisfies
// it; the package does not depend on that implementation, so browser
// workspaces that include this package never install the AWS SDK.
export type WorkspaceTreeDatabase = {
    getItem: (request: {
        tableName: string
        key: Record<string, unknown>
        consistentRead?: boolean
        origin?: string
    }) => Promise<unknown>
    queryItems: (request: {
        tableName: string
        indexName?: string
        keyConditions: Record<string, unknown>
        limit?: number
        fetchAllItems?: boolean
        consistentRead?: boolean
        origin?: string
    }) => Promise<QueryResult>
    scanItems: (request: {
        tableName: string
        limit?: number
        fetchAllItems?: boolean
        consistentRead?: boolean
        origin?: string
    }) => Promise<QueryResult>
    batchReadItems: (request: {
        queries: Array<{
            tableName: string
            keys: Record<string, unknown>[]
        }>
        readBatchSize?: number
        fetchAllItems?: boolean
        scanIndexForward?: boolean
        origin?: string
    }) => Promise<{ items: Record<string, unknown[]> } | Error>
    transactRead: (request: {
        items: Array<{
            tableName: string
            key: Record<string, unknown>
        }>
    }) => Promise<Array<Record<string, unknown> | undefined>>
    transactWrite: (request: {
        operations: TransactOperation[]
        logConditionalCheckFailures?: boolean
        origin?: string
    }) => Promise<unknown>
}

// A transaction cancelled by a failed condition surfaces either as a
// conditional check failure or as a cancelled transaction with that reason.
const isConditionalFailure = (error: unknown): boolean => {
    const candidate = error as {
        name?: string
        CancellationReasons?: Array<{ Code?: string }>
    }

    return candidate?.name === 'ConditionalCheckFailedException'
        || (candidate?.name === 'TransactionCanceledException'
            && (candidate.CancellationReasons ?? []).some(reason => reason?.Code === 'ConditionalCheckFailed'))
}

// DynamoDB allows 100 items in one transactional read.
const TRANSACT_READ_LIMIT = 100

type UpdateParts = {
    updateExpression: string
    expressionAttributeNames: Record<string, string>
    expressionAttributeValues: Record<string, unknown>
}

// Builds one SET/REMOVE expression from a patch. `null` removes a field, and
// `deletingAt` keeps the first deletion time.
const buildPatchExpression = (patch: WorkspaceRowPatch): UpdateParts => {
    const sets: string[] = []
    const removes: string[] = []
    const names: Record<string, string> = {}
    const values: Record<string, unknown> = {}

    for (const [field, value] of Object.entries(patch)) {
        if (value === undefined)
            continue

        names[`#${field}`] = field

        if (value === null) {
            removes.push(`#${field}`)

            continue
        }

        values[`:${field}`] = value
        sets.push(
            field === 'deletingAt'
                ? `#${field} = if_not_exists(#${field}, :${field})`
                : `#${field} = :${field}`,
        )
    }

    return {
        updateExpression: [
            sets.length ? `SET ${sets.join(', ')}` : '',
            removes.length ? `REMOVE ${removes.join(', ')}` : '',
        ].filter(Boolean).join(' '),
        expressionAttributeNames: names,
        expressionAttributeValues: values,
    }
}

const chunk = <Item>(
    items: Item[],
    size: number,
): Item[][] => {
    const chunks: Item[][] = []

    for (let index = 0; index < items.length; index += size)
        chunks.push(
            items.slice(index, index + size),
        )

    return chunks
}

export class DynamoDbWorkspaceTreeRepository implements WorkspaceTreeRepository {
    constructor(
        private readonly database: WorkspaceTreeDatabase,
        readonly tables: WorkspaceTreeTables,
    ) {}

    admitNavigationWrite = async (
        userId: string,
        now: number,
        settings: Pick<NavigationPersistenceSettings, 'requestIntervalMs' | 'requestBurst'>,
    ): Promise<number> => {
        const key = {
            pk: `USER#${userId}#NAVIGATION`,
            sk: 'WRITE_ADMISSION',
        }

        for (let attempt = 0; attempt < 3; attempt += 1) {
            const current = (await this.database.getItem({
                tableName: this.tables.workspaceTree,
                key,
                consistentRead: true,
                origin: 'WorkspaceTree.navigationAdmission',
            })) as { nextAt: number } | undefined

            if (
                current
                && !Number.isSafeInteger(current.nextAt)
            )
                throw new Error('WORKSPACE_NAVIGATION_ADMISSION_INVALID')

            const admission = nextNavigationAdmission(
                current?.nextAt,
                now,
                settings,
            )

            if (admission.retryAfterMs)
                return admission.retryAfterMs

            if (await this.conditionalLockWrite(
                {
                    type: 'put',
                    tableName: this.tables.workspaceTree,
                    item: {
                        ...key,
                        nextAt: admission.nextAt,
                    },
                    conditionExpression: current ? '#nextAt = :previous' : 'attribute_not_exists(#pk)',
                    expressionAttributeNames: current ? { '#nextAt': 'nextAt' } : { '#pk': 'pk' },
                    ...(current ? { expressionAttributeValues: { ':previous': current.nextAt } } : {}),
                },
                'WorkspaceTree.navigationAdmission',
            ))
                return 0
        }

        return settings.requestIntervalMs
    }

    recordUnchangedNavigation = async (
        organizationId: string,
        mutationId: string,
        receipt: WorkspaceNavigationMutation,
    ): Promise<boolean> => {
        try {
            await this.database.transactWrite({
                operations: [
                    {
                        type: 'check',
                        tableName: this.tables.workspaceTreeLocks,
                        key: { organizationId },
                        conditionExpression: 'attribute_not_exists(#organizationId)',
                        expressionAttributeNames: { '#organizationId': 'organizationId' },
                    },
                    {
                        type: 'check',
                        tableName: this.tables.workspaceTree,
                        key: {
                            pk: `ORG#${organizationId}#NAVIGATION`,
                            sk: 'HEAD',
                        },
                        conditionExpression: '#revision = :revision AND #revisionId = :revisionId',
                        expressionAttributeNames: {
                            '#revision': 'revision',
                            '#revisionId': 'revisionId',
                        },
                        expressionAttributeValues: {
                            ':revision': receipt.revision,
                            ':revisionId': receipt.revisionId,
                        },
                    },
                    {
                        type: 'put',
                        tableName: this.tables.workspaceTree,
                        item: {
                            pk: `ORG#${organizationId}#NAVIGATION`,
                            sk: `MUTATION#${mutationId}`,
                            ...receipt,
                        },
                        conditionExpression: 'attribute_not_exists(#pk)',
                        expressionAttributeNames: { '#pk': 'pk' },
                    },
                ],
                logConditionalCheckFailures: false,
                origin: 'WorkspaceTree.recordUnchangedNavigation',
            })

            return true
        } catch (error) {
            if (isConditionalFailure(error))
                return false

            throw error
        }
    }

    getNavigationRecord = async (
        organizationId: string,
        key: string,
    ): Promise<WorkspaceNavigationHead | WorkspaceNavigationMutation | undefined> =>
        (await this.database.getItem({
            tableName: this.tables.workspaceTree,
            key: {
                pk: `ORG#${organizationId}#NAVIGATION`,
                sk: key,
            },
            consistentRead: true,
            origin: 'WorkspaceTree.getNavigationRecord',
        })) as WorkspaceNavigationHead | WorkspaceNavigationMutation | undefined

    getNavigationDocument = async (
        organizationId: string,
        revisionId: string,
    ): Promise<WorkspaceNavigationDocument> => {
        const result = await this.database.queryItems({
            tableName: this.tables.workspaceTree,
            keyConditions: { pk: `ORG#${organizationId}#NAVIGATION#REVISION#${revisionId}` },
            consistentRead: true,
            fetchAllItems: true,
            origin: 'WorkspaceTree.getNavigationDocument',
        })
        const chunks = (result?.items ?? []) as Array<{
            sk: string
            text: string
            count: number
        }>
        chunks.sort((left, right) => left.sk.localeCompare(right.sk))

        if (
            !chunks.length
            || chunks.length !== chunks[0].count
            || chunks.some((part, index) => part.sk !== String(index).padStart(8, '0') || part.count !== chunks.length)
        )
            throw new Error('WORKSPACE_NAVIGATION_REVISION_MISSING')

        return JSON.parse(
            chunks.map(part => part.text).join(''),
        ) as WorkspaceNavigationDocument
    }

    putNavigationDocument = async (
        organizationId: string,
        revisionId: string,
        document: WorkspaceNavigationDocument,
    ): Promise<void> => {
        const serialized = JSON.stringify(document)
        const parts: string[] = []

        // At most 128 KiB of UTF-8 per item, including astral characters.
        for (let offset = 0; offset < serialized.length; offset += 32_000)
            parts.push(
                serialized.slice(offset, offset + 32_000),
            )

        const operations: TransactOperation[] = parts.map(
            (text, index) => ({
                type: 'put',
                tableName: this.tables.workspaceTree,
                item: {
                    pk: `ORG#${organizationId}#NAVIGATION#REVISION#${revisionId}`,
                    sk: String(index).padStart(8, '0'),
                    count: parts.length,
                    text,
                },
                conditionExpression: 'attribute_not_exists(#pk)',
                expressionAttributeNames: { '#pk': 'pk' },
            }),
        )

        for (const batch of chunk(operations, 16))
            await this.database.transactWrite({
                operations: batch,
                origin: 'WorkspaceTree.putNavigationDocument',
            })
    }

    getWorkspaceCreationIdentity = async (workspaceId: string): Promise<string | undefined> => {
        const row = (await this.database.getItem({
            tableName: this.tables.workspaces,
            key: { workspaceId },
            consistentRead: true,
            origin: 'WorkspaceTree.getWorkspaceCreationIdentity',
        })) as { navigationCreationIdentity?: string } | undefined

        return row?.navigationCreationIdentity
    }

    getWorkspaceMeta = async (workspaceId: string): Promise<WorkspaceMeta | undefined> =>
        (await this.database.getItem({
            tableName: this.tables.workspacesMeta,
            key: { workspaceId },
            consistentRead: true,
            origin: 'WorkspaceTree.getWorkspaceMeta',
        })) as WorkspaceMeta | undefined

    getWorkspaceMetas = async (workspaceIds: string[]): Promise<WorkspaceMeta[]> => {
        const batches = await Promise.all(
            chunk([...new Set(workspaceIds)], TRANSACT_READ_LIMIT).map(
                async workspaceBatch => await this.database.transactRead({
                    items: workspaceBatch.map(
                        workspaceId => ({
                            tableName: this.tables.workspacesMeta,
                            key: { workspaceId },
                        }),
                    ),
                }),
            ),
        )

        return batches.flat().filter((row): row is WorkspaceMeta & Record<string, unknown> => Boolean(row)) as WorkspaceMeta[]
    }

    readAccessChain = async (
        userId: string,
        workspaceIds: string[],
        organizationId?: string,
    ): Promise<WorkspaceAccessChain> => {
        const lockRead = {
            tableName: this.tables.workspaceTreeLocks,
            key: { organizationId },
        }
        const chainReads = workspaceIds.flatMap(
            workspaceId => [
                {
                    tableName: this.tables.workspacesMeta,
                    key: { workspaceId },
                },
                {
                    tableName: this.tables.workspacesAccessList,
                    key: {
                        userId,
                        workspaceId,
                    },
                },
            ],
        )
        // The lock joins the chain only when everything fits one consistent
        // read. A longer chain spans several reads and is fenced by the caller.
        const fenced = organizationId !== undefined
            && chainReads.length < TRANSACT_READ_LIMIT
        const reads = fenced ? [lockRead, ...chainReads] : chainReads
        const metas = new Map<string, WorkspaceMeta>()
        const grants: WorkspaceGrantRow[] = []
        let locked: boolean | undefined
        const batches = await Promise.all(
            chunk(reads, TRANSACT_READ_LIMIT).map(
                async items => ({
                    items,
                    results: await this.database.transactRead({ items }),
                }),
            ),
        )

        for (const {
            items,
            results,
        } of batches)
            results.forEach((item, index) => {
                const { tableName } = items[index]

                if (tableName === this.tables.workspaceTreeLocks) {
                    locked = Boolean(item)

                    return
                }

                if (!item)
                    return

                if (tableName === this.tables.workspacesMeta)
                    metas.set((item as WorkspaceMeta).workspaceId, item as WorkspaceMeta)
                else
                    grants.push(item as WorkspaceGrantRow)
            })

        return {
            metas,
            grants,
            ...(locked === undefined ? {} : { locked }),
        }
    }

    readNavigationFences = async (organizationIds: string[]): Promise<Map<string, WorkspaceNavigationFence>> => {
        const fences = new Map<string, WorkspaceNavigationFence>()
        const ids = [...new Set(organizationIds)]
        // Each organization's lock and head stay in the same read, so a
        // fence is never split across two instants.
        const perRead = Math.floor(TRANSACT_READ_LIMIT / 2)
        const batches = await Promise.all(
            chunk(ids, perRead).map(
                async batch => ({
                    batch,
                    results: await this.database.transactRead({
                        items: batch.flatMap(
                            organizationId => [
                                {
                                    tableName: this.tables.workspaceTreeLocks,
                                    key: { organizationId },
                                },
                                {
                                    tableName: this.tables.workspaceTree,
                                    key: {
                                        pk: `ORG#${organizationId}#NAVIGATION`,
                                        sk: 'HEAD',
                                    },
                                },
                            ],
                        ),
                    }),
                }),
            ),
        )

        for (const {
            batch,
            results,
        } of batches)
            batch.forEach((organizationId, index) => {
                const head = results[index * 2 + 1] as WorkspaceNavigationHead | undefined
                fences.set(
                    organizationId,
                    {
                        locked: Boolean(results[index * 2]),
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
                    },
                )
            })

        return fences
    }

    listUserGrants = async (userId: string): Promise<WorkspaceGrantRow[]> => {
        const result = await this.database.queryItems({
            tableName: this.tables.workspacesAccessList,
            keyConditions: { userId },
            limit: 1000,
            fetchAllItems: true,
            consistentRead: true,
            origin: 'WorkspaceTree.listUserGrants',
        })

        return (result?.items ?? []) as WorkspaceGrantRow[]
    }

    listWorkspaceGrants = async (workspaceId: string): Promise<WorkspaceGrantRow[]> => {
        const result = await this.database.queryItems({
            tableName: this.tables.workspacesAccessList,
            indexName: WORKSPACE_ACCESS_BY_WORKSPACE_INDEX.name,
            keyConditions: { workspaceId },
            limit: 1000,
            fetchAllItems: true,
            origin: 'WorkspaceTree.listWorkspaceGrants',
        })

        return (result?.items ?? []) as WorkspaceGrantRow[]
    }

    listChildRows = async (
        organizationId: string,
        parentWorkspaceId: string | undefined,
    ): Promise<WorkspaceTreeRow[]> => {
        const result = await this.database.queryItems({
            tableName: this.tables.workspaceTree,
            keyConditions: { pk: workspaceTreePartitionKey(organizationId, parentWorkspaceId) },
            limit: 1000,
            fetchAllItems: true,
            consistentRead: true,
            origin: 'WorkspaceTree.listChildRows',
        })

        return (result?.items ?? []) as WorkspaceTreeRow[]
    }

    getHeadingPointer = async (
        organizationId: string,
        headingId: string,
    ): Promise<WorkspaceHeadingPointer | undefined> => {
        const row = (await this.database.getItem({
            tableName: this.tables.workspaceTree,
            key: {
                pk: workspaceHeadingPointerPartitionKey(organizationId, headingId),
                sk: WORKSPACE_HEADING_POINTER_SORT_KEY,
            },
            consistentRead: true,
            origin: 'WorkspaceTree.getHeadingPointer',
        })) as (WorkspaceHeadingPointer & Record<string, unknown>) | undefined

        return row
            ? {
                organizationId: row.organizationId,
                headingId: row.headingId,
                ...(row.parentWorkspaceId ? { parentWorkspaceId: row.parentWorkspaceId } : {}),
                position: row.position,
            }
            : undefined
    }

    commit = async ({
        organizationId,
        lockOperationId,
        changes,
    }: WorkspaceTreeCommit): Promise<void> => {
        const guard: TransactOperation = lockOperationId
            ? {
                type: 'check',
                tableName: this.tables.workspaceTreeLocks,
                key: { organizationId },
                conditionExpression: '#operationId = :operationId',
                expressionAttributeNames: { '#operationId': 'operationId' },
                expressionAttributeValues: { ':operationId': lockOperationId },
            }
            : {
                type: 'check',
                tableName: this.tables.workspaceTreeLocks,
                key: { organizationId },
                conditionExpression: 'attribute_not_exists(#organizationId)',
                expressionAttributeNames: { '#organizationId': 'organizationId' },
            }

        try {
            await this.database.transactWrite({
                operations: [guard, ...changes.flatMap(change => this.operationsFor(change, organizationId))],
                logConditionalCheckFailures: false,
                origin: 'WorkspaceTree.commit',
            })
        } catch (error) {
            if (isConditionalFailure(error))
                throw new WorkspaceTreeConflict(error)

            throw error
        }
    }

    private operationsFor(
        change: WorkspaceTreeChange,
        organizationId: string,
    ): TransactOperation[] {
        if (change.type === 'putNavigationRecord')
            return [{
                type: 'put',
                tableName: this.tables.workspaceTree,
                item: {
                    pk: `ORG#${organizationId}#NAVIGATION`,
                    sk: change.key,
                    ...change.value,
                },
                ...(change.requireAbsent ? {
                    conditionExpression: 'attribute_not_exists(#pk)',
                    expressionAttributeNames: { '#pk': 'pk' },
                } : {}),
            }]

        if (change.type === 'putTreeRow')
            return [{
                type: 'put',
                tableName: this.tables.workspaceTree,
                item: change.row,
                ...(change.requireAbsent
                    ? {
                        conditionExpression: 'attribute_not_exists(#pk)',
                        expressionAttributeNames: { '#pk': 'pk' },
                    }
                    : {}),
            }]

        if (change.type === 'deleteTreeRow')
            return [{
                type: 'delete',
                tableName: this.tables.workspaceTree,
                // Callers often pass a whole tree row; the key is only pk and
                // sk, and DynamoDB refuses any other attribute in it.
                key: {
                    pk: change.key.pk,
                    sk: change.key.sk,
                },
            }]

        if (change.type === 'patchWorkspace') {
            const parts = buildPatchExpression(change.patch)
            const metaConditions = ['attribute_exists(#workspaceId)']
            const metaNames: Record<string, string> = { '#workspaceId': 'workspaceId' }
            const metaValues: Record<string, unknown> = {}

            if (change.expect?.notDeleting) {
                metaConditions.push('attribute_not_exists(#expectDeletingAt)')
                metaNames['#expectDeletingAt'] = 'deletingAt'
            }

            if (change.expect?.ancestorIds) {
                metaConditions.push('#expectAncestorIds = :expectAncestorIds')
                metaNames['#expectAncestorIds'] = 'ancestorIds'
                metaValues[':expectAncestorIds'] = change.expect.ancestorIds
            }

            return [
                {
                    type: 'update',
                    tableName: this.tables.workspaces,
                    key: { workspaceId: change.workspaceId },
                    updateExpression: parts.updateExpression,
                    conditionExpression: 'attribute_exists(#workspaceId)',
                    expressionAttributeNames: {
                        ...parts.expressionAttributeNames,
                        '#workspaceId': 'workspaceId',
                    },
                    ...(Object.keys(parts.expressionAttributeValues).length ? { expressionAttributeValues: parts.expressionAttributeValues } : {}),
                },
                {
                    type: 'update',
                    tableName: this.tables.workspacesMeta,
                    key: { workspaceId: change.workspaceId },
                    updateExpression: parts.updateExpression,
                    conditionExpression: metaConditions.join(' AND '),
                    expressionAttributeNames: {
                        ...parts.expressionAttributeNames,
                        ...metaNames,
                    },
                    ...(Object.keys({
                        ...parts.expressionAttributeValues,
                        ...metaValues,
                    }).length
                        ? {
                            expressionAttributeValues: {
                                ...parts.expressionAttributeValues,
                                ...metaValues,
                            },
                        }
                        : {}),
                },
            ]
        }

        if (change.type === 'checkWorkspace') {
            const conditions = ['attribute_exists(#workspaceId)']
            const names: Record<string, string> = { '#workspaceId': 'workspaceId' }
            const values: Record<string, unknown> = {}

            if (change.expect.notDeleting) {
                conditions.push('attribute_not_exists(#deletingAt)')
                names['#deletingAt'] = 'deletingAt'
            }

            if (change.expect.ancestorIds) {
                conditions.push('#ancestorIds = :ancestorIds')
                names['#ancestorIds'] = 'ancestorIds'
                values[':ancestorIds'] = change.expect.ancestorIds
            }

            return [{
                type: 'check',
                tableName: this.tables.workspacesMeta,
                key: { workspaceId: change.workspaceId },
                conditionExpression: conditions.join(' AND '),
                expressionAttributeNames: names,
                ...(Object.keys(values).length ? { expressionAttributeValues: values } : {}),
            }]
        }

        if (change.type === 'createWorkspace') {
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

            return [
                {
                    type: 'put',
                    tableName: this.tables.workspaces,
                    item: change.workspace,
                    conditionExpression: 'attribute_not_exists(#workspaceId)',
                    expressionAttributeNames: { '#workspaceId': 'workspaceId' },
                },
                {
                    type: 'put',
                    tableName: this.tables.workspacesMeta,
                    item: {
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
                    },
                },
                {
                    type: 'put',
                    tableName: this.tables.workspacesAccessList,
                    item: change.grant,
                },
            ]
        }

        if (change.type === 'deleteWorkspace')
            return [
                {
                    type: 'delete',
                    tableName: this.tables.workspaces,
                    key: { workspaceId: change.workspaceId },
                },
                {
                    type: 'delete',
                    tableName: this.tables.workspacesMeta,
                    key: { workspaceId: change.workspaceId },
                },
            ]

        if (change.type === 'deleteGrant')
            return [{
                type: 'delete',
                tableName: this.tables.workspacesAccessList,
                key: {
                    userId: change.userId,
                    workspaceId: change.workspaceId,
                },
            }]

        if (change.type === 'putHeadingPointer')
            return [{
                type: 'put',
                tableName: this.tables.workspaceTree,
                item: {
                    pk: workspaceHeadingPointerPartitionKey(change.pointer.organizationId, change.pointer.headingId),
                    sk: WORKSPACE_HEADING_POINTER_SORT_KEY,
                    ...change.pointer,
                },
            }]

        return [{
            type: 'delete',
            tableName: this.tables.workspaceTree,
            key: {
                pk: workspaceHeadingPointerPartitionKey(change.organizationId, change.headingId),
                sk: WORKSPACE_HEADING_POINTER_SORT_KEY,
            },
        }]
    }

    getLock = async (organizationId: string): Promise<WorkspaceTreeLock | undefined> =>
        (await this.database.getItem({
            tableName: this.tables.workspaceTreeLocks,
            key: { organizationId },
            consistentRead: true,
            origin: 'WorkspaceTree.getLock',
        })) as WorkspaceTreeLock | undefined

    // Lock writes are single-operation transactions, so they run under the
    // same account fencing as every other user-scoped write.
    private async conditionalLockWrite(
        operation: TransactOperation,
        origin: string,
    ): Promise<boolean> {
        try {
            await this.database.transactWrite({
                operations: [operation],
                logConditionalCheckFailures: false,
                origin,
            })

            return true
        } catch (error) {
            if (isConditionalFailure(error))
                return false

            throw error
        }
    }

    acquireLock = async (lock: WorkspaceTreeLock): Promise<boolean> =>
        await this.conditionalLockWrite(
            {
                type: 'put',
                tableName: this.tables.workspaceTreeLocks,
                item: lock,
                conditionExpression: 'attribute_not_exists(#organizationId)',
                expressionAttributeNames: { '#organizationId': 'organizationId' },
            },
            'WorkspaceTree.acquireLock',
        )

    takeOverLock = async (
        expired: Pick<WorkspaceTreeLock, 'organizationId' | 'operationId' | 'expiresAt'>,
        next: Pick<WorkspaceTreeLock, 'operationId' | 'acquiredAt' | 'expiresAt'>,
    ): Promise<boolean> =>
        await this.conditionalLockWrite(
            {
                type: 'update',
                tableName: this.tables.workspaceTreeLocks,
                key: { organizationId: expired.organizationId },
                updateExpression: 'SET #operationId = :nextOperationId, #acquiredAt = :acquiredAt, #expiresAt = :nextExpiresAt',
                conditionExpression: '#operationId = :operationId AND #expiresAt = :expiresAt',
                expressionAttributeNames: {
                    '#operationId': 'operationId',
                    '#acquiredAt': 'acquiredAt',
                    '#expiresAt': 'expiresAt',
                },
                expressionAttributeValues: {
                    ':operationId': expired.operationId,
                    ':expiresAt': expired.expiresAt,
                    ':nextOperationId': next.operationId,
                    ':acquiredAt': next.acquiredAt,
                    ':nextExpiresAt': next.expiresAt,
                },
            },
            'WorkspaceTree.takeOverLock',
        )

    renewLock = async (
        organizationId: string,
        operationId: string,
        expiresAt: number,
    ): Promise<boolean> =>
        await this.conditionalLockWrite(
            {
                type: 'update',
                tableName: this.tables.workspaceTreeLocks,
                key: { organizationId },
                updateExpression: 'SET #expiresAt = :expiresAt',
                conditionExpression: '#operationId = :operationId',
                expressionAttributeNames: {
                    '#operationId': 'operationId',
                    '#expiresAt': 'expiresAt',
                },
                expressionAttributeValues: {
                    ':operationId': operationId,
                    ':expiresAt': expiresAt,
                },
            },
            'WorkspaceTree.renewLock',
        )

    updateLock = async (
        organizationId: string,
        operationId: string,
        update: Pick<WorkspaceTreeLock, 'phase'> & Partial<Pick<WorkspaceTreeLock, 'parameters'>>,
    ): Promise<void> => {
        const updated = await this.conditionalLockWrite(
            {
                type: 'update',
                tableName: this.tables.workspaceTreeLocks,
                key: { organizationId },
                updateExpression: update.parameters ? 'SET #phase = :phase, #parameters = :parameters' : 'SET #phase = :phase',
                conditionExpression: '#operationId = :operationId',
                expressionAttributeNames: {
                    '#operationId': 'operationId',
                    '#phase': 'phase',
                    ...(update.parameters ? { '#parameters': 'parameters' } : {}),
                },
                expressionAttributeValues: {
                    ':operationId': operationId,
                    ':phase': update.phase,
                    ...(update.parameters ? { ':parameters': update.parameters } : {}),
                },
            },
            'WorkspaceTree.updateLock',
        )

        if (!updated)
            throw new WorkspaceTreeConflict()
    }

    releaseLock = async (
        organizationId: string,
        operationId: string,
    ): Promise<void> => {
        await this.conditionalLockWrite(
            {
                type: 'delete',
                tableName: this.tables.workspaceTreeLocks,
                key: { organizationId },
                conditionExpression: '#operationId = :operationId',
                expressionAttributeNames: { '#operationId': 'operationId' },
                expressionAttributeValues: { ':operationId': operationId },
            },
            'WorkspaceTree.releaseLock',
        )
    }

    listLocks = async (): Promise<WorkspaceTreeLock[]> => {
        const result = await this.database.scanItems({
            tableName: this.tables.workspaceTreeLocks,
            limit: 1000,
            fetchAllItems: true,
            consistentRead: true,
            origin: 'WorkspaceTree.listLocks',
        })

        return (result?.items ?? []) as WorkspaceTreeLock[]
    }

    // Condition checks that keep an access decision valid until a write
    // commits. The first fails when the grant the decision used is revoked or
    // changes level; the second fails when the workspace moves, changes
    // organization or starts being deleted. A delete marks every descendant,
    // so deleting an ancestor also fails the second check.
    accessFenceOperations = ({
        userId,
        workspaceId,
        organizationId,
        grant,
    }: {
        userId: string
        workspaceId: string
        organizationId: string
        grant: WorkspaceAccessGrant
    }): TransactOperation[] => [
        {
            type: 'check',
            tableName: this.tables.workspacesAccessList,
            key: {
                userId,
                workspaceId: grant.grantWorkspaceId,
            },
            conditionExpression: '#accessLevel = :accessLevel',
            expressionAttributeNames: { '#accessLevel': 'accessLevel' },
            expressionAttributeValues: { ':accessLevel': grant.accessLevel },
        },
        {
            type: 'check',
            tableName: this.tables.workspacesMeta,
            key: { workspaceId },
            conditionExpression: '#organizationId = :organizationId AND #ancestorIds = :ancestorIds AND attribute_not_exists(#deletingAt)',
            expressionAttributeNames: {
                '#organizationId': 'organizationId',
                '#ancestorIds': 'ancestorIds',
                '#deletingAt': 'deletingAt',
            },
            expressionAttributeValues: {
                ':organizationId': organizationId,
                ':ancestorIds': grant.ancestorIds,
            },
        },
    ]
}
