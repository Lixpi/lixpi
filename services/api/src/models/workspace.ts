'use strict'

import * as process from 'process'
import { v4 as uuid } from 'uuid'

import {
    getDynamoDbTableStageName,
    type Workspace,
    type WorkspaceMeta,
    type WorkspaceAccessList,
    type CanvasState,
    type CanvasNode,
    type ContentDescriptor,
    type DocumentFile
} from '@lixpi/constants'
import { err } from '@lixpi/debug-tools'
import { isTransactionConditionalCheckFailure } from '@lixpi/dynamodb-service'

const {
    ORG_NAME,
    STAGE
} = process.env

const getWorkspaceBucketName = (workspaceId: string) => `workspace-${workspaceId}-files`

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

type CanvasEdge = CanvasState['edges'][number]

type ApiLineageGeneratedBy = {
    generationRequestId?: string
    reasoningRunId?: string
    mediaRunId?: string
    reasoningModelId?: string
    mediaModelId?: string
    mediaType?: 'image' | 'video'
    branchId?: string
    parentMediaNodeId?: string
    parentImageNodeId?: string
    branchOriginNodeId?: string
    branchForkNodeId?: string
    branchLineNodeId?: string
    createdAt?: number
}

type ApiLineageCanvasNode = CanvasNode & {
    generatedBy?: ApiLineageGeneratedBy
    generationRequestId?: string
    branchId?: string
}

type MediaReplacementMarker = {
    replacedAt?: number
    previousFileId?: string
    previousPosterFileId?: string
}

type MediaReplacementCanvasNode = ApiLineageCanvasNode & {
    mediaReplacement?: MediaReplacementMarker
    fileId?: string
    workspaceId?: string
    src?: string
    posterFileId?: string
    posterSrc?: string
    frameFileId?: string
    aspectRatio?: number
    durationSeconds?: number
    hasAudio?: boolean
    descriptor?: ContentDescriptor
}

const API_GENERATED_MEDIA_FULL_SAVE_PROTECTION_MS = 30 * 60 * 1000

const addFileId = (fileIds: Set<string>, fileId: unknown): void => {
    if (typeof fileId === 'string' && fileId.length > 0) {
        fileIds.add(fileId)
    }
}

const getFileRecordByStorageId = (files: DocumentFile[] | undefined, fileId: string): DocumentFile | undefined =>
    files?.find((file: DocumentFile) => file.id === fileId || file.canonicalFileId === fileId)

const getCanvasStateUpdatedAt = (workspace: WorkspaceWithCanvasToken | null | undefined): number | undefined => {
    if (typeof workspace?.canvasStateUpdatedAt === 'number') return workspace.canvasStateUpdatedAt
    if (typeof workspace?.updatedAt === 'number') return workspace.updatedAt
    return undefined
}

const getCanvasStateWriteCondition = (hasExpectedCanvasStateUpdatedAt: boolean): string => {
    if (!hasExpectedCanvasStateUpdatedAt) {
        return '(attribute_not_exists(#canvasStateUpdatedAt) AND attribute_not_exists(#updatedAt))'
    }

    return '(#canvasStateUpdatedAt = :expectedCanvasStateUpdatedAt OR (attribute_not_exists(#canvasStateUpdatedAt) AND #updatedAt = :expectedCanvasStateUpdatedAt))'
}

const normalizeCanvasState = (canvasState: CanvasState | undefined): CanvasState => ({
    viewport: canvasState?.viewport ?? { x: 0, y: 0, zoom: 1 },
    nodes: canvasState?.nodes ?? [],
    edges: canvasState?.edges ?? []
})

const isBranchMarkerNode = (node: CanvasNode): boolean =>
    node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'

const isApiGeneratedMediaNode = (node: CanvasNode): node is ApiLineageCanvasNode =>
    (node.type === 'image' || node.type === 'video')
    && Boolean(
        (node as ApiLineageCanvasNode).generatedBy?.generationRequestId
        || (node as ApiLineageCanvasNode).generatedBy?.mediaRunId
        || (node as ApiLineageCanvasNode).generatedBy?.branchId
    )

const isApiLineageNode = (node: CanvasNode): node is ApiLineageCanvasNode =>
    isBranchMarkerNode(node) || isApiGeneratedMediaNode(node)

