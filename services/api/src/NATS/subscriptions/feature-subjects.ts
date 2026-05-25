'use strict'

import NATS_Service from '@lixpi/nats-service'
import { NATS_SUBJECTS, type FeatureScope } from '@lixpi/constants'
import Feature, { type RequesterContext } from '../../models/feature.ts'
import Organization from '../../models/organization.ts'
import Workspace from '../../models/workspace.ts'
import { ensureFeatureSamplesForScope } from '../../services/feature-sample-storage.ts'

const { FEATURE_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS
const VALID_SCOPES: FeatureScope[] = ['workspace', 'user', 'organization', 'public']

const verifyWorkspaceAccess = async (userId: string, workspaceId: string): Promise<boolean> => {
    const workspace = await Workspace.getWorkspace({ userId, workspaceId })
    return !('error' in workspace)
}

const verifyOrganizationAccess = async (userId: string, organizationId: string): Promise<boolean> => {
    const organization = await Organization.getOrganization({ userId, organizationId })
    return !('error' in organization)
}

const getRequesterContext = async ({
    userId,
    workspaceId,
    organizationId,
}: {
    userId: string
    workspaceId?: string
    organizationId?: string
}): Promise<RequesterContext> => ({
    userId,
    workspaceId: workspaceId && await verifyWorkspaceAccess(userId, workspaceId) ? workspaceId : undefined,
    organizationId: organizationId && await verifyOrganizationAccess(userId, organizationId) ? organizationId : undefined,
})

const getTargetScopeOwnerId = async ({
    userId,
    workspaceId,
    organizationId,
    scope,
}: {
    userId: string
    workspaceId?: string
    organizationId?: string
    scope: FeatureScope
}): Promise<string | { error: string }> => {
    if (scope === 'user') return userId
    if (scope === 'public') return 'public'
    if (scope === 'workspace') {
        if (!workspaceId || !(await verifyWorkspaceAccess(userId, workspaceId))) {
            return { error: 'WORKSPACE_ACCESS_DENIED' }
        }
        return workspaceId
    }
    if (!organizationId || !(await verifyOrganizationAccess(userId, organizationId))) {
        return { error: 'ORGANIZATION_ACCESS_DENIED' }
    }
    return organizationId
}

export const featureSubjects = [
    {
        subject: FEATURE_SUBJECTS.CREATE, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_SUBJECTS.CREATE] }, sub: { allow: [FEATURE_SUBJECTS.CREATE, FEATURE_SUBJECTS.EVENTS.CREATED] } },
        handler: async (data: any) => {
            const { user: { userId }, workspaceId, category, name, summary, tags, instructions, parameters, sampleImages, sourceContext } = data
            if (!workspaceId || !(await verifyWorkspaceAccess(userId, workspaceId))) {
                return { error: 'WORKSPACE_ACCESS_DENIED' }
            }
            const feature = await Feature.createFeature({ category, name, summary, tags: tags ?? [], instructions, parameters: parameters ?? {}, sampleImages: sampleImages ?? [], scope: 'workspace', ownerUserId: userId, workspaceId, sourceContext })
            if (!feature) return { error: 'FAILED_TO_CREATE' }
            NATS_Service.getInstance()?.publish(FEATURE_SUBJECTS.EVENTS.CREATED, { type: 'created', feature })
            return feature
        },
    },
    {
        subject: FEATURE_SUBJECTS.GET, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_SUBJECTS.GET] }, sub: { allow: [FEATURE_SUBJECTS.GET] } },
        handler: async (data: any) => {
            const { user: { userId }, workspaceId, organizationId, featureId } = data
            return Feature.getFeature({
                featureId,
                requesterContext: await getRequesterContext({ userId, workspaceId, organizationId }),
            })
        },
    },
    {
        subject: FEATURE_SUBJECTS.LIST_BY_SCOPE, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_SUBJECTS.LIST_BY_SCOPE] }, sub: { allow: [FEATURE_SUBJECTS.LIST_BY_SCOPE] } },
        handler: async (data: any) => {
            const { user: { userId }, workspaceId, organizationId, scope, limit, lastKey } = data
            if (!VALID_SCOPES.includes(scope as FeatureScope)) return { items: [] }
            const typedScope = scope as FeatureScope
            const scopeOwnerId = await getTargetScopeOwnerId({ userId, workspaceId, organizationId, scope: typedScope })
            if (typeof scopeOwnerId !== 'string') return { items: [] }
            return Feature.listByScope({
                scope: typedScope,
                scopeOwnerId,
                requesterContext: await getRequesterContext({ userId, workspaceId, organizationId }),
                paging: limit ? { limit, lastKey } : undefined,
            })
        },
    },
    {
        subject: FEATURE_SUBJECTS.UPDATE, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_SUBJECTS.UPDATE] }, sub: { allow: [FEATURE_SUBJECTS.UPDATE, FEATURE_SUBJECTS.EVENTS.UPDATED] } },
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
        permissions: { pub: { allow: [FEATURE_SUBJECTS.DELETE] }, sub: { allow: [FEATURE_SUBJECTS.DELETE, FEATURE_SUBJECTS.EVENTS.DELETED] } },
        handler: async (data: any) => {
            const { user: { userId }, featureId } = data
            const feature = await Feature.getOwnedFeature({ featureId, ownerUserId: userId })
            if ('error' in feature) return feature
            await Feature.deleteFeature({ featureId })
            NATS_Service.getInstance()?.publish(FEATURE_SUBJECTS.EVENTS.DELETED, { type: 'deleted', featureId })
            return { success: true, featureId }
        },
    },
    {
        subject: FEATURE_SUBJECTS.CHANGE_SCOPE, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_SUBJECTS.CHANGE_SCOPE] }, sub: { allow: [FEATURE_SUBJECTS.CHANGE_SCOPE, FEATURE_SUBJECTS.EVENTS.UPDATED] } },
        handler: async (data: any) => {
            const { user: { userId }, featureId, newScope, workspaceId, organizationId } = data
            if (!VALID_SCOPES.includes(newScope as FeatureScope)) return { error: 'INVALID_SCOPE' }
            const feature = await Feature.getOwnedFeature({ featureId, ownerUserId: userId })
            if ('error' in feature) return feature
            const typedScope = newScope as FeatureScope
            const newScopeOwnerId = await getTargetScopeOwnerId({ userId, workspaceId, organizationId, scope: typedScope })
            if (typeof newScopeOwnerId !== 'string') return newScopeOwnerId
            try {
                await ensureFeatureSamplesForScope({ feature, newScope: typedScope, newScopeOwnerId })
            } catch {
                return { error: 'SAMPLE_COPY_FAILED' }
            }
            const updatedFeature = await Feature.changeScope({ feature, newScope: typedScope, newScopeOwnerId })
            NATS_Service.getInstance()?.publish(FEATURE_SUBJECTS.EVENTS.UPDATED, { type: 'scopeChanged', featureId, newScope: typedScope, feature: updatedFeature })
            return { success: true, featureId, newScope: typedScope, newScopeOwnerId }
        },
    },
    {
        subject: FEATURE_SUBJECTS.REPORT_ABUSE, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_SUBJECTS.REPORT_ABUSE] }, sub: { allow: [FEATURE_SUBJECTS.REPORT_ABUSE, FEATURE_SUBJECTS.EVENTS.UPDATED] } },
        handler: async (data: any) => {
            const { user: { userId }, featureId } = data
            const feature = await Feature.getFeature({ featureId, requesterContext: { userId } })
            if ('error' in feature || feature.scope !== 'public') return { error: 'PERMISSION_DENIED' }
            const { newStatus } = await Feature.incrementReportCount({ featureId })
            if (newStatus === 'reported') NATS_Service.getInstance()?.publish(FEATURE_SUBJECTS.EVENTS.UPDATED, { type: 'reported', featureId })
            return { success: true, featureId, status: newStatus }
        },
    },
]
