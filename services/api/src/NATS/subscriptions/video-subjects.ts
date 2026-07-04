'use strict'

import { info, err } from '@lixpi/debug-tools'

import NATS_Service from '@lixpi/nats-service'
import Workspace from '../../models/workspace.ts'

import { NATS_SUBJECTS, type DocumentFile } from '@lixpi/constants'

// Mirrors NATS/subscriptions/image-subjects.ts. Video objects live in the same
// workspace bucket as images (workspace-{workspaceId}-files), so deletion uses
// the identical Object Store + Workspace.files cleanup; the only difference is
// the subject name so the workspace canvas can fire video-specific deletions
// without touching image-deletion telemetry.

const { VIDEO_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

const getWorkspaceBucketName = (workspaceId: string) => `workspace-${workspaceId}-files`

const getStorageFileIdsForDelete = (files: DocumentFile[] | undefined, fileId: string): string[] => {
    const file = files?.find((candidate: DocumentFile) => candidate.id === fileId || candidate.canonicalFileId === fileId)
    if (!file) return [fileId]

    return [file.id, file.canonicalFileId].filter((value): value is string => Boolean(value))
}

export const videoSubjects = [
    {
        subject: VIDEO_SUBJECTS.DELETE_VIDEO,
        type: 'reply',
        payloadType: 'json',

        permissions: {
            pub: { allow: [VIDEO_SUBJECTS.DELETE_VIDEO] },
            sub: { allow: [VIDEO_SUBJECTS.DELETE_VIDEO] }
        },

        handler: async (data: any, _msg: any) => {
            const {
                user: { userId },
                workspaceId,
                fileId
            } = data

            if (!workspaceId || !fileId) {
                err('NATS -> DELETE_VIDEO', 'Missing workspaceId or fileId')
                return { error: 'Missing workspaceId or fileId' }
            }

            const workspace = await Workspace.getWorkspace({ userId, workspaceId })
            if (!workspace || 'error' in workspace) {
                err('NATS -> DELETE_VIDEO', `User ${userId} does not have access to workspace ${workspaceId}`)
                return { error: 'Workspace not found or access denied' }
            }

            const natsService = NATS_Service.getInstance()
            if (!natsService) {
                err('NATS -> DELETE_VIDEO', 'NATS service not available')
                return { error: 'Service unavailable' }
            }

            try {
                const bucketName = getWorkspaceBucketName(workspaceId)
                const storageFileIds = getStorageFileIdsForDelete(workspace.files, fileId)
                const isReferenced = await Workspace.isFileReferencedByCanvasState({ workspaceId, fileId })

                if (isReferenced) {
                    return { error: 'FILE_STILL_REFERENCED_BY_CANVAS', fileId }
                }

                await Workspace.removeFile({ workspaceId, fileId })
                info(`Removed video file ${fileId} metadata from workspace ${workspaceId}`)

                for (const storageFileId of storageFileIds) {
                    await natsService.deleteObject(bucketName, storageFileId)
                    info(`Deleted video file ${storageFileId} from bucket ${bucketName}`)
                }

                return { success: true, fileId }
            } catch (error: any) {
                err(`Failed to delete video file ${fileId} from workspace ${workspaceId}:`, error)
                return { error: error.message || 'Failed to delete video file' }
            }
        }
    }
]
