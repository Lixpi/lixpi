import {
    type AccessLevel,
    type Asset,
    type AssetRequesterContext,
    type Workspace,
} from '@lixpi/constants'
import { canEditWorkspace } from './workspace-navigation/access.ts'

type WorkspaceScope = Pick<Workspace, 'workspaceId' | 'organizationId'>
// A workspace with the requesting user's effective access level.
type AuthorizedWorkspaceScope = Pick<Workspace, 'workspaceId' | 'organizationId'> & {
    accessLevel?: AccessLevel
}
type WorkspaceScopedAssetIdentity = Pick<Asset, 'organizationId' | 'scope' | 'scopeOwnerId'>

export const scopeAssetRequesterToWorkspace = (
    requester: AssetRequesterContext,
    workspace: WorkspaceScope,
): AssetRequesterContext => ({
    userId: requester.userId,
    workspaceIds: requester.workspaceIds.includes(workspace.workspaceId)
        ? [workspace.workspaceId]
        : [],
    editableWorkspaceIds: requester.editableWorkspaceIds.includes(workspace.workspaceId)
        ? [workspace.workspaceId]
        : [],
    organizationIds: requester.organizationIds.includes(workspace.organizationId)
        ? [workspace.organizationId]
        : [],
})

export const requesterHasWorkspaceScope = (
    requester: AssetRequesterContext,
    workspace: WorkspaceScope,
): boolean => requester.workspaceIds.includes(workspace.workspaceId)
    && requester.organizationIds.includes(workspace.organizationId)

export const createAssetRequesterForWorkspaceUser = (
    workspace: AuthorizedWorkspaceScope,
    userId: string,
    hasOrganizationAccess: boolean,
): AssetRequesterContext => {
    if (
        !workspace.accessLevel
        || !hasOrganizationAccess
    )
        return {
            userId,
            workspaceIds: [],
            editableWorkspaceIds: [],
            organizationIds: [],
        }

    return {
        userId,
        workspaceIds: [workspace.workspaceId],
        editableWorkspaceIds: canEditWorkspace(workspace.accessLevel)
            ? [workspace.workspaceId]
            : [],
        organizationIds: [workspace.organizationId],
    }
}

export const isAssetAvailableInWorkspaceScope = (
    asset: WorkspaceScopedAssetIdentity,
    workspace: WorkspaceScope,
): boolean =>
    asset.organizationId === workspace.organizationId
        && (asset.scope !== 'workspace' || asset.scopeOwnerId === workspace.workspaceId)
        && (asset.scope !== 'organization' || asset.scopeOwnerId === workspace.organizationId)
