'use strict'

import * as process from 'process'
import { v4 as uuid } from 'uuid'

import {
    getDynamoDbTableStageName,
    type Workspace,
    type WorkspaceMeta,
    type WorkspaceAccessList,
    type CanvasNode,
    type CanvasState
} from '@lixpi/constants'
import { err } from '@lixpi/debug-tools'
import { isTransactionConditionalCheckFailure } from '@lixpi/dynamodb-service'

const {
    ORG_NAME,
    STAGE
} = process.env

type CanvasStateMutationResult = {
    canvasState: CanvasState
    changed: boolean
}

type CanvasStateMutator = (canvasState: CanvasState) => CanvasStateMutationResult

type UpdateCanvasStateResult =
    | { success: true; workspaceId: string; updatedAt: number; canvasStateUpdatedAt: number }
    | {
        success: false
        workspaceId: string
        error: 'STALE_CANVAS_STATE'
        currentUpdatedAt?: number
        currentCanvasStateUpdatedAt?: number
    }

type WorkspaceWithCanvasToken = Partial<Workspace> & {
    canvasStateUpdatedAt?: number
}

const getCanvasStateUpdatedAt = (workspace: WorkspaceWithCanvasToken | null | undefined): number | undefined => {
    if (typeof workspace?.canvasStateUpdatedAt === 'number') return workspace.canvasStateUpdatedAt
    if (typeof workspace?.updatedAt === 'number') return workspace.updatedAt
    return undefined
}

const getNextCanvasStateUpdatedAt = (workspace: WorkspaceWithCanvasToken | null | undefined): number => {
    const persistedRevision = getCanvasStateUpdatedAt(workspace)
    return Math.max(Date.now(), persistedRevision === undefined ? 0 : persistedRevision + 1)
}

const getCanvasStateWriteCondition = (hasExpectedCanvasStateUpdatedAt: boolean): string => {
    if (!hasExpectedCanvasStateUpdatedAt) {
        return '(attribute_not_exists(#canvasStateUpdatedAt) AND attribute_not_exists(#updatedAt)) AND attribute_not_exists(#deletingAt)'
    }

    return '(#canvasStateUpdatedAt = :expectedCanvasStateUpdatedAt OR (attribute_not_exists(#canvasStateUpdatedAt) AND #updatedAt = :expectedCanvasStateUpdatedAt)) AND attribute_not_exists(#deletingAt)'
}

const normalizeCanvasState = (canvasState: CanvasState | undefined): CanvasState => {
    const normalizedCanvasState = canvasState ?? ({} as Partial<CanvasState>)

    return {
        ...normalizedCanvasState,
        viewport: normalizedCanvasState.viewport ?? { x: 0, y: 0, zoom: 1 },
        nodes: normalizedCanvasState.nodes ?? [],
        edges: normalizedCanvasState.edges ?? []
    } as CanvasState
}

type MediaGenerationOperationCanvasNode = Extract<CanvasNode, { type: 'operationStatus' }>
type BranchMarkerCanvasNode = Extract<CanvasNode, { type: 'branchOrigin' | 'branchFork' | 'branchLine' }>
type GeneratedMediaCanvasNode = Extract<CanvasNode, { type: 'image' | 'video' }>

const isMediaGenerationOperationNode = (node: CanvasNode): node is MediaGenerationOperationCanvasNode =>
    node.type === 'operationStatus' && node.operation === 'media-generation'

const isBranchMarkerNode = (node: CanvasNode): node is BranchMarkerCanvasNode =>
    node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'

const isServerManagedGeneratedMediaNode = (node: CanvasNode): node is GeneratedMediaCanvasNode =>
    (node.type === 'image' || node.type === 'video') && Boolean(node.generationProgress)

const stripLegacyBranchMarkerProgress = (node: BranchMarkerCanvasNode): BranchMarkerCanvasNode => {
    const { mediaGeneration: _mediaGeneration, ...cleanNode } = node as BranchMarkerCanvasNode & {
        mediaGeneration?: unknown
    }
    return cleanNode as BranchMarkerCanvasNode
}

