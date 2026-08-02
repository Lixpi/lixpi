'use strict'

import type {
    Asset,
    AssetRequesterContext,
    Workspace,
} from '@lixpi/constants'

type WorkspaceScope = Pick<Workspace, 'workspaceId' | 'organizationId'>
type AuthorizedWorkspaceScope = Pick<Workspace, 'workspaceId' | 'organizationId' | 'accessList'>
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
    const access = workspace.accessList.find((entry) => entry.userId === userId)
    if (!access || !hasOrganizationAccess) {
        return { userId, workspaceIds: [], editableWorkspaceIds: [], organizationIds: [] }
    }
    return {
        userId,
        workspaceIds: [workspace.workspaceId],
        editableWorkspaceIds: access.accessLevel === 'owner' || access.accessLevel === 'editor'
            ? [workspace.workspaceId]
            : [],
        organizationIds: [workspace.organizationId],
    }
}

export const isAssetAvailableInWorkspaceScope = (
    asset: WorkspaceScopedAssetIdentity,
    workspace: WorkspaceScope,
): boolean => asset.organizationId === workspace.organizationId
    && (asset.scope !== 'workspace' || asset.scopeOwnerId === workspace.workspaceId)
    && (asset.scope !== 'organization' || asset.scopeOwnerId === workspace.organizationId)
