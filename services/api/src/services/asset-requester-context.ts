import {
    type AssetRequesterContext,
} from '@lixpi/constants'

import Organization from '../models/organization.ts'
import Workspace from '../models/workspace.ts'

export const getAssetRequesterContext = async (userId: string): Promise<AssetRequesterContext> => {
    const [workspaces, organizations] = await Promise.all([
        Workspace.getUserWorkspaces({ userId }),
        Organization.getUserOrganizations({ userId }),
    ])
    const workspaceRecords = await Promise.all(workspaces.map(async (workspace) => await Workspace.getWorkspace({ userId, workspaceId: workspace.workspaceId })))
    const editableWorkspaceIds = workspaceRecords.flatMap((workspace) => {
        if ('error' in workspace) return []
        const canEdit = workspace.accessList?.some((entry) => entry.userId === userId && (entry.accessLevel === 'owner' || entry.accessLevel === 'editor'))
        return canEdit ? [workspace.workspaceId] : []
    })
    return {
        userId,
        workspaceIds: workspaces.map((workspace) => workspace.workspaceId),
        editableWorkspaceIds,
        organizationIds: organizations.map((organization) => organization.organizationId),
    }
}
