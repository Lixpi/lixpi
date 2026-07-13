'use strict'

import { NATS_SUBJECTS, type FeatureScope } from '@lixpi/constants'
import Feature, { type RequesterContext } from '../../models/feature.ts'
import Workspace from '../../models/workspace.ts'

const { FEATURE_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS
const VALID_SCOPES: FeatureScope[] = ['organization', 'shared']

const verifyWorkspaceAccess = async (userId: string, workspaceId: string): Promise<boolean> => {
    const workspace = await Workspace.getWorkspace({ userId, workspaceId })
    return !('error' in workspace)
}

const verifyWorkspaceEditAccess = async (userId: string, workspaceId: string): Promise<boolean> => {
    const workspace = await Workspace.getWorkspace({ userId, workspaceId })
    return !('error' in workspace)
        && !workspace.deletingAt
        && workspace.accessList.some((entry) => entry.userId === userId && (entry.accessLevel === 'owner' || entry.accessLevel === 'editor'))
}

export const resolveWorkspaceOrganizationId = async (userId: string, workspaceId?: string): Promise<string | undefined> => {
    if (!workspaceId) return undefined
    const workspace = await Workspace.getWorkspace({ userId, workspaceId })
    return 'error' in workspace ? undefined : workspace.organizationId
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
    organizationId: await resolveWorkspaceOrganizationId(userId, workspaceId),
})

const getTargetScopeOwnerId = async ({
    userId,
    workspaceId,
    scope,
}: {
    userId: string
    workspaceId?: string
    scope: FeatureScope
}): Promise<string | { error: string }> => {
    // 'shared' (external sharing) is reserved for a future release — no path yet.
    if (scope !== 'organization') return { error: 'SCOPE_NOT_AVAILABLE' }
    const organizationId = await resolveWorkspaceOrganizationId(userId, workspaceId)
    if (!organizationId) return { error: 'ORGANIZATION_ACCESS_DENIED' }
    return organizationId
}

export const featureSubjects = [
    {
        subject: FEATURE_SUBJECTS.CREATE, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_SUBJECTS.CREATE] }, sub: { allow: [] } },
        handler: async (data: any) => {
            const { user: { userId }, workspaceId, category, name, summary, tags, instructions, parameters, sampleImages, sourceContext } = data
            if (!workspaceId || !(await verifyWorkspaceEditAccess(userId, workspaceId))) {
                return { error: 'WORKSPACE_ACCESS_DENIED' }
            }
            const organizationId = await resolveWorkspaceOrganizationId(userId, workspaceId)
            if (!organizationId) {
                return { error: 'ORGANIZATION_ACCESS_DENIED' }
            }
            if (Array.isArray(sampleImages) && sampleImages.length > 0) {
                return { error: 'FEATURE_SAMPLE_CREATION_IS_API_OWNED' }
            }
            const feature = await Feature.createFeature({ category, name, summary, tags: tags ?? [], instructions, parameters: parameters ?? {}, sampleImages: sampleImages ?? [], ownerUserId: userId, workspaceId, organizationId, sourceContext })
            if (!feature) return { error: 'FAILED_TO_CREATE' }
            return feature
        },
    },
    {
        subject: FEATURE_SUBJECTS.GET, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_SUBJECTS.GET] }, sub: { allow: [] } },
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
        permissions: { pub: { allow: [FEATURE_SUBJECTS.LIST_BY_SCOPE] }, sub: { allow: [] } },
        handler: async (data: any) => {
            const { user: { userId }, workspaceId, scope, limit, lastKey } = data
            if (!VALID_SCOPES.includes(scope as FeatureScope)) return { items: [] }
            const typedScope = scope as FeatureScope
            const scopeOwnerId = await getTargetScopeOwnerId({ userId, workspaceId, scope: typedScope })
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
        permissions: { pub: { allow: [FEATURE_SUBJECTS.UPDATE] }, sub: { allow: [] } },
        handler: async (data: any) => {
            const { user: { userId }, featureId, updates } = data
            const allowedUpdates = Object.fromEntries(
                Object.entries(updates ?? {}).filter(([key]) => ['summary', 'tags', 'instructions', 'parameters'].includes(key)),
            ) as Parameters<typeof Feature.updateFeature>[0]['updates']
            const result = await Feature.updateFeature({ featureId, ownerUserId: userId, updates: allowedUpdates })
            if (result) return result
            return { success: true, featureId }
        },
    },
    {
        subject: FEATURE_SUBJECTS.DELETE, type: 'reply', payloadType: 'json',
        permissions: {
            pub: { allow: [FEATURE_SUBJECTS.DELETE] },
            sub: { allow: [] },
        },
        handler: async (data: any) => {
            const { user: { userId }, workspaceId, featureId } = data
            if (!workspaceId || !(await verifyWorkspaceAccess(userId, workspaceId))) return { error: 'WORKSPACE_ACCESS_DENIED' }
            const feature = await Feature.getOwnedFeature({ featureId, ownerUserId: userId })
            if ('error' in feature) return feature
            const organizationId = await resolveWorkspaceOrganizationId(userId, workspaceId)
            if (feature.scopeOwnerId !== organizationId) return { error: 'ORGANIZATION_ACCESS_DENIED' }
            await Feature.deleteFeature({ featureId })
            return { success: true, featureId }
        },
    },
]
