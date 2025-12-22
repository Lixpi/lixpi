'use strict'

import { info, err, warn } from '@lixpi/debug-tools'

import NATS_Service from '@lixpi/nats-service'
import Workspace from '../../models/workspace.ts'
import Document from '../../models/document.ts'

import { NATS_SUBJECTS } from '@lixpi/constants'

const { WORKSPACE_SUBJECTS } = NATS_SUBJECTS

export const workspaceSubjects = [
    {
        subject: WORKSPACE_SUBJECTS.GET_WORKSPACE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [WORKSPACE_SUBJECTS.GET_WORKSPACE] },
            sub: { allow: [WORKSPACE_SUBJECTS.GET_WORKSPACE] }
        },
        handler: async (data: any, msg: any) => {
            return await Workspace.getWorkspace({
                userId: data.user.userId,
                workspaceId: data.workspaceId
            })
        }
    },

    {
        subject: WORKSPACE_SUBJECTS.CREATE_WORKSPACE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [WORKSPACE_SUBJECTS.CREATE_WORKSPACE] },
            sub: { allow: [WORKSPACE_SUBJECTS.CREATE_WORKSPACE] }
        },
        handler: async (data: any, msg: any) => {
            const {
                user: { userId },
                name
            } = data

            const workspace = await Workspace.createWorkspace({
                name,
                permissions: {
                    userId,
                    accessLevel: 'owner'
                }
            })

            if (workspace && 'workspaceId' in workspace) {
                const natsService = NATS_Service.getInstance()
                const bucketName = Workspace.getBucketName(workspace.workspaceId)

                if (!natsService) {
                    err(`Failed to create Object Store bucket ${bucketName}: NATS service unavailable`)
                    await Workspace.delete({ userId, workspaceId: workspace.workspaceId })
                    return { error: 'STORAGE_SERVICE_UNAVAILABLE' }
                }

                try {
                    await natsService.createObjectStore(bucketName, {
                        description: `Files for workspace ${workspace.workspaceId}`,
                        replicas: 1
                    })
                    info(`Created Object Store bucket: ${bucketName}`)
                } catch (bucketError: any) {
                    err(`Failed to create Object Store bucket for workspace ${workspace.workspaceId}:`, bucketError)
                    await Workspace.delete({ userId, workspaceId: workspace.workspaceId })
                    return { error: 'FAILED_TO_CREATE_BUCKET' }
                }
            }

            return workspace
        }
    },

    {
        subject: WORKSPACE_SUBJECTS.GET_USER_WORKSPACES,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [WORKSPACE_SUBJECTS.GET_USER_WORKSPACES] },
            sub: { allow: [WORKSPACE_SUBJECTS.GET_USER_WORKSPACES] }
        },
        handler: async (data: any, msg: any) => {
            const userId = data.user.userId

            if (!userId) {
                err('NATS -> WORKSPACE_SUBJECTS.GET_USER_WORKSPACES', 'userId is not available in the request.')
                return { error: 'UNAUTHORIZED' }
            }

            return await Workspace.getUserWorkspaces({ userId })
        }
    },

    {
        subject: WORKSPACE_SUBJECTS.UPDATE_WORKSPACE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [WORKSPACE_SUBJECTS.UPDATE_WORKSPACE] },
            sub: { allow: [WORKSPACE_SUBJECTS.UPDATE_WORKSPACE] }
        },
        handler: async (data: any, msg: any) => {
            await Workspace.update({
                userId: data.user.userId,
                workspaceId: data.workspaceId,
                name: data.name
            })

            return {
                success: true,
                workspaceId: data.workspaceId
            }
        }
    },

    {
        subject: WORKSPACE_SUBJECTS.UPDATE_CANVAS_STATE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [WORKSPACE_SUBJECTS.UPDATE_CANVAS_STATE] },
            sub: { allow: [WORKSPACE_SUBJECTS.UPDATE_CANVAS_STATE] }
        },
        handler: async (data: any, msg: any) => {
            await Workspace.updateCanvasState({
                userId: data.user.userId,
                workspaceId: data.workspaceId,
                canvasState: data.canvasState
            })

            return {
                success: true,
                workspaceId: data.workspaceId
            }
        }
    },

    {
        subject: WORKSPACE_SUBJECTS.DELETE_WORKSPACE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [WORKSPACE_SUBJECTS.DELETE_WORKSPACE] },
            sub: { allow: [WORKSPACE_SUBJECTS.DELETE_WORKSPACE] }
        },
        handler: async (data: any, msg: any) => {
            const { workspaceId } = data
            const userId = data.user.userId

            try {
                const natsService = NATS_Service.getInstance()
                if (natsService) {
                    const bucketName = Workspace.getBucketName(workspaceId)
                    await natsService.deleteObjectStore(bucketName)
                    info(`Deleted Object Store bucket: ${bucketName}`)
                }
            } catch (bucketError: any) {
                warn(`Could not delete Object Store bucket for workspace ${workspaceId}:`, bucketError.message)
            }

            await Workspace.delete({
                userId,
                workspaceId
            })

            return {
                success: true,
                workspaceId
            }
        }
    },

    {
        subject: WORKSPACE_SUBJECTS.GET_WORKSPACE_DOCUMENTS,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [WORKSPACE_SUBJECTS.GET_WORKSPACE_DOCUMENTS] },
            sub: { allow: [WORKSPACE_SUBJECTS.GET_WORKSPACE_DOCUMENTS] }
        },
        handler: async (data: any, msg: any) => {
            const { workspaceId } = data
            const userId = data.user.userId

            const workspace = await Workspace.getWorkspace({ userId, workspaceId })

            if (!workspace || 'error' in workspace) {
                return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            }

            return await Document.getWorkspaceDocuments({ workspaceId })
        }
    }
]