const preserveServerManagedMediaGenerationState = (
    currentCanvasState: CanvasState,
    incomingCanvasState: CanvasState,
): CanvasState => {
    const currentNodeById = new Map(currentCanvasState.nodes.map(node => [node.nodeId, node]))
    const currentOperationNodes = currentCanvasState.nodes.filter(isMediaGenerationOperationNode)
    const currentGeneratedMediaNodes = currentCanvasState.nodes.filter(isServerManagedGeneratedMediaNode)
    const currentOperationNodeIds = new Set(currentOperationNodes.map(node => node.nodeId))
    const allOperationNodeIds = new Set([
        ...currentOperationNodeIds,
        ...incomingCanvasState.nodes.filter(isMediaGenerationOperationNode).map(node => node.nodeId),
    ])
    const retainedOperationNodeIds = new Set<string>()
    const retainedGeneratedMediaNodeIds = new Set<string>()
    const nodes = incomingCanvasState.nodes.flatMap((node): CanvasNode[] => {
        if (isMediaGenerationOperationNode(node)) {
            const currentNode = currentNodeById.get(node.nodeId)
            if (!currentNode || !isMediaGenerationOperationNode(currentNode)) return []
            retainedOperationNodeIds.add(node.nodeId)
            return [currentNode]
        }
        if (node.type === 'image' || node.type === 'video') {
            const currentNode = currentNodeById.get(node.nodeId)
            if (!currentNode || !isServerManagedGeneratedMediaNode(currentNode)) return [node]
            retainedGeneratedMediaNodeIds.add(node.nodeId)
            const {
                assetId: _incomingAssetId,
                generatedBy: _incomingGeneratedBy,
                generationProgress: _incomingGenerationProgress,
                mediaGenerationPhase: _incomingMediaGenerationPhase,
                type: _incomingType,
                ...incomingNode
            } = node
            return [{
                ...incomingNode,
                type: currentNode.type,
                assetId: currentNode.assetId,
                ...(currentNode.mediaGenerationPhase ? {
                    mediaGenerationPhase: currentNode.mediaGenerationPhase,
                } : {}),
                ...(currentNode.generatedBy ? { generatedBy: currentNode.generatedBy } : {}),
                generationProgress: currentNode.generationProgress,
            } as CanvasNode]
        }
        if (!isBranchMarkerNode(node)) return [node]
        const currentNode = currentNodeById.get(node.nodeId)
        return [stripLegacyBranchMarkerProgress(
            currentNode && isBranchMarkerNode(currentNode) ? { ...currentNode, ...node } : node,
        )]
    })
    for (const operationNode of currentOperationNodes) {
        if (retainedOperationNodeIds.has(operationNode.nodeId)) continue
        nodes.push(operationNode)
    }
    for (const mediaNode of currentGeneratedMediaNodes) {
        if (retainedGeneratedMediaNodeIds.has(mediaNode.nodeId)) continue
        nodes.push(mediaNode)
    }
    const incomingEdges = incomingCanvasState.edges.filter(edge => (
        !allOperationNodeIds.has(edge.sourceNodeId)
        && !allOperationNodeIds.has(edge.targetNodeId)
    ))
    const serverEdges = currentCanvasState.edges.filter(edge => (
        currentOperationNodeIds.has(edge.sourceNodeId)
        || currentOperationNodeIds.has(edge.targetNodeId)
    ))
    const edgeIds = new Set<string>()
    const edges = [...incomingEdges, ...serverEdges].filter(edge => {
        if (edgeIds.has(edge.edgeId)) return false
        edgeIds.add(edge.edgeId)
        return true
    })

    return { ...incomingCanvasState, nodes, edges }
}

const getAssetMembershipEntries = (
    canvasState: CanvasState,
    ignoreUnboundGeneratedMediaReservations = false,
): string[] => {
    return canvasState.nodes
        .flatMap((node) => {
            if (ignoreUnboundGeneratedMediaReservations
                && (node.type === 'image' || node.type === 'video')
                && node.mediaGenerationPhase === 'pending-before-first-frame'
                && node.generationProgress
                && !node.generatedBy) return []
            const assetId = (node as CanvasNode & { assetId?: string }).assetId
            return assetId ? [`${assetId}#${node.nodeId}`] : []
        })
        .sort()
}

