import { createNatsSubscriptions } from '../create-nats-subscriptions.ts'
import { getNatsSubjectPath } from '@lixpi/constants'
import { createWorkspaceTreeHandlers } from '../../services/workspace-navigation/workspace-tree-handlers.ts'
import { canEditWorkspace } from '../../services/workspace-navigation/access.ts'

import Organization from '../../models/organization.ts'
import Workspace from '../../models/workspace.ts'
import { workspaceTreeService } from '../../services/workspace-tree-service.ts'

const treeHandlers = createWorkspaceTreeHandlers(workspaceTreeService)
const createWorkspacePath = getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.CREATE_WORKSPACE)

// The workspace tree subjects (the user's tree, create, rename and annotate,
// move, headings and subtree delete) come from the API workspace domain.
// The API keeps reading a workspace and saving its canvas, and fills in the
// user's first organization when a create request names none.
export const workspaceSubjects = createNatsSubscriptions(
    'workspace',
    {
        ...treeHandlers,
        [createWorkspacePath]: async (data: any) => {
            if (
                data.organizationId
                || !data.user?.userId
            )
                return await treeHandlers[createWorkspacePath](data)

            const [organization] = await Organization.getUserOrganizations({ userId: data.user.userId })

            if (!organization)
                return { error: 'ORGANIZATION_ACCESS_DENIED' }

            return await treeHandlers[createWorkspacePath]({
                ...data,
                organizationId: organization.organizationId,
            })
        },
        [getNatsSubjectPath(subjects => subjects.WORKSPACE_SUBJECTS.GET_WORKSPACE)]: async (data: any) => {
            const workspace = await Workspace.getWorkspace({
                workspaceId: data.workspaceId,
                userId: data.user.userId,
            })

            return workspace
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

            if (!canEditWorkspace(workspace.accessLevel))
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
    },
)
