'use strict'

import NATS_Service from '@lixpi/nats-service'
import { NATS_SUBJECTS, type FeatureScope } from '@lixpi/constants'
import Feature, { type RequesterContext } from '../../models/feature.ts'
import Organization from '../../models/organization.ts'
import Workspace from '../../models/workspace.ts'

const { FEATURE_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS
const VALID_SCOPES: FeatureScope[] = ['organization', 'shared']

const verifyWorkspaceAccess = async (userId: string, workspaceId: string): Promise<boolean> => {
    const workspace = await Workspace.getWorkspace({ userId, workspaceId })
    return !('error' in workspace)
}

// The owning organization is resolved server-side from the authenticated user — the
// client has no active-org concept wired up, and workspaces carry no org link. Both the
// write path (extraction) and the read paths (list/get/delete) MUST resolve the same way
// or features scoped on write won't be found on read. See resolveUserOrganizationId in
// extraction-subjects.ts which mirrors this.
export const resolveUserOrganizationId = async (userId: string): Promise<string | undefined> => {
    const organizations = await Organization.getUserOrganizations({ userId })
    return organizations[0]?.organizationId
}

const getRequesterContext = async ({
    userId,
    workspaceId,
}: {
    userId: string
    workspaceId?: string
}): Promise<RequesterContext> => ({
    userId,
    workspaceId: workspaceId && await verifyWorkspaceAccess(userId, workspaceId) ? workspaceId : undefined,
    organizationId: await resolveUserOrganizationId(userId),
})

const getTargetScopeOwnerId = async ({
    userId,
    scope,
}: {
    userId: string
    scope: FeatureScope
}): Promise<string | { error: string }> => {
    // 'shared' (external sharing) is reserved for a future release — no path yet.
    if (scope !== 'organization') return { error: 'SCOPE_NOT_AVAILABLE' }
    const organizationId = await resolveUserOrganizationId(userId)
    if (!organizationId) return { error: 'ORGANIZATION_ACCESS_DENIED' }
    return organizationId
}

export const featureSubjects = [
    {
        subject: FEATURE_SUBJECTS.CREATE, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_SUBJECTS.CREATE] }, sub: { allow: [FEATURE_SUBJECTS.CREATE] } },
        handler: async (data: any) => {
            const { user: { userId }, workspaceId, category, name, summary, tags, instructions, parameters, sampleImages, sourceContext } = data
            if (!workspaceId || !(await verifyWorkspaceAccess(userId, workspaceId))) {
                return { error: 'WORKSPACE_ACCESS_DENIED' }
            }
            const organizationId = await resolveUserOrganizationId(userId)
            if (!organizationId) {
                return { error: 'ORGANIZATION_ACCESS_DENIED' }
            }
            const feature = await Feature.createFeature({ category, name, summary, tags: tags ?? [], instructions, parameters: parameters ?? {}, sampleImages: sampleImages ?? [], ownerUserId: userId, workspaceId, organizationId, sourceContext })
            if (!feature) return { error: 'FAILED_TO_CREATE' }
            NATS_Service.getInstance()?.publish(FEATURE_SUBJECTS.EVENTS.CREATED, { type: 'created', feature })
            return feature
        },
    },
    {
        subject: FEATURE_SUBJECTS.GET, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_SUBJECTS.GET] }, sub: { allow: [FEATURE_SUBJECTS.GET] } },
        handler: async (data: any) => {
            const { user: { userId }, workspaceId, featureId } = data
            return Feature.getFeature({
                featureId,
                requesterContext: await getRequesterContext({ userId, workspaceId }),
            })
        },
    },
    {
        subject: FEATURE_SUBJECTS.LIST_BY_SCOPE, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_SUBJECTS.LIST_BY_SCOPE] }, sub: { allow: [FEATURE_SUBJECTS.LIST_BY_SCOPE] } },
        handler: async (data: any) => {
            const { user: { userId }, workspaceId, scope, limit, lastKey } = data
            if (!VALID_SCOPES.includes(scope as FeatureScope)) return { items: [] }
            const typedScope = scope as FeatureScope
            const scopeOwnerId = await getTargetScopeOwnerId({ userId, scope: typedScope })
            if (typeof scopeOwnerId !== 'string') return { items: [] }
            return Feature.listByScope({
                scope: typedScope,
                scopeOwnerId,
                requesterContext: await getRequesterContext({ userId, workspaceId }),
                paging: limit ? { limit, lastKey } : undefined,
            })
        },
    },
    {
        subject: FEATURE_SUBJECTS.UPDATE, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_SUBJECTS.UPDATE] }, sub: { allow: [FEATURE_SUBJECTS.UPDATE] } },
        handler: async (data: any) => {
            const { user: { userId }, featureId, updates } = data
            const result = await Feature.updateFeature({ featureId, ownerUserId: userId, updates })
            if (result) return result
            NATS_Service.getInstance()?.publish(FEATURE_SUBJECTS.EVENTS.UPDATED, { type: 'updated', featureId })
            return { success: true, featureId }
        },
    },
    {
        subject: FEATURE_SUBJECTS.DELETE, type: 'reply', payloadType: 'json',
        permissions: {
            pub: { allow: [FEATURE_SUBJECTS.DELETE] },
            sub: {
                allow: [
                    FEATURE_SUBJECTS.DELETE,
                    FEATURE_SUBJECTS.EVENTS.CREATED,
                    FEATURE_SUBJECTS.EVENTS.UPDATED,
                    FEATURE_SUBJECTS.EVENTS.DELETED,
                ],
            },
        },
        handler: async (data: any) => {
            const { user: { userId }, workspaceId, featureId } = data
            // Features are org-wide: any member of the owning org can delete them.
            const feature = await Feature.getFeature({
                featureId,
                requesterContext: await getRequesterContext({ userId, workspaceId }),
            })
            if ('error' in feature) return feature
            await Feature.deleteFeature({ featureId })
            NATS_Service.getInstance()?.publish(FEATURE_SUBJECTS.EVENTS.DELETED, { type: 'deleted', featureId })
            return { success: true, featureId }
        },
    },
]
