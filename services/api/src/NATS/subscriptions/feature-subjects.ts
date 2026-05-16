'use strict'

import { err } from '@lixpi/debug-tools'
import NATS_Service from '@lixpi/nats-service'
import { NATS_SUBJECTS, type FeatureScope } from '@lixpi/constants'
import Feature from '../../models/feature.ts'

const { FEATURE_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

export const featureSubjects = [
    {
        subject: FEATURE_SUBJECTS.CREATE, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_SUBJECTS.CREATE] }, sub: { allow: [FEATURE_SUBJECTS.CREATE, FEATURE_SUBJECTS.EVENTS.CREATED] } },
        handler: async (data: any) => {
            const { user: { userId }, workspaceId, category, name, summary, tags, instructions, parameters, sampleImages, scope, sourceContext } = data
            const feature = await Feature.createFeature({ category, name, summary, tags: tags ?? [], instructions, parameters: parameters ?? {}, sampleImages: sampleImages ?? [], scope: scope ?? 'workspace', ownerUserId: userId, workspaceId, sourceContext })
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
            return await Feature.getFeature({ featureId, requesterContext: { userId, workspaceId, organizationId } })
        },
    },
    {
        subject: FEATURE_SUBJECTS.LIST_BY_SCOPE, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_SUBJECTS.LIST_BY_SCOPE] }, sub: { allow: [FEATURE_SUBJECTS.LIST_BY_SCOPE] } },
        handler: async (data: any) => {
            const { user: { userId }, workspaceId, organizationId, scope, scopeOwnerId, limit, lastKey } = data
            const resolvedScopeOwnerId = scopeOwnerId
                || (scope === 'user' ? userId : scope === 'organization' ? organizationId : scope === 'public' ? 'public' : workspaceId)
                || workspaceId
            return await Feature.listByScope({ scope: scope as FeatureScope, scopeOwnerId: resolvedScopeOwnerId, requesterContext: { userId, workspaceId, organizationId }, paging: limit ? { limit, lastKey } : undefined })
        },
    },
    {
        subject: FEATURE_SUBJECTS.UPDATE, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_SUBJECTS.UPDATE] }, sub: { allow: [FEATURE_SUBJECTS.UPDATE, FEATURE_SUBJECTS.EVENTS.UPDATED] } },
        handler: async (data: any) => {
            const { user: { userId }, featureId, updates } = data
            await Feature.updateFeature({ featureId, ownerUserId: userId, updates })
            return { success: true, featureId }
        },
    },
    {
        subject: FEATURE_SUBJECTS.DELETE, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_SUBJECTS.DELETE] }, sub: { allow: [FEATURE_SUBJECTS.DELETE, FEATURE_SUBJECTS.EVENTS.DELETED] } },
        handler: async (data: any) => {
            const { featureId } = data
            await Feature.deleteFeature({ featureId })
            NATS_Service.getInstance()?.publish(FEATURE_SUBJECTS.EVENTS.DELETED, { type: 'deleted', featureId })
            return { success: true, featureId }
        },
    },
    {
        subject: FEATURE_SUBJECTS.CHANGE_SCOPE, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_SUBJECTS.CHANGE_SCOPE] }, sub: { allow: [FEATURE_SUBJECTS.CHANGE_SCOPE] } },
        handler: async (data: any) => {
            const { featureId, newScope, newScopeOwnerId } = data
            await Feature.changeScope({ featureId, newScope: newScope as FeatureScope, newScopeOwnerId })
            NATS_Service.getInstance()?.publish(FEATURE_SUBJECTS.EVENTS.UPDATED, { type: 'scopeChanged', featureId, newScope })
            return { success: true, featureId, newScope }
        },
    },
    {
        subject: FEATURE_SUBJECTS.REPORT_ABUSE, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_SUBJECTS.REPORT_ABUSE] }, sub: { allow: [FEATURE_SUBJECTS.REPORT_ABUSE] } },
        handler: async (data: any) => {
            const { featureId } = data
            const { newStatus } = await Feature.incrementReportCount({ featureId })
            if (newStatus === 'reported') NATS_Service.getInstance()?.publish(FEATURE_SUBJECTS.EVENTS.UPDATED, { type: 'reported', featureId })
            return { success: true, featureId, status: newStatus }
        },
    },
]
