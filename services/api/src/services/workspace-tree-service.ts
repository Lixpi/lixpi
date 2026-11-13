import {
    type CanvasState,
} from '@lixpi/constants'
import { info } from '@lixpi/debug-tools'
import { WorkspaceTreeService } from './workspace-navigation/workspace-tree-service.ts'

import AssetModel from '../models/asset.ts'
import Organization from '../models/organization.ts'
import { ConversationAdapters } from '../llm/agent/conversation-adapters.ts'
import { ConversationRepository } from '../llm/agent/conversation-repository.ts'
import { MediaGenerationRequestService } from './media-generation-request-service.ts'
import { createAssetRequesterForWorkspaceUser } from './workspace-reference-scope.ts'
import { workspaceTreeRepository } from './workspace-tree.ts'

const emptyCanvasState = (): CanvasState => ({
    viewport: {
        x: 0,
        y: 0,
        zoom: 1,
    },
    nodes: [],
    edges: [],
})

// Composes the workspace domain with the API's organizations, its
// conversation stop and its per-workspace content cleanup.
export const workspaceTreeService = (): WorkspaceTreeService =>
    new WorkspaceTreeService({
        repository: workspaceTreeRepository(),
        organizations: {
            getMembershipLevel: async (userId, organizationId) => {
                try {
                    return (await Organization.getSelfMembership({
                        organizationId,
                        userId,
                    })).accessLevel
                } catch {
                    return undefined
                }
            },
            getOrganization: async organizationId => await Organization.getOrganizationSummary(organizationId),
            listUserOrganizationIds: async userId => (await Organization.getUserOrganizations({ userId })).map(
                organization => organization.organizationId,
            ),
        },
        deletion: {
            stopConversations: async workspace => {
                const stopped = await new ConversationAdapters(
                    new ConversationRepository(),
                ).service().stopWorkspace(workspace.organizationId, workspace.workspaceId)
                info(`Stopped ${stopped} conversations for ${workspace.workspaceId}`)
            },
            // The delete already verified the user owns this workspace, and
            // the workspace is now marked as deleting, which the user's
            // general Asset scope leaves out. The cleanup acts as that owner
            // within this workspace only.
            cleanupWorkspace: async (workspace, userId) => {
                const removedMediaRequests = await new MediaGenerationRequestService().cleanupWorkspace(workspace.workspaceId)
                info(`Removed ${removedMediaRequests} media generation requests for ${workspace.workspaceId}`)
                const removedAssetReferences = await AssetModel.removeAllWorkspaceReferences({
                    workspaceId: workspace.workspaceId,
                    requester: createAssetRequesterForWorkspaceUser(
                        {
                            workspaceId: workspace.workspaceId,
                            organizationId: workspace.organizationId,
                            accessLevel: 'owner',
                        },
                        userId,
                        true,
                    ),
                })
                info(`Removed ${removedAssetReferences} Asset references for ${workspace.workspaceId}`)
            },
        },
        createWorkspaceContent: () => {
            const now = Date.now()

            return {
                canvasState: emptyCanvasState(),
                canvasStateUpdatedAt: now,
            }
        },
    })
