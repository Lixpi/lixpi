import {
    type AssetRequesterContext,
} from '@lixpi/constants'
import { canEditWorkspace } from './workspace-navigation/access.ts'

import Organization from '../models/organization.ts'
import { workspaceAccessResolver } from './workspace-tree.ts'

// Reads in progress, by user. Requests that arrive while one is running
// share it. Nothing is kept once it settles, so a revoked grant is never
// served from an earlier read.
const inFlight = new Map<string, Promise<AssetRequesterContext>>()

const readAssetRequesterContext = async (userId: string): Promise<AssetRequesterContext> => {
    const [workspaces, organizations] = await Promise.all([
        workspaceAccessResolver().listAccessibleWorkspaces(userId),
        Organization.getUserOrganizations({ userId }),
    ])

    return {
        userId,
        workspaceIds: workspaces.map(entry => entry.workspace.workspaceId),
        editableWorkspaceIds: workspaces.filter(entry => canEditWorkspace(entry.accessLevel)).map(entry => entry.workspace.workspaceId),
        organizationIds: organizations.map(organization => organization.organizationId),
    }
}

// A user reaches every workspace they hold a grant on and every workspace
// under it, with the inherited level deciding which ones they can edit.
export const getAssetRequesterContext = async (userId: string): Promise<AssetRequesterContext> => {
    let pending = inFlight.get(userId)

    if (!pending) {
        pending = (async () => {
            try {
                return await readAssetRequesterContext(userId)
            } finally {
                inFlight.delete(userId)
            }
        })()
        inFlight.set(userId, pending)
    }

    const context = await pending

    // Each caller gets its own copy, so one cannot change another's context.
    return {
        ...context,
        workspaceIds: [...context.workspaceIds],
        editableWorkspaceIds: [...context.editableWorkspaceIds],
        organizationIds: [...context.organizationIds],
    }
}