const getApiLineageNodeStableKey = (node: ApiLineageCanvasNode): string => {
    if (isBranchMarkerNode(node)) return `marker:${node.nodeId}`

    const generatedBy = node.generatedBy
    if (generatedBy?.mediaRunId) return `generated-media-run:${generatedBy.mediaRunId}`
    if (generatedBy?.generationRequestId && generatedBy.reasoningRunId && generatedBy.mediaModelId) {
        return `generated-media:${generatedBy.generationRequestId}:${generatedBy.reasoningRunId}:${generatedBy.mediaModelId}`
    }

    return `generated-media-node:${node.nodeId}`
}

const isFreshApiGeneratedMediaNode = (node: ApiLineageCanvasNode, currentDate: number): boolean => {
    if (!isApiGeneratedMediaNode(node)) return false

    const createdAt = node.generatedBy?.createdAt
    if (typeof createdAt !== 'number') return false

    return currentDate - createdAt <= API_GENERATED_MEDIA_FULL_SAVE_PROTECTION_MS
}

const addGeneratedLineageMarkerRefs = (node: ApiLineageCanvasNode, refs: Set<string>): void => {
    const generatedBy = node.generatedBy
    addFileId(refs, generatedBy?.branchOriginNodeId)
    addFileId(refs, generatedBy?.branchForkNodeId)
    addFileId(refs, generatedBy?.branchLineNodeId)
}

const shouldApplyIncomingMediaReplacement = (currentNode: ApiLineageCanvasNode, incomingNode: ApiLineageCanvasNode): boolean => {
    if (currentNode.nodeId !== incomingNode.nodeId) return false
    if ((currentNode.type !== 'image' && currentNode.type !== 'video') || currentNode.type !== incomingNode.type) return false

    const currentMediaNode = currentNode as MediaReplacementCanvasNode
    const incomingMediaNode = incomingNode as MediaReplacementCanvasNode
    const replacement = incomingMediaNode.mediaReplacement
    if (typeof replacement?.replacedAt !== 'number') return false
    if (!incomingMediaNode.fileId || incomingMediaNode.fileId === currentMediaNode.fileId) return false
    if (replacement.previousFileId && replacement.previousFileId !== currentMediaNode.fileId) return false

    return true
}

const applyIncomingMediaReplacementFields = (merged: Record<string, unknown>, incomingNode: ApiLineageCanvasNode): void => {
    const incomingMediaNode = incomingNode as MediaReplacementCanvasNode

    for (const field of ['fileId', 'workspaceId', 'src', 'aspectRatio', 'descriptor'] as const) {
        if (field in incomingMediaNode) merged[field] = incomingMediaNode[field]
    }

    if (incomingNode.type === 'video') {
        for (const field of ['posterFileId', 'posterSrc', 'frameFileId', 'durationSeconds', 'hasAudio'] as const) {
            if (field in incomingMediaNode) merged[field] = incomingMediaNode[field]
        }
    }

    delete merged.mediaReplacement
}

const applyIncomingLayoutFields = (currentNode: ApiLineageCanvasNode, incomingNode: ApiLineageCanvasNode): CanvasNode => {
    const merged = { ...incomingNode, ...currentNode } as Record<string, unknown>

    if ('position' in incomingNode) merged.position = incomingNode.position
    if ('dimensions' in incomingNode) merged.dimensions = incomingNode.dimensions
    if ('parentId' in incomingNode) merged.parentId = incomingNode.parentId
    if ('extent' in incomingNode) merged.extent = incomingNode.extent
    if ('expandParent' in incomingNode) merged.expandParent = incomingNode.expandParent
    if (shouldApplyIncomingMediaReplacement(currentNode, incomingNode)) {
        applyIncomingMediaReplacementFields(merged, incomingNode)
    } else {
        delete merged.mediaReplacement
    }

    return merged as CanvasNode
}