const getAssetMembershipSignature = (
    canvasState: CanvasState,
    ignoreUnboundGeneratedMediaReservations = false,
): string => JSON.stringify(getAssetMembershipEntries(canvasState, ignoreUnboundGeneratedMediaReservations))

const LEGACY_CANVAS_STORAGE_FIELDS = new Set([
    'fileId',
    'posterFileId',
    'frameFileId',
    'src',
    'posterSrc',
    'referenceId',
    'aiChatThreadId',
])

const assertRevision2CanvasStorage = (canvasState: CanvasState): void => {
    for (const node of canvasState.nodes as Array<Record<string, unknown>>) {
        if (node.type === 'uploadPlaceholder') throw new Error('LEGACY_UPLOAD_PLACEHOLDER_REJECTED')
        for (const field of LEGACY_CANVAS_STORAGE_FIELDS) {
            if (field in node) throw new Error(`LEGACY_CANVAS_STORAGE_FIELD_REJECTED:${field}`)
        }
        if (['image', 'video', 'audio', 'mediaDocument', 'document', 'capabilityArtifact'].includes(String(node.type)) && !node.assetId) {
            throw new Error('CANVAS_ASSET_ID_REQUIRED')
        }
        if (node.type === 'operationStatus'
            && (!['upload', 'media-generation'].includes(String(node.operation))
                || !['in-progress', 'action-required', 'failed'].includes(String(node.status))
                || typeof node.title !== 'string'
                || typeof node.message !== 'string')) {
            throw new Error('INVALID_OPERATION_STATUS_NODE')
        }
    }
}

