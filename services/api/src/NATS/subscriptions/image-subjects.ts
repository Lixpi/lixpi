'use strict'

import { info, err } from '@lixpi/debug-tools'

import NATS_Service from '@lixpi/nats-service'
import Workspace from '../../models/workspace.ts'

import { NATS_SUBJECTS } from '@lixpi/constants'

const { WORKSPACE_IMAGE_SUBJECTS } = NATS_SUBJECTS

const getWorkspaceBucketName = (workspaceId: string) => `workspace-${workspaceId}-files`

export const imageSubjects = [
    {
        subject: WORKSPACE_IMAGE_SUBJECTS.DELETE_IMAGE,
        type: 'reply',
        payloadType: 'json',

        permissions: {
            pub: { allow: [WORKSPACE_IMAGE_SUBJECTS.DELETE_IMAGE] },
            sub: { allow: [WORKSPACE_IMAGE_SUBJECTS.DELETE_IMAGE] }
        },

        handler: async (data: any, msg: any) => {
            const {
                user: { userId },
                workspaceId,
                fileId
            } = data

            if (!workspaceId || !fileId) {
                err('NATS -> DELETE_IMAGE', 'Missing workspaceId or fileId')
                return { error: 'Missing workspaceId or fileId' }
            }

            // Verify user has access to the workspace
            const workspace = await Workspace.getWorkspace({
                userId,
                workspaceId
            })

            if (!workspace || 'error' in workspace) {
                err('NATS -> DELETE_IMAGE', `User ${userId} does not have access to workspace ${workspaceId}`)
                return { error: 'Workspace not found or access denied' }
            }

            const natsService = NATS_Service.getInstance()
            if (!natsService) {
                err('NATS -> DELETE_IMAGE', 'NATS service not available')
                return { error: 'Service unavailable' }
            }

            try {
                const bucketName = getWorkspaceBucketName(workspaceId)

                // Delete file from Object Store
                await natsService.deleteObject(bucketName, fileId)
                info(`Deleted file ${fileId} from bucket ${bucketName}`)

                // Remove file metadata from workspace
                await Workspace.removeFile({ workspaceId, fileId })
                info(`Removed file ${fileId} metadata from workspace ${workspaceId}`)

                return { success: true, fileId }
            } catch (error: any) {
                err(`Failed to delete file ${fileId} from workspace ${workspaceId}:`, error)
                return { error: error.message || 'Failed to delete file' }
            }
        }
    }
]