function mergeApiLineageForFullCanvasSave(
    currentCanvasState: CanvasState,
    incomingCanvasState: CanvasState,
    currentDate: number
): CanvasState {
    const currentApiNodes = currentCanvasState.nodes.filter(isApiLineageNode)
    if (currentApiNodes.length === 0) return incomingCanvasState

    const currentApiNodesById = new Map(currentApiNodes.map(node => [node.nodeId, node]))
    const currentApiNodesByStableKey = new Map(currentApiNodes.map(node => [getApiLineageNodeStableKey(node), node]))
    const incomingApiNodeIds = new Set<string>()
    const protectedMarkerNodeIds = new Set<string>()
    const nextNodes: CanvasNode[] = []
    const includedNodeIds = new Set<string>()

    const includeNode = (node: CanvasNode): void => {
        if (includedNodeIds.has(node.nodeId)) {
            const index = nextNodes.findIndex(candidate => candidate.nodeId === node.nodeId)
            if (index >= 0) nextNodes[index] = node
            return
        }

        nextNodes.push(node)
        includedNodeIds.add(node.nodeId)
    }

    for (const incomingNode of incomingCanvasState.nodes) {
        if (!isApiLineageNode(incomingNode)) {
            includeNode(incomingNode)
            continue
        }

        incomingApiNodeIds.add(incomingNode.nodeId)
        const stableKey = getApiLineageNodeStableKey(incomingNode)
        const currentNode = currentApiNodesByStableKey.get(stableKey)

        if (!currentNode) continue

        if (isApiGeneratedMediaNode(currentNode)) addGeneratedLineageMarkerRefs(currentNode, protectedMarkerNodeIds)

        const nodeToInclude = currentNode.nodeId === incomingNode.nodeId
            ? applyIncomingLayoutFields(currentNode, incomingNode)
            : currentNode
        includeNode(nodeToInclude)
    }

    for (const currentNode of currentApiNodes) {
        if (includedNodeIds.has(currentNode.nodeId)) continue

        if (isBranchMarkerNode(currentNode)) continue
        if (!isFreshApiGeneratedMediaNode(currentNode, currentDate)) continue

        addGeneratedLineageMarkerRefs(currentNode, protectedMarkerNodeIds)
        includeNode(currentNode)
    }

    for (const currentNode of currentApiNodes) {
        if (includedNodeIds.has(currentNode.nodeId)) continue
        if (!isBranchMarkerNode(currentNode)) continue

        if (protectedMarkerNodeIds.has(currentNode.nodeId)) {
            includeNode(currentNode)
        }
    }

    const apiNodeIds = new Set([
        ...currentApiNodes.map(node => node.nodeId),
        ...incomingApiNodeIds,
    ])
    const nextNodeIds = new Set(nextNodes.map(node => node.nodeId))
    const nextEdgesById = new Map<string, CanvasEdge>()

    for (const edge of incomingCanvasState.edges ?? []) {
        if (apiNodeIds.has(edge.sourceNodeId) || apiNodeIds.has(edge.targetNodeId)) continue
        if (!nextNodeIds.has(edge.sourceNodeId) || !nextNodeIds.has(edge.targetNodeId)) continue
        nextEdgesById.set(edge.edgeId, edge)
    }

    for (const edge of currentCanvasState.edges ?? []) {
        if (!currentApiNodesById.has(edge.sourceNodeId) && !currentApiNodesById.has(edge.targetNodeId)) continue
        if (!nextNodeIds.has(edge.sourceNodeId) || !nextNodeIds.has(edge.targetNodeId)) continue
        nextEdgesById.set(edge.edgeId, edge)
    }

    return {
        ...incomingCanvasState,
        nodes: nextNodes,
        edges: [...nextEdgesById.values()],
    }
}

const getCanvasStateReferencedFileIds = (canvasState: CanvasState | null | undefined): Set<string> => {
    const fileIds = new Set<string>()

    for (const node of canvasState?.nodes ?? []) {
        const mediaNode = node as CanvasNode & {
            fileId?: string
            posterFileId?: string
            frameFileId?: string
        }

        switch (mediaNode.type) {
            case 'image':
            case 'audio':
                addFileId(fileIds, mediaNode.fileId)
                break
            case 'video':
                addFileId(fileIds, mediaNode.fileId)
                addFileId(fileIds, mediaNode.posterFileId)
                addFileId(fileIds, mediaNode.frameFileId)
                break
            case 'mediaDocument':
                addFileId(fileIds, mediaNode.fileId)
                addFileId(fileIds, mediaNode.posterFileId)
                break
        }
    }

    return fileIds
}

