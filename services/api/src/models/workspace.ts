'use strict'

import * as process from 'process'
import { v4 as uuid } from 'uuid'

import {
    getDynamoDbTableStageName,
    type Workspace,
    type WorkspaceMeta,
    type WorkspaceAccessList,
    type CanvasState,
    type ContentDescriptor,
    type DocumentFile
} from '@lixpi/constants'
import { err } from '@lixpi/debug-tools'

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
            updatedAt: currentDate
        }

        try {
            await dynamoDBService.putItem({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                item: newWorkspaceData,
                origin: 'createWorkspace'
            })

            await dynamoDBService.putItem({
                tableName: getDynamoDbTableStageName('WORKSPACES_META', ORG_NAME, STAGE),
                item: {
                    workspaceId: newWorkspaceData.workspaceId,
                    name: newWorkspaceData.name,
                    createdAt: newWorkspaceData.createdAt,
                    updatedAt: newWorkspaceData.updatedAt
                },
                origin: 'createWorkspace'
            })

            await dynamoDBService.putItem({
                tableName: getDynamoDbTableStageName('WORKSPACES_ACCESS_LIST', ORG_NAME, STAGE),
                item: {
                    userId: permissions.userId,
                    workspaceId: newWorkspaceData.workspaceId,
                    accessLevel: permissions.accessLevel,
                    createdAt: newWorkspaceData.createdAt,
                    updatedAt: newWorkspaceData.updatedAt
                },
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
            const updates: Record<string, any> = { updatedAt: currentDate }
            if (name !== undefined) {
                updates.name = name
            }

            await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId },
                updates,
                origin: 'updateWorkspace'
            })

            if (name !== undefined) {
                await dynamoDBService.updateItem({
                    tableName: getDynamoDbTableStageName('WORKSPACES_META', ORG_NAME, STAGE),
                    key: { workspaceId },
                    updates: {
                        name,
                        updatedAt: currentDate
                    },
                    origin: 'updateWorkspace'
                })
            }
        } catch (error) {
            err('Failed to update workspace:', error)
        }
    },

    updateCanvasState: async ({
        workspaceId,
        canvasState,
        userId
    }: { workspaceId: string; canvasState: CanvasState; userId: string }): Promise<void> => {
        const currentDate = new Date().getTime()

        try {
            await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId },
                updates: {
                    canvasState,
                    updatedAt: currentDate
                },
                origin: 'updateWorkspaceCanvasState'
            })

            await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('WORKSPACES_META', ORG_NAME, STAGE),
                key: { workspaceId },
                updates: {
                    updatedAt: currentDate
                },
                origin: 'updateWorkspaceCanvasState'
            })
        } catch (error) {
            err('Failed to update workspace canvas state:', error)
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

            const currentCanvasState: CanvasState = {
                viewport: workspace.canvasState?.viewport ?? { x: 0, y: 0, zoom: 1 },
                nodes: workspace.canvasState?.nodes ?? [],
                edges: workspace.canvasState?.edges ?? []
            }
            const result = mutate(currentCanvasState)
            if (!result.changed) return false

            const currentDate = new Date().getTime()
            try {
                const hasExpectedUpdatedAt = workspace.updatedAt !== undefined
                const expressionAttributeValues = {
                    ':canvasState': result.canvasState,
                    ':updatedAt': currentDate,
                    ...(hasExpectedUpdatedAt ? { ':expectedUpdatedAt': workspace.updatedAt } : {})
                }
                await dynamoDBService.updateItem({
                    tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                    key: { workspaceId },
                    updateExpression: 'SET #canvasState = :canvasState, #updatedAt = :updatedAt',
                    conditionExpression: hasExpectedUpdatedAt ? '#updatedAt = :expectedUpdatedAt' : 'attribute_not_exists(#updatedAt)',
                    expressionAttributeNames: {
                        '#canvasState': 'canvasState',
                        '#updatedAt': 'updatedAt'
                    },
                    expressionAttributeValues,
                    origin
                })

                await dynamoDBService.updateItem({
                    tableName: getDynamoDbTableStageName('WORKSPACES_META', ORG_NAME, STAGE),
                    key: { workspaceId },
                    updates: {
                        updatedAt: currentDate
                    },
                    origin: `${origin}:meta`
                })
                return true
            } catch (error: any) {
                if (error?.name === 'ConditionalCheckFailedException') continue
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

            await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId },
                updateExpression: `SET #canvasState.#nodes[${nodeIndex}].#descriptor = :descriptor, #updatedAt = :updatedAt`,
                expressionAttributeNames: {
                    '#canvasState': 'canvasState',
                    '#nodes': 'nodes',
                    '#descriptor': 'descriptor',
                    '#updatedAt': 'updatedAt'
                },
                expressionAttributeValues: {
                    ':descriptor': descriptor,
                    ':updatedAt': currentDate
                },
                origin: 'patchWorkspaceCanvasNodeDescriptor'
            })

            await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('WORKSPACES_META', ORG_NAME, STAGE),
                key: { workspaceId },
                updates: {
                    updatedAt: currentDate
                },
                origin: 'patchWorkspaceCanvasNodeDescriptor:meta'
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
            await dynamoDBService.deleteItems({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId },
                origin: 'deleteWorkspace'
            })

            await dynamoDBService.deleteItems({
                tableName: getDynamoDbTableStageName('WORKSPACES_META', ORG_NAME, STAGE),
                key: { workspaceId },
                origin: 'deleteWorkspace:Meta'
            })

            await dynamoDBService.deleteItems({
                tableName: getDynamoDbTableStageName('WORKSPACES_ACCESS_LIST', ORG_NAME, STAGE),
                key: { userId, workspaceId },
                origin: 'deleteWorkspace:AccessList'
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
                updateExpression: 'SET #files = list_append(if_not_exists(#files, :empty), :newFiles), #updatedAt = :now',
                expressionAttributeNames: {
                    '#files': 'files',
                    '#updatedAt': 'updatedAt'
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
            const fileIndex = currentFiles.findIndex((file: DocumentFile) => file.id === fileId)
            if (fileIndex < 0) return

            try {
                await dynamoDBService.updateItem({
                    tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                    key: { workspaceId },
                    updateExpression: `SET #updatedAt = :now REMOVE #files[${fileIndex}]`,
                    conditionExpression: `#files[${fileIndex}].#id = :fileId`,
                    expressionAttributeNames: {
                        '#files': 'files',
                        '#id': 'id',
                        '#updatedAt': 'updatedAt'
                    },
                    expressionAttributeValues: {
                        ':fileId': fileId,
                        ':now': currentDate
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

    replaceWorkspaceContent: async ({
        workspaceId,
        canvasState,
        files
    }: { workspaceId: string; canvasState: CanvasState; files: DocumentFile[] }): Promise<void> => {
        const currentDate = new Date().getTime()

        try {
            await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId },
                updates: {
                    canvasState,
                    files,
                    updatedAt: currentDate
                },
                origin: 'replaceWorkspaceContent'
            })

            await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('WORKSPACES_META', ORG_NAME, STAGE),
                key: { workspaceId },
                updates: {
                    updatedAt: currentDate
                },
                origin: 'replaceWorkspaceContent:meta'
            })
        } catch (error) {
            err('Failed to replace workspace content:', error)
            throw error
        }
    },

    getBucketName: getWorkspaceBucketName
}
