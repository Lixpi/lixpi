'use strict'

import * as process from 'process'
import { v4 as uuid } from 'uuid'

import {
    getDynamoDbTableStageName,
    type Feature,
    type FeatureMeta,
    type FeatureScope,
    type FeatureStatus,
} from '@lixpi/constants'

const { ORG_NAME, STAGE } = process.env

const REPORT_THRESHOLD = 5

const buildScopeAndOwnerKey = (scope: FeatureScope, scopeOwnerId: string): string =>
    `${scope}#${scopeOwnerId}`

const buildSampleKey = (featureId: string, sample: Feature['sampleImages'][number] | undefined): string | undefined =>
    sample ? sample.fileId ?? `features/${featureId}/sample-${sample.idx}.${sample.ext}` : undefined

const getSampleUrl = (sample: Feature['sampleImages'][number] | undefined): string | undefined =>
    sample?.imageUrl

export type RequesterContext = {
    userId: string
    workspaceId?: string
    organizationId?: string
}

export const canRead = (userId: string, feature: Feature, workspaceId?: string, organizationId?: string): boolean => {
    if (feature.ownerUserId === userId) return true
    if (feature.scope === 'public' && feature.status === 'active') return true
    if (feature.scope === 'workspace' && feature.workspaceId === workspaceId) return true
    if (feature.scope === 'user' && feature.ownerUserId === userId) return true
    if (feature.scope === 'organization' && feature.scopeOwnerId === organizationId) return true
    return false
}