export default {
    getWorkspace: async ({
        workspaceId,
        userId
    }: { workspaceId: string; userId: string }): Promise<Workspace | { error: string }> => {
        const workspace = await dynamoDBService.getItem({
            tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
            key: { workspaceId },
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
        permissions
    }: { name: string; permissions: { userId: string; accessLevel: string } }): Promise<Workspace | undefined> => {
        const currentDate = new Date().getTime()

        const defaultCanvasState: CanvasState = {
            viewport: { x: 0, y: 0, zoom: 1 },
            nodes: [],
            edges: []
        }

        const newWorkspaceData: Workspace = {
            workspaceId: uuid(),
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
                        expressionAttributeNames: workspaceExpressionNames,
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
        expectedUpdatedAt
    }: {
        workspaceId: string
        canvasState: CanvasState
        userId: string
        expectedCanvasStateUpdatedAt?: number
        expectedUpdatedAt?: number
    }): Promise<UpdateCanvasStateResult> => {
        const currentDate = new Date().getTime()
        const canvasStateSaveToken = expectedCanvasStateUpdatedAt ?? expectedUpdatedAt
        const hasExpectedCanvasStateUpdatedAt = canvasStateSaveToken !== undefined

        try {
            const currentWorkspace = await dynamoDBService.getItem({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId },
                origin: 'updateWorkspaceCanvasState:get'
            })
            const nextCanvasState = mergeApiLineageForFullCanvasSave(
                normalizeCanvasState(currentWorkspace?.canvasState),
                normalizeCanvasState(canvasState),
                currentDate
            )

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
                            '#canvasStateUpdatedAt': 'canvasStateUpdatedAt'
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

    mutateCanvasState: async ({
        workspaceId,
        mutate,
        origin = 'mutateWorkspaceCanvasState'
    }: { workspaceId: string; mutate: CanvasStateMutator; origin?: string }): Promise<boolean> => {
        const maxAttempts = 5

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            const workspace = await dynamoDBService.getItem({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId },
                origin: `${origin}:get`
            })

            if (!workspace || Object.keys(workspace).length === 0) {
                return false
            }

            const currentCanvasState = normalizeCanvasState(workspace.canvasState)
            const result = mutate(currentCanvasState)
            if (!result.changed) return false

            const currentDate = new Date().getTime()
            try {
                const expectedCanvasStateUpdatedAt = getCanvasStateUpdatedAt(workspace)
                const hasExpectedCanvasStateUpdatedAt = expectedCanvasStateUpdatedAt !== undefined
                const expressionAttributeValues = {
                    ':canvasState': result.canvasState,
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
                                '#canvasStateUpdatedAt': 'canvasStateUpdatedAt'
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
                return true
            } catch (error: any) {
                if (isTransactionConditionalCheckFailure(error)) continue
                err('Failed to mutate workspace canvas state:', error)
                throw error
            }
        }

        throw new Error(`Failed to mutate workspace canvas state after concurrent updates: ${workspaceId}`)
    },

    patchCanvasNodeDescriptor: async ({
        workspaceId,
        nodeId,
        descriptor
    }: { workspaceId: string; nodeId: string; descriptor: ContentDescriptor }): Promise<boolean> => {
        const currentDate = new Date().getTime()

        try {
            const workspace = await dynamoDBService.getItem({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId },
                origin: `model::Workspace->patchCanvasNodeDescriptor:get(${workspaceId}:${nodeId})`
            })

            const nodes = workspace?.canvasState?.nodes ?? []
            const nodeIndex = nodes.findIndex((node: { nodeId?: string }) => node.nodeId === nodeId)
            if (nodeIndex < 0) return false

            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'update',
                        tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                        key: { workspaceId },
                        updateExpression: `SET #canvasState.#nodes[${nodeIndex}].#descriptor = :descriptor, #updatedAt = :updatedAt, #canvasStateUpdatedAt = :canvasStateUpdatedAt`,
                        conditionExpression: `#canvasState.#nodes[${nodeIndex}].#nodeId = :nodeId`,
                        expressionAttributeNames: {
                            '#canvasState': 'canvasState',
                            '#nodes': 'nodes',
                            '#descriptor': 'descriptor',
                            '#updatedAt': 'updatedAt',
                            '#canvasStateUpdatedAt': 'canvasStateUpdatedAt',
                            '#nodeId': 'nodeId'
                        },
                        expressionAttributeValues: {
                            ':descriptor': descriptor,
                            ':updatedAt': currentDate,
                            ':canvasStateUpdatedAt': currentDate,
                            ':nodeId': nodeId
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
                origin: 'patchWorkspaceCanvasNodeDescriptor'
            })

            return true
        } catch (error) {
            err('Failed to patch workspace canvas node descriptor:', error)
            throw error
        }
    },

    delete: async ({
        workspaceId,
        userId
    }: { workspaceId: string; userId: string }): Promise<{ status: string; workspaceId: string }> => {
        try {
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
                    {
                        type: 'delete',
                        tableName: getDynamoDbTableStageName('WORKSPACES_ACCESS_LIST', ORG_NAME, STAGE),
                        key: { userId, workspaceId }
                    }
                ],
                origin: 'deleteWorkspace'
            })

            return { status: 'deleted', workspaceId }
        } catch (error) {
            throw error
        }
    },

    addFile: async ({
        workspaceId,
        file
    }: { workspaceId: string; file: DocumentFile }): Promise<void> => {
        const currentDate = new Date().getTime()

        try {
            // Atomic append. A read-modify-write here races when several images
            // are stored concurrently (AI generation, extraction samples) and
            // silently drops file registrations; list_append serializes per-item
            // in DynamoDB so concurrent appends never clobber each other.
            await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId },
                updateExpression: 'SET #canvasStateUpdatedAt = if_not_exists(#canvasStateUpdatedAt, #updatedAt), #files = list_append(if_not_exists(#files, :empty), :newFiles), #updatedAt = :now',
                expressionAttributeNames: {
                    '#files': 'files',
                    '#updatedAt': 'updatedAt',
                    '#canvasStateUpdatedAt': 'canvasStateUpdatedAt'
                },
                expressionAttributeValues: {
                    ':empty': [],
                    ':newFiles': [file],
                    ':now': currentDate
                },
                origin: 'model::Workspace->addFile()'
            })
        } catch (error) {
            err('Failed to add file to workspace:', error)
            throw error
        }
    },

    removeFile: async ({
        workspaceId,
        fileId
    }: { workspaceId: string; fileId: string }): Promise<void> => {
        const currentDate = new Date().getTime()
        const maxAttempts = 5

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            const workspace = await dynamoDBService.getItem({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId },
                origin: 'model::Workspace->removeFile()'
            })

            const currentFiles = workspace?.files || []
            const fileIndex = currentFiles.findIndex((file: DocumentFile) => file.id === fileId || file.canonicalFileId === fileId)
            if (fileIndex < 0) return
            const matchedFile = currentFiles[fileIndex] as DocumentFile
            const removingCanonicalPointer = matchedFile.id !== fileId && matchedFile.canonicalFileId === fileId
            const previousUpdatedAt = typeof workspace?.updatedAt === 'number' ? workspace.updatedAt : currentDate
            // Only declare the attribute name the conditionExpression actually
            // uses — DynamoDB rejects the request if #id is declared but unused
            // (the canonical-pointer branch matches on #canonicalFileId instead).
            const expressionAttributeNames: Record<string, string> = {
                '#files': 'files',
                '#updatedAt': 'updatedAt',
                '#canvasStateUpdatedAt': 'canvasStateUpdatedAt'
            }
            if (removingCanonicalPointer) {
                expressionAttributeNames['#canonicalFileId'] = 'canonicalFileId'
            } else {
                expressionAttributeNames['#id'] = 'id'
            }

            try {
                await dynamoDBService.updateItem({
                    tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                    key: { workspaceId },
                    updateExpression: `SET #canvasStateUpdatedAt = if_not_exists(#canvasStateUpdatedAt, :previousUpdatedAt), #updatedAt = :now REMOVE #files[${fileIndex}]`,
                    conditionExpression: removingCanonicalPointer
                        ? `#files[${fileIndex}].#canonicalFileId = :fileId`
                        : `#files[${fileIndex}].#id = :fileId`,
                    expressionAttributeNames,
                    expressionAttributeValues: {
                        ':fileId': fileId,
                        ':now': currentDate,
                        ':previousUpdatedAt': previousUpdatedAt
                    },
                    origin: 'model::Workspace->removeFile()'
                })
                return
            } catch (error: any) {
                if (error?.name === 'ConditionalCheckFailedException') continue
                err('Failed to remove file from workspace:', error)
                throw error
            }
        }

        throw new Error(`Failed to remove file from workspace after concurrent updates: ${workspaceId}/${fileId}`)
    },

    // Point an already-registered original file at the canonical derivative the
    // file-conversion workload produced. Used by the async ingest completion path
    // (the original was registered at upload time without a canonical; the
    // workload transcodes later and the API patches the pointer here). Mirrors
    // removeFile's read-modify-write retry against concurrent file mutations.
    setFileCanonical: async ({
        workspaceId,
        fileId,
        canonicalFileId,
        canonicalMimeType
    }: { workspaceId: string; fileId: string; canonicalFileId: string; canonicalMimeType: string }): Promise<void> => {
        const currentDate = new Date().getTime()
        const maxAttempts = 5

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            const workspace = await dynamoDBService.getItem({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId },
                origin: 'model::Workspace->setFileCanonical()'
            })

            const currentFiles = workspace?.files || []
            const fileIndex = currentFiles.findIndex((file: DocumentFile) => file.id === fileId)
            if (fileIndex < 0) return
            const previousUpdatedAt = typeof workspace?.updatedAt === 'number' ? workspace.updatedAt : currentDate

            try {
                await dynamoDBService.updateItem({
                    tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                    key: { workspaceId },
                    updateExpression: `SET #canvasStateUpdatedAt = if_not_exists(#canvasStateUpdatedAt, :previousUpdatedAt), #updatedAt = :now, #files[${fileIndex}].#canonicalFileId = :canonicalFileId, #files[${fileIndex}].#canonicalMimeType = :canonicalMimeType`,
                    conditionExpression: `#files[${fileIndex}].#id = :fileId`,
                    expressionAttributeNames: {
                        '#files': 'files',
                        '#id': 'id',
                        '#canonicalFileId': 'canonicalFileId',
                        '#canonicalMimeType': 'canonicalMimeType',
                        '#updatedAt': 'updatedAt',
                        '#canvasStateUpdatedAt': 'canvasStateUpdatedAt'
                    },
                    expressionAttributeValues: {
                        ':fileId': fileId,
                        ':canonicalFileId': canonicalFileId,
                        ':canonicalMimeType': canonicalMimeType,
                        ':now': currentDate,
                        ':previousUpdatedAt': previousUpdatedAt
                    },
                    origin: 'model::Workspace->setFileCanonical()'
                })
                return
            } catch (error: any) {
                if (error?.name === 'ConditionalCheckFailedException') continue
                err('Failed to set file canonical pointer:', error)
                throw error
            }
        }

        throw new Error(`Failed to set file canonical after concurrent updates: ${workspaceId}/${fileId}`)
    },

    getWorkspaceInternal: async ({
        workspaceId
    }: { workspaceId: string }): Promise<Workspace | null> => {
        const workspace = await dynamoDBService.getItem({
            tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
            key: { workspaceId },
            origin: `model::Workspace->getInternal(${workspaceId})`
        })

        if (!workspace || Object.keys(workspace).length === 0) {
            return null
        }

        return workspace as Workspace
    },

    getCanvasStateReferencedFileIds,

    isFileReferencedByCanvasState: async ({
        workspaceId,
        fileId
    }: { workspaceId: string; fileId: string }): Promise<boolean> => {
        const workspace = await dynamoDBService.getItem({
            tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
            key: { workspaceId },
            origin: `model::Workspace->isFileReferencedByCanvasState(${workspaceId}:${fileId})`
        })

        const referencedFileIds = getCanvasStateReferencedFileIds(workspace?.canvasState)
        if (referencedFileIds.has(fileId)) return true

        const file = getFileRecordByStorageId(workspace?.files, fileId)
        return Boolean(file && (
            referencedFileIds.has(file.id)
            || (file.canonicalFileId ? referencedFileIds.has(file.canonicalFileId) : false)
        ))
    },

    replaceWorkspaceContent: async ({
        workspaceId,
        canvasState,
        files
    }: { workspaceId: string; canvasState: CanvasState; files: DocumentFile[] }): Promise<void> => {
        const currentDate = new Date().getTime()

        try {
            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'update',
                        tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                        key: { workspaceId },
                        updates: {
                            canvasState,
                            files,
                            canvasStateUpdatedAt: currentDate,
                            updatedAt: currentDate
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
                origin: 'replaceWorkspaceContent'
            })
        } catch (error) {
            err('Failed to replace workspace content:', error)
            throw error
        }
    },

    getBucketName: getWorkspaceBucketName
}
