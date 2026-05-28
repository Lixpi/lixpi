'use strict'

import { info, err, warn } from '@lixpi/debug-tools'

import NATS_Service from '@lixpi/nats-service'
import Workspace from '../../models/workspace.ts'
import Document from '../../models/document.ts'
import Feature from '../../models/feature.ts'
import MediaLibraryItem from '../../models/media-library-item.ts'
import AiChatThread from '../../models/ai-chat-thread.ts'
import ExtractionRun from '../../models/extraction-run.ts'
import {
    deleteLibraryImageObject,
    deleteMediaLibraryWorkspaceBucket,
} from '../../services/media-library-storage.ts'
import { ensureFeatureSamplesForScope } from '../../services/feature-sample-storage.ts'

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
                    // Replication factor is owned by NATS_Service (R3 by default).
                    await natsService.createObjectStore(bucketName, {
                        description: `Files for workspace ${workspace.workspaceId}`
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
        subject: WORKSPACE_SUBJECTS.DELETE_CONTEXT_REGION,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [WORKSPACE_SUBJECTS.DELETE_CONTEXT_REGION] },
            sub: { allow: [WORKSPACE_SUBJECTS.DELETE_CONTEXT_REGION] }
        },
        handler: async (data: any, msg: any) => {
            const workspace = await Workspace.getWorkspace({
                userId: data.user.userId,
                workspaceId: data.workspaceId
            })
            if (!workspace || 'error' in workspace) {
                return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            }

            const canvasState = await Workspace.deleteContextRegion({
                workspaceId: data.workspaceId,
                canvasState: workspace.canvasState,
                contextRegionNodeId: data.contextRegionNodeId,
            })
            if ('error' in canvasState) return canvasState

            return { success: true, workspaceId: data.workspaceId, canvasState }
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
            const workspace = await Workspace.getWorkspace({ userId, workspaceId })
            if ('error' in workspace) return workspace

            try {
                const promotedFeatures = await Feature.listPromotedByOriginWorkspaceForCleanup(workspaceId)
                for (const feature of promotedFeatures) {
                    await ensureFeatureSamplesForScope({
                        feature,
                        newScope: feature.scope,
                        newScopeOwnerId: feature.scopeOwnerId,
                    })
                }
                info(`Preserved ${promotedFeatures.length} promoted feature sample sets for ${workspaceId}`)
            } catch (e: any) {
                warn(`Could not preserve promoted feature samples for workspace ${workspaceId}:`, e.message)
                return { error: 'FEATURE_SAMPLE_MIGRATION_FAILED' }
            }

            try {
                // Delete workspace-scoped features
                const featureResult = await Feature.listByScope({ scope: 'workspace', scopeOwnerId: workspaceId, requesterContext: { userId, workspaceId } })
                for (const f of featureResult.items) { await Feature.deleteFeature({ featureId: f.featureId }).catch(() => {}) }
                info(`Deleted ${featureResult.items.length} workspace features for ${workspaceId}`)
            } catch (e: any) { warn(`Could not clean up features for workspace ${workspaceId}:`, e.message) }

            try {
                const mediaItems = await MediaLibraryItem.listWorkspaceItemsForCleanup(workspaceId)
                for (const item of mediaItems) {
                    await MediaLibraryItem.deleteImageItem({ item })
                    await deleteLibraryImageObject(item).catch(() => {})
                }
                await deleteMediaLibraryWorkspaceBucket(workspaceId).catch(() => {})
                info(`Deleted ${mediaItems.length} workspace Media Library images for ${workspaceId}`)
            } catch (e: any) { warn(`Could not clean up Media Library images for workspace ${workspaceId}:`, e.message) }

            try {
                const deletedThreads = await AiChatThread.deleteWorkspaceAiChatThreads({ workspaceId })
                const deletedExtractionRuns = await ExtractionRun.deleteWorkspaceRuns({ workspaceId })
                info(`Deleted ${deletedThreads} AI chats and ${deletedExtractionRuns} extraction runs for ${workspaceId}`)
            } catch (e: any) { warn(`Could not clean up AI chat history for workspace ${workspaceId}:`, e.message) }

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