export default {
    createFeature: async (data: {
        featureId?: string
        category: string
        name: string
        summary: string
        tags: string[]
        instructions: string
        parameters: Record<string, any>
        sampleImages: Feature['sampleImages']
        scope: FeatureScope
        ownerUserId: string
        workspaceId: string
        sourceContext: Feature['sourceContext']
    }): Promise<Feature | undefined> => {
        const now = Date.now()
        const featureId = data.featureId ?? uuid()
        const scope: FeatureScope = data.scope
        const scopeOwnerId = scope === 'workspace' ? data.workspaceId
            : scope === 'user' ? data.ownerUserId
            : scope === 'public' ? 'public'
            : 'org-placeholder'

        const feature: Feature & { scopeAndOwner: string } = {
            featureId, version: 1,
            category: data.category, name: data.name, summary: data.summary,
            tags: data.tags, instructions: data.instructions, parameters: data.parameters,
            sampleImages: data.sampleImages, scope, scopeOwnerId,
            scopeAndOwner: buildScopeAndOwnerKey(scope, scopeOwnerId),
            status: 'active', ownerUserId: data.ownerUserId, workspaceId: data.workspaceId,
            sourceContext: data.sourceContext, reportCount: 0, createdAt: now, updatedAt: now,
        }

        try {
            await dynamoDBService.putItem({
                tableName: getDynamoDbTableStageName('FEATURES', ORG_NAME, STAGE),
                item: feature, origin: 'Feature.createFeature',
            })
            await dynamoDBService.putItem({
                tableName: getDynamoDbTableStageName('FEATURES_META', ORG_NAME, STAGE),
                item: {
                    featureId, category: data.category, name: data.name, summary: data.summary,
                    tags: data.tags, scope, scopeOwnerId, status: 'active',
                    ownerUserId: data.ownerUserId,
                    sampleZeroKey: buildSampleKey(featureId, data.sampleImages[0]),
                    sampleZeroUrl: getSampleUrl(data.sampleImages[0]),
                    updatedAt: now,
                } as FeatureMeta,
                origin: 'Feature.createFeature:meta',
            })
            return feature
        } catch (error) {
            console.error('Failed to create feature:', error)
        }
    },

    getFeature: async ({ featureId, requesterContext }: { featureId: string; requesterContext: RequesterContext }): Promise<Feature | { error: string }> => {
        const item = await dynamoDBService.getItem({
            tableName: getDynamoDbTableStageName('FEATURES', ORG_NAME, STAGE),
            key: { featureId, version: 1 },
            origin: `Feature.getFeature(${featureId})`,
        })
        if (!item || Object.keys(item).length === 0) return { error: 'NOT_FOUND' }
        const feature = item as Feature
        if (!canRead(requesterContext.userId, feature, requesterContext.workspaceId, requesterContext.organizationId)) return { error: 'PERMISSION_DENIED' }
        return feature
    },

    listByScope: async ({ scope, scopeOwnerId, requesterContext, paging }: {
        scope: FeatureScope; scopeOwnerId: string; requesterContext: RequesterContext
        paging?: { limit?: number; lastKey?: Record<string, any> }
    }): Promise<{ items: FeatureMeta[]; lastKey?: Record<string, any> }> => {
        const gsiKey = buildScopeAndOwnerKey(scope, scopeOwnerId)
        const result = await dynamoDBService.queryItems({
            tableName: getDynamoDbTableStageName('FEATURES', ORG_NAME, STAGE),
            indexName: 'byScopeAndOwner', keyConditions: { scopeAndOwner: gsiKey },
            fetchAllItems: !paging?.limit, limit: paging?.limit,
            exclusiveStartKey: paging?.lastKey, scanIndexForward: false,
            origin: `Feature.listByScope(${scope})`,
        })
        const items = (result?.items || []) as (Feature & { scopeAndOwner: string })[]
        const visible = items.filter((f) => f.status === 'active' && canRead(requesterContext.userId, f, requesterContext.workspaceId, requesterContext.organizationId))
        return {
            items: visible.map((f) => ({
                featureId: f.featureId, category: f.category, name: f.name, summary: f.summary,
                tags: f.tags, scope: f.scope, scopeOwnerId: f.scopeOwnerId, status: f.status,
                ownerUserId: f.ownerUserId,
                sampleZeroKey: buildSampleKey(f.featureId, f.sampleImages[0]),
                sampleZeroUrl: getSampleUrl(f.sampleImages[0]),
                updatedAt: f.updatedAt,
            })),
            lastKey: result?.lastKey,
        }
    },

    updateFeature: async ({ featureId, ownerUserId, updates }: {
        featureId: string; ownerUserId: string
        updates: Partial<Pick<Feature, 'summary' | 'tags' | 'instructions' | 'parameters' | 'sampleImages'>>
    }): Promise<void> => {
        const now = Date.now()
        await dynamoDBService.updateItem({ tableName: getDynamoDbTableStageName('FEATURES', ORG_NAME, STAGE), key: { featureId, version: 1 }, updates: { ...updates, updatedAt: now }, origin: 'Feature.updateFeature' })
        const metaUp: any = { updatedAt: now }
        if (updates.summary !== undefined) metaUp.summary = updates.summary
        if (updates.tags !== undefined) metaUp.tags = updates.tags
        await dynamoDBService.updateItem({ tableName: getDynamoDbTableStageName('FEATURES_META', ORG_NAME, STAGE), key: { featureId }, updates: metaUp, origin: 'Feature.updateFeature:meta' })
    },

    deleteFeature: async ({ featureId }: { featureId: string }): Promise<void> => {
        await dynamoDBService.deleteItems({ tableName: getDynamoDbTableStageName('FEATURES', ORG_NAME, STAGE), key: { featureId, version: 1 }, origin: 'Feature.deleteFeature' })
        await dynamoDBService.deleteItems({ tableName: getDynamoDbTableStageName('FEATURES_META', ORG_NAME, STAGE), key: { featureId }, origin: 'Feature.deleteFeature:meta' })
    },

    changeScope: async ({ featureId, newScope, newScopeOwnerId }: { featureId: string; newScope: FeatureScope; newScopeOwnerId: string }): Promise<void> => {
        const now = Date.now()
        const gsiKey = buildScopeAndOwnerKey(newScope, newScopeOwnerId)
        await dynamoDBService.updateItem({ tableName: getDynamoDbTableStageName('FEATURES', ORG_NAME, STAGE), key: { featureId, version: 1 }, updates: { scope: newScope, scopeOwnerId: newScopeOwnerId, scopeAndOwner: gsiKey, updatedAt: now }, origin: 'Feature.changeScope' })
        await dynamoDBService.updateItem({ tableName: getDynamoDbTableStageName('FEATURES_META', ORG_NAME, STAGE), key: { featureId }, updates: { scope: newScope, scopeOwnerId: newScopeOwnerId, updatedAt: now }, origin: 'Feature.changeScope:meta' })
    },

    incrementReportCount: async ({ featureId }: { featureId: string }): Promise<{ newStatus: FeatureStatus }> => {
        const item = await dynamoDBService.getItem({ tableName: getDynamoDbTableStageName('FEATURES', ORG_NAME, STAGE), key: { featureId, version: 1 }, origin: 'Feature.incrementReportCount:get' })
        if (!item) return { newStatus: 'active' }
        const count = (item.reportCount ?? 0) + 1
        const newStatus: FeatureStatus = count >= REPORT_THRESHOLD ? 'reported' : 'active'
        const now = Date.now()
        await dynamoDBService.updateItem({ tableName: getDynamoDbTableStageName('FEATURES', ORG_NAME, STAGE), key: { featureId, version: 1 }, updates: { reportCount: count, status: newStatus, updatedAt: now }, origin: 'Feature.incrementReportCount' })
        if (newStatus === 'reported') await dynamoDBService.updateItem({ tableName: getDynamoDbTableStageName('FEATURES_META', ORG_NAME, STAGE), key: { featureId }, updates: { status: newStatus, updatedAt: now }, origin: 'Feature.incrementReportCount:meta' })
        return { newStatus }
    },
}
