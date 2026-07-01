'use strict'

import { info, err } from '@lixpi/debug-tools'

import NATS_Service from '@lixpi/nats-service'
import Workspace from '../../models/workspace.ts'

import { NATS_SUBJECTS, type DocumentFile } from '@lixpi/constants'

const { IMAGE_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

const getWorkspaceBucketName = (workspaceId: string) => `workspace-${workspaceId}-files`

const getStorageFileIdsForDelete = (files: DocumentFile[] | undefined, fileId: string): string[] => {
    const file = files?.find((candidate: DocumentFile) => candidate.id === fileId || candidate.canonicalFileId === fileId)
    if (!file) return [fileId]

    return [file.id, file.canonicalFileId].filter((value): value is string => Boolean(value))
}

export const imageSubjects = [
    {
        subject: IMAGE_SUBJECTS.DELETE_IMAGE,
        type: 'reply',
        payloadType: 'json',

        permissions: {
            pub: { allow: [IMAGE_SUBJECTS.DELETE_IMAGE] },
            sub: { allow: [IMAGE_SUBJECTS.DELETE_IMAGE] }
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
                const storageFileIds = getStorageFileIdsForDelete(workspace.files, fileId)
                const isReferenced = await Workspace.isFileReferencedByCanvasState({ workspaceId, fileId })

                if (isReferenced) {
                    return { error: 'FILE_STILL_REFERENCED_BY_CANVAS', fileId }
                }

                // Remove file metadata before bytes. If the object delete fails, the
                // remaining object is an orphan; the reverse order leaves live
                // metadata pointing at missing storage.
                await Workspace.removeFile({ workspaceId, fileId })
                info(`Removed file ${fileId} metadata from workspace ${workspaceId}`)

                for (const storageFileId of storageFileIds) {
                    await natsService.deleteObject(bucketName, storageFileId)
                    info(`Deleted file ${storageFileId} from bucket ${bucketName}`)
                }

                return { success: true, fileId }
            } catch (error: any) {
                err(`Failed to delete file ${fileId} from workspace ${workspaceId}:`, error)
                return { error: error.message || 'Failed to delete file' }
            }
        }
    }
]
