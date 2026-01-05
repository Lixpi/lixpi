'use strict'

import * as process from 'process'
import { v4 as uuid } from 'uuid'

import {
    getDynamoDbTableStageName,
    type Workspace,
    type WorkspaceMeta,
    type WorkspaceAccessList,
    type CanvasState,
    type DocumentFile
} from '@lixpi/constants'

const {
    ORG_NAME,
    STAGE
} = process.env

const getWorkspaceBucketName = (workspaceId: string) => `workspace-${workspaceId}-files`

export default {
    getWorkspace: async ({
        workspaceId,
        userId
    }: { workspaceId: string; userId: string }): Promise<Workspace | { error: string }> => {
        console.log('Workspace.getWorkspace called with:', { workspaceId, userId })

        const workspace = await dynamoDBService.getItem({
            tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
            key: { workspaceId },
            origin: `model::Workspace->get(${workspaceId})`
        })

        console.log('Workspace.getWorkspace fetched workspace:', workspace)

        if (!workspace || Object.keys(workspace).length === 0) {
            return { error: 'NOT_FOUND' }
        }

        console.log('Workspace accessList:', workspace?.accessList)
        const hasAccess = workspace?.accessList?.some(
            (entry: { userId: string }) => entry.userId === userId
        )
        console.log('hasAccess:', hasAccess)

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
            .sort((a: WorkspaceMeta, b: WorkspaceMeta) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
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
            console.error('Failed to create workspace:', error)
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
            console.error('Failed to update workspace:', error)
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
            console.error('Failed to update workspace canvas state:', error)
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
            const workspace = await dynamoDBService.getItem({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId },
                origin: 'model::Workspace->addFile()'
            })

            const currentFiles = workspace?.files || []
            currentFiles.push(file)

            await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId },
                updates: {
                    files: currentFiles,
                    updatedAt: currentDate
                },
                origin: 'model::Workspace->addFile()'
            })
        } catch (error) {
            console.error('Failed to add file to workspace:', error)
            throw error
        }
    },

    removeFile: async ({
        workspaceId,
        fileId
    }: { workspaceId: string; fileId: string }): Promise<void> => {
        const currentDate = new Date().getTime()

        try {
            const workspace = await dynamoDBService.getItem({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId },
                origin: 'model::Workspace->removeFile()'
            })

            const currentFiles = workspace?.files || []
            const updatedFiles = currentFiles.filter((file: DocumentFile) => file.id !== fileId)

            await dynamoDBService.updateItem({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId },
                updates: {
                    files: updatedFiles,
                    updatedAt: currentDate
                },
                origin: 'model::Workspace->removeFile()'
            })
        } catch (error) {
            console.error('Failed to remove file from workspace:', error)
            throw error
        }
    },

    getBucketName: getWorkspaceBucketName
}
