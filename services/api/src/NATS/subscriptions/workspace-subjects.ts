import { createNatsSubscriptions } from '../create-nats-subscriptions.ts'
import {
    info,
    warn,
} from '@lixpi/debug-tools'
import { getNatsSubjectPath } from '@lixpi/constants'

import Workspace from '../../models/workspace.ts'
import AssetModel from '../../models/asset.ts'
import Organization from '../../models/organization.ts'
import { getAssetRequesterContext } from '../../services/asset-requester-context.ts'
import { MediaGenerationRequestService } from '../../services/media-generation-request-service.ts'

export const workspaceSubjects = createNatsSubscriptions(
    'workspace',
    {
        [getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.GET_WORKSPACE)]: async (data: any) => await Workspace.getWorkspace({
            userId: data.user.userId,
            workspaceId: data.workspaceId,
        }),
        [getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.CREATE_WORKSPACE)]: async (data: any) => {
            const organizations = await Organization.getUserOrganizations({ userId: data.user.userId })

            if (
                data.organizationId
                && !organizations.some(entry => entry.organizationId === data.organizationId)
            )
                return { error: 'ORGANIZATION_ACCESS_DENIED' }

            const organizationId = data.organizationId ?? organizations[0]?.organizationId

            if (!organizationId)
                return { error: 'ORGANIZATION_ACCESS_DENIED' }

            return await Workspace.createWorkspace({
                name: data.name,
                organizationId,
                permissions: {
                    userId: data.user.userId,
                    accessLevel: 'owner',
                },
            })
        },
        [getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.GET_USER_WORKSPACES)]: async (data: any) =>
            data.user.userId
                ? await Workspace.getUserWorkspaces({ userId: data.user.userId })
                : { error: 'UNAUTHORIZED' },
        [getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.UPDATE_WORKSPACE)]: async (data: any) => {
            const workspace = await Workspace.getWorkspace({
                userId: data.user.userId,
                workspaceId: data.workspaceId,
            })

            if ('error' in workspace)
                return workspace

            if (workspace.deletingAt)
                return { error: 'WORKSPACE_DELETING' }

            if (!workspace.accessList.some(
                entry => entry.userId === data.user.userId && (entry.accessLevel === 'owner' || entry.accessLevel === 'editor'),
            ))
                return { error: 'PERMISSION_DENIED' }

            if (
                data.name !== undefined
                && (typeof data.name !== 'string' || !data.name.trim())
            )
                return { error: 'NAME_REQUIRED' }

            await Workspace.update({
                userId: data.user.userId,
                workspaceId: data.workspaceId,
                name: data.name,
            })

            return {
                success: true,
                workspaceId: data.workspaceId,
            }
        },
        [getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.UPDATE_CANVAS_STATE)]: async (data: any) => {
            const workspace = await Workspace.getWorkspace({
                userId: data.user.userId,
                workspaceId: data.workspaceId,
            })

            if ('error' in workspace)
                return workspace

            if (workspace.deletingAt)
                return { error: 'WORKSPACE_DELETING' }

            if (!workspace.accessList.some(
                entry => entry.userId === data.user.userId && (entry.accessLevel === 'owner' || entry.accessLevel === 'editor'),
            ))
                return { error: 'PERMISSION_DENIED' }

            return await Workspace.updateCanvasState({
                userId: data.user.userId,
                workspaceId: data.workspaceId,
                canvasState: data.canvasState,
                expectedCanvasStateUpdatedAt: data.expectedCanvasStateUpdatedAt,
                expectedUpdatedAt: data.expectedUpdatedAt,
                persistViewport: data.persistViewport === true,
            })
        },
        [getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.DELETE_WORKSPACE)]: async (data: any) => {
            const userId = data.user.userId as string
            const workspaceId = data.workspaceId as string
            const workspace = await Workspace.getWorkspace({
                userId,
                workspaceId,
            })

            if ('error' in workspace)
                return workspace

            if (!workspace.accessList.some(entry => entry.userId === userId && entry.accessLevel === 'owner'))
                return { error: 'PERMISSION_DENIED' }

            await Workspace.markDeleting({ workspaceId })

            try {
                const removedMediaRequests = await new MediaGenerationRequestService().cleanupWorkspace(workspaceId)
                info(`Removed ${removedMediaRequests} media generation requests for ${workspaceId}`)
                const requester = await getAssetRequesterContext(userId)
                const removedAssetReferences = await AssetModel.removeAllWorkspaceReferences({
                    workspaceId,
                    requester,
                })
                info(`Removed ${removedAssetReferences} Asset references for ${workspaceId}`)
            } catch (error) {
                warn(`Workspace dependency cleanup failed for ${workspaceId}:`, error)

                return { error: 'WORKSPACE_DEPENDENCY_CLEANUP_FAILED' }
            }

            await Workspace.delete({
                userId,
                workspaceId,
            })

            return {
                success: true,
                workspaceId,
            }
        },
    },
)