export default {
    getWorkspace: async ({
        workspaceId,
        userId
    }: { workspaceId: string; userId: string }): Promise<Workspace | { error: string }> => {
        const workspace = await dynamoDBService.getItem({
            tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
            key: { workspaceId },
            consistentRead: true,
            origin: `model::Workspace->get(${workspaceId})`
        })

        if (!workspace || Object.keys(workspace).length === 0) {
            return { error: 'NOT_FOUND' }
        }

        const hasAccess = workspace?.accessList?.some(
            (entry: { userId: string }) => entry.userId === userId
        )

        if (!hasAccess) {
            return { error: 'PERMISSION_DENIED' }
        }

        return {
            ...workspace,
            canvasStateUpdatedAt: getCanvasStateUpdatedAt(workspace),
            canvasState: {
                ...workspace.canvasState,
                edges: workspace.canvasState?.edges ?? []
            }
        }
    },

    getUserWorkspaces: async ({
        userId
    }: { userId: string }): Promise<WorkspaceMeta[]> => {
        // Some local tables were created without the expected key schema; use a full scan and filter in memory
        const accessList = await dynamoDBService.scanItems({
            tableName: getDynamoDbTableStageName('WORKSPACES_ACCESS_LIST', ORG_NAME, STAGE),
            limit: 1000,
            fetchAllItems: true,
            consistentRead: true,
            origin: 'model::Workspace->getUserWorkspaces()'
        })

        const userWorkspaces = {
            items: (accessList?.items ?? []).filter((item: { userId?: string }) => item.userId === userId)
        }

        if (!userWorkspaces.items.length) {
            return []
        }

        const workspacesMeta = await dynamoDBService.batchReadItems({
            queries: [{
                tableName: getDynamoDbTableStageName('WORKSPACES_META', ORG_NAME, STAGE),
                keys: userWorkspaces.items.map(({ workspaceId }: { workspaceId: string }) => ({ workspaceId }))
            }],
            readBatchSize: 100,
            fetchAllItems: true,
            scanIndexForward: false,
            origin: 'model::Workspace->getUserWorkspaces()'
        })

        const workspacesMetaItems = workspacesMeta.items[getDynamoDbTableStageName('WORKSPACES_META', ORG_NAME, STAGE)]

        return userWorkspaces.items
            .map((workspace: { workspaceId: string }) =>
                workspacesMetaItems.find((meta: WorkspaceMeta) => meta.workspaceId === workspace.workspaceId)
            )
            .filter((workspace: WorkspaceMeta | undefined): workspace is WorkspaceMeta => Boolean(workspace))
            .sort((a: WorkspaceMeta, b: WorkspaceMeta) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    },

    createWorkspace: async ({
        name,
        organizationId,
        permissions
    }: { name: string; organizationId: string; permissions: { userId: string; accessLevel: string } }): Promise<Workspace | undefined> => {
        const currentDate = new Date().getTime()

        const defaultCanvasState: CanvasState = {
            viewport: { x: 0, y: 0, zoom: 1 },
            nodes: [],
            edges: []
        }

        const newWorkspaceData: Workspace = {
            workspaceId: uuid(),
            organizationId,
            name,
            accessType: 'private',
            accessList: [{
                userId: permissions.userId,
                accessLevel: permissions.accessLevel as 'owner' | 'editor' | 'viewer'
            }],
            canvasState: defaultCanvasState,
            createdAt: currentDate,
            canvasStateUpdatedAt: currentDate,
            updatedAt: currentDate
        }

        try {
            // Main + Meta + Access-List commit or fail together — a torn triad
            // (workspace invisible to its owner) is a permanent integrity fault.
            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'put',
                        tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                        item: newWorkspaceData
                    },
                    {
                        type: 'put',
                        tableName: getDynamoDbTableStageName('WORKSPACES_META', ORG_NAME, STAGE),
                        item: {
                            workspaceId: newWorkspaceData.workspaceId,
                            organizationId: newWorkspaceData.organizationId,
                            name: newWorkspaceData.name,
                            createdAt: newWorkspaceData.createdAt,
                            updatedAt: newWorkspaceData.updatedAt
                        }
                    },
                    {
                        type: 'put',
                        tableName: getDynamoDbTableStageName('WORKSPACES_ACCESS_LIST', ORG_NAME, STAGE),
                        item: {
                            userId: permissions.userId,
                            workspaceId: newWorkspaceData.workspaceId,
                            accessLevel: permissions.accessLevel,
                            createdAt: newWorkspaceData.createdAt,
                            updatedAt: newWorkspaceData.updatedAt
                        }
                    }
                ],
                origin: 'createWorkspace'
            })

            return newWorkspaceData
        } catch (error) {
            err('Failed to create workspace:', error)
        }
    },

    markDeleting: async ({ workspaceId }: { workspaceId: string }): Promise<void> => {
        const now = Date.now()
        await dynamoDBService.updateItem({
            tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
            key: { workspaceId },
            updateExpression: 'SET #deletingAt = if_not_exists(#deletingAt, :deletingAt)',
            conditionExpression: 'attribute_exists(#workspaceId)',
            expressionAttributeNames: { '#workspaceId': 'workspaceId', '#deletingAt': 'deletingAt' },
            expressionAttributeValues: { ':deletingAt': now },
            origin: 'Workspace.markDeleting'
        })
    },

    update: async ({
        workspaceId,
        name,
        userId
    }: { workspaceId: string; name?: string; userId: string }): Promise<void> => {
        const currentDate = new Date().getTime()

        try {
            const workspaceExpressionNames: Record<string, string> = {
                '#canvasStateUpdatedAt': 'canvasStateUpdatedAt',
                '#updatedAt': 'updatedAt'
            }
            const workspaceExpressionValues: Record<string, unknown> = {
                ':updatedAt': currentDate
            }
            const workspaceSetExpressions = [
                '#canvasStateUpdatedAt = if_not_exists(#canvasStateUpdatedAt, #updatedAt)',
                '#updatedAt = :updatedAt'
            ]

            if (name !== undefined) {
                workspaceExpressionNames['#name'] = 'name'
                workspaceExpressionValues[':name'] = name
                workspaceSetExpressions.push('#name = :name')
            }

            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'update',
                        tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                        key: { workspaceId },
                        updateExpression: `SET ${workspaceSetExpressions.join(', ')}`,
                        conditionExpression: 'attribute_not_exists(#deletingAt)',
                        expressionAttributeNames: { ...workspaceExpressionNames, '#deletingAt': 'deletingAt' },
                        expressionAttributeValues: workspaceExpressionValues
                    },
                    ...(name !== undefined ? [{
                        type: 'update' as const,
                        tableName: getDynamoDbTableStageName('WORKSPACES_META', ORG_NAME, STAGE),
                        key: { workspaceId },
                        updates: {
                            name,
                            updatedAt: currentDate
                        }
                    }] : [])
                ],
                origin: 'updateWorkspace'
            })
        } catch (error) {
            err('Failed to update workspace:', error)
        }
    },

    updateCanvasState: async ({
        workspaceId,
        canvasState,
        userId,
        expectedCanvasStateUpdatedAt,
        expectedUpdatedAt,
        persistViewport = false
    }: {
        workspaceId: string
        canvasState: CanvasState
        userId: string
        expectedCanvasStateUpdatedAt?: number
        expectedUpdatedAt?: number
        persistViewport?: boolean
    }): Promise<UpdateCanvasStateResult> => {
        const canvasStateSaveToken = expectedCanvasStateUpdatedAt ?? expectedUpdatedAt
        const hasExpectedCanvasStateUpdatedAt = canvasStateSaveToken !== undefined

        try {
            const currentWorkspace = await dynamoDBService.getItem({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId },
                consistentRead: true,
                origin: 'updateWorkspaceCanvasState:get'
            })
            const currentCanvasState = normalizeCanvasState(currentWorkspace?.canvasState)
            const rawIncomingCanvasState = normalizeCanvasState(canvasState)
            const incomingCanvasState = persistViewport
                ? rawIncomingCanvasState
                : preserveServerManagedMediaGenerationState(currentCanvasState, rawIncomingCanvasState)
            const currentDate = getNextCanvasStateUpdatedAt(currentWorkspace)
            assertRevision2CanvasStorage(incomingCanvasState)
            const currentAssetMembership = getAssetMembershipEntries(currentCanvasState)
            const incomingAssetMembership = getAssetMembershipEntries(incomingCanvasState)
            if (!persistViewport
                && JSON.stringify(currentAssetMembership) !== JSON.stringify(incomingAssetMembership)) {
                const currentMembershipSet = new Set(currentAssetMembership)
                const incomingMembershipSet = new Set(incomingAssetMembership)
                err('[Workspace.updateCanvasState] rejected asset membership mutation:', {
                    workspaceId,
                    expectedCanvasStateUpdatedAt: canvasStateSaveToken,
                    persistedCanvasStateUpdatedAt: getCanvasStateUpdatedAt(currentWorkspace),
                    currentAssetMembership,
                    incomingAssetMembership,
                    addedMembership: incomingAssetMembership.filter(entry => !currentMembershipSet.has(entry)),
                    removedMembership: currentAssetMembership.filter(entry => !incomingMembershipSet.has(entry)),
                    currentNodeCount: currentCanvasState.nodes.length,
                    incomingNodeCount: incomingCanvasState.nodes.length,
                })
                throw new Error('CANVAS_ASSET_MEMBERSHIP_MUTATION_REJECTED')
            }
            const nextCanvasState = persistViewport
                ? { ...currentCanvasState, viewport: incomingCanvasState.viewport }
                : { ...incomingCanvasState, viewport: currentCanvasState.viewport }

            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'update',
                        tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                        key: { workspaceId },
                        updateExpression: 'SET #canvasState = :canvasState, #updatedAt = :updatedAt, #canvasStateUpdatedAt = :canvasStateUpdatedAt',
                        conditionExpression: getCanvasStateWriteCondition(hasExpectedCanvasStateUpdatedAt),
                        expressionAttributeNames: {
                            '#canvasState': 'canvasState',
                            '#updatedAt': 'updatedAt',
                            '#canvasStateUpdatedAt': 'canvasStateUpdatedAt',
                            '#deletingAt': 'deletingAt'
                        },
                        expressionAttributeValues: {
                            ':canvasState': nextCanvasState,
                            ':updatedAt': currentDate,
                            ':canvasStateUpdatedAt': currentDate,
                            ...(hasExpectedCanvasStateUpdatedAt ? { ':expectedCanvasStateUpdatedAt': canvasStateSaveToken } : {})
                        }
                    },
                    {
                        type: 'update',
                        tableName: getDynamoDbTableStageName('WORKSPACES_META', ORG_NAME, STAGE),
                        key: { workspaceId },
                        updates: {
                            updatedAt: currentDate
                        }
                    }
                ],
                logConditionalCheckFailures: false,
                origin: 'updateWorkspaceCanvasState'
            })

            return { success: true, workspaceId, updatedAt: currentDate, canvasStateUpdatedAt: currentDate }
        } catch (error) {
            if (isTransactionConditionalCheckFailure(error)) {
                const workspace = await dynamoDBService.getItem({
                    tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                    key: { workspaceId },
                    consistentRead: true,
                    origin: `updateWorkspaceCanvasState:stale(${workspaceId})`
                })

                return {
                    success: false,
                    workspaceId,
                    error: 'STALE_CANVAS_STATE',
                    currentUpdatedAt: workspace?.updatedAt,
                    currentCanvasStateUpdatedAt: getCanvasStateUpdatedAt(workspace)
                }
            }

            err('Failed to update workspace canvas state:', error)
            throw error
        }
    },

    // Returns the persisted canvas state and its canvasStateUpdatedAt revision so
    // callers can broadcast API-resolved geometry with a monotonic revision.
    mutateCanvasState: async ({
        workspaceId,
        mutate,
        origin = 'mutateWorkspaceCanvasState',
        allowUnboundGeneratedMediaReservationMutation = false,
    }: {
        workspaceId: string
        mutate: CanvasStateMutator
        origin?: string
        allowUnboundGeneratedMediaReservationMutation?: boolean
    }): Promise<{
        changed: boolean
        canvasState: CanvasState | null
        canvasStateUpdatedAt: number | null
    }> => {
        const maxAttempts = 5

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            const workspace = await dynamoDBService.getItem({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId },
                consistentRead: true,
                origin: `${origin}:get`
            })

            if (!workspace || Object.keys(workspace).length === 0) {
                return { changed: false, canvasState: null, canvasStateUpdatedAt: null }
            }

            const currentCanvasState = normalizeCanvasState(workspace.canvasState)
            const result = mutate(currentCanvasState)
            if (!result.changed) return { changed: false, canvasState: currentCanvasState, canvasStateUpdatedAt: getCanvasStateUpdatedAt(workspace) ?? null }
            const nextCanvasState = normalizeCanvasState(result.canvasState)
            assertRevision2CanvasStorage(nextCanvasState)
            if (getAssetMembershipSignature(
                currentCanvasState,
                allowUnboundGeneratedMediaReservationMutation,
            ) !== getAssetMembershipSignature(
                nextCanvasState,
                allowUnboundGeneratedMediaReservationMutation,
            )) {
                throw new Error('CANVAS_ASSET_MEMBERSHIP_MUTATION_REJECTED')
            }

            const currentDate = getNextCanvasStateUpdatedAt(workspace)
            try {
                const expectedCanvasStateUpdatedAt = getCanvasStateUpdatedAt(workspace)
                const hasExpectedCanvasStateUpdatedAt = expectedCanvasStateUpdatedAt !== undefined
                const expressionAttributeValues = {
                    ':canvasState': nextCanvasState,
                    ':updatedAt': currentDate,
                    ':canvasStateUpdatedAt': currentDate,
                    ...(hasExpectedCanvasStateUpdatedAt ? { ':expectedCanvasStateUpdatedAt': expectedCanvasStateUpdatedAt } : {})
                }
                await dynamoDBService.transactWrite({
                    operations: [
                        {
                            type: 'update',
                            tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                            key: { workspaceId },
                            updateExpression: 'SET #canvasState = :canvasState, #updatedAt = :updatedAt, #canvasStateUpdatedAt = :canvasStateUpdatedAt',
                            conditionExpression: getCanvasStateWriteCondition(hasExpectedCanvasStateUpdatedAt),
                            expressionAttributeNames: {
                                '#canvasState': 'canvasState',
                                '#updatedAt': 'updatedAt',
                                '#canvasStateUpdatedAt': 'canvasStateUpdatedAt',
                                '#deletingAt': 'deletingAt'
                            },
                            expressionAttributeValues
                        },
                        {
                            type: 'update',
                            tableName: getDynamoDbTableStageName('WORKSPACES_META', ORG_NAME, STAGE),
                            key: { workspaceId },
                            updates: {
                                updatedAt: currentDate
                            }
                        }
                    ],
                    logConditionalCheckFailures: false,
                    origin
                })
                return { changed: true, canvasState: nextCanvasState, canvasStateUpdatedAt: currentDate }
            } catch (error: any) {
                if (isTransactionConditionalCheckFailure(error)) continue
                err('Failed to mutate workspace canvas state:', error)
                throw error
            }
        }

        throw new Error(`Failed to mutate workspace canvas state after concurrent updates: ${workspaceId}`)
    },

    delete: async ({
        workspaceId,
        userId
    }: { workspaceId: string; userId: string }): Promise<{ status: string; workspaceId: string }> => {
        try {
            const workspace = await dynamoDBService.getItem({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId },
                consistentRead: true,
                origin: 'deleteWorkspace:getAccessList'
            }) as Workspace | undefined
            const accessList = workspace?.accessList ?? [{ userId, accessLevel: 'owner' as const }]
            if (accessList.length > 98) throw new Error('WORKSPACE_ACCESS_LIST_TOO_LARGE')
            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'delete',
                        tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                        key: { workspaceId }
                    },
                    {
                        type: 'delete',
                        tableName: getDynamoDbTableStageName('WORKSPACES_META', ORG_NAME, STAGE),
                        key: { workspaceId }
                    },
                    ...accessList.map((entry) => ({
                        type: 'delete' as const,
                        tableName: getDynamoDbTableStageName('WORKSPACES_ACCESS_LIST', ORG_NAME, STAGE),
                        key: { userId: entry.userId, workspaceId }
                    }))
                ],
                origin: 'deleteWorkspace'
            })

            return { status: 'deleted', workspaceId }
        } catch (error) {
            throw error
        }
    },

    getWorkspaceInternal: async ({
        workspaceId
    }: { workspaceId: string }): Promise<Workspace | null> => {
        const workspace = await dynamoDBService.getItem({
            tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
            key: { workspaceId },
            consistentRead: true,
            origin: `model::Workspace->getInternal(${workspaceId})`
        })

        if (!workspace || Object.keys(workspace).length === 0) {
            return null
        }

        return workspace as Workspace
    },

    replaceWorkspaceContent: async ({
        workspaceId,
        canvasState,
        expectedCanvasStateUpdatedAt
    }: { workspaceId: string; canvasState: CanvasState; expectedCanvasStateUpdatedAt: number }): Promise<void> => {
        assertRevision2CanvasStorage(canvasState)
        const currentDate = Math.max(Date.now(), expectedCanvasStateUpdatedAt + 1)

        try {
            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'update',
                        tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                        key: { workspaceId },
                        updates: {
                            canvasState,
                            canvasStateUpdatedAt: currentDate,
                            updatedAt: currentDate
                        },
                        conditionExpression: '(#canvasStateUpdatedAt = :expectedCanvasStateUpdatedAt OR (attribute_not_exists(#canvasStateUpdatedAt) AND #updatedAt = :expectedCanvasStateUpdatedAt)) AND attribute_not_exists(#deletingAt)',
                        expressionAttributeNames: {
                            '#canvasStateUpdatedAt': 'canvasStateUpdatedAt',
                            '#updatedAt': 'updatedAt',
                            '#deletingAt': 'deletingAt',
                        },
                        expressionAttributeValues: { ':expectedCanvasStateUpdatedAt': expectedCanvasStateUpdatedAt }
                    },
                    {
                        type: 'update',
                        tableName: getDynamoDbTableStageName('WORKSPACES_META', ORG_NAME, STAGE),
                        key: { workspaceId },
                        updates: {
                            updatedAt: currentDate
                        }
                    }
                ],
                origin: 'replaceWorkspaceContent'
            })
        } catch (error) {
            err('Failed to replace workspace content:', error)
            throw error
        }
    }
}
