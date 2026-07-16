'use strict'

import * as process from 'process'
import { v4 as uuid } from 'uuid'

import {
    getDynamoDbTableStageName,
    type Feature,
    type FeatureMeta,
    type FeatureScope,
    type BlobRecord,
    type BlobReference,
} from '@lixpi/constants'
import BlobModel, { buildBlobReferenceBatchOperations } from './blob.ts'

const { ORG_NAME, STAGE } = process.env

const buildScopeAndOwnerKey = (scope: FeatureScope, scopeOwnerId: string): string =>
    `${scope}#${scopeOwnerId}`

const buildSampleKey = (featureId: string, sample: Feature['sampleImages'][number] | undefined): string | undefined =>
    sample?.blobHash

const getSampleUrl = (sample: Feature['sampleImages'][number] | undefined): string | undefined =>
    sample?.imageUrl

export type RequesterContext = {
    userId: string
    workspaceId?: string
    organizationId?: string
}

export const canRead = (userId: string, feature: Feature, workspaceId?: string, organizationId?: string): boolean => {
    // Features are org-wide: any member of the owning organization can read them.
    // 'shared' (external sharing) has no allow path yet — deferred to a future release.
    if (feature.scope === 'organization' && feature.scopeOwnerId === organizationId) return true
    return false
}

const FeatureModel = {
    createFeature: async (data: {
        featureId?: string
        category: string
        name: string
        summary: string
        tags: string[]
        instructions: string
        parameters: Record<string, any>
        sampleImages: Feature['sampleImages']
        ownerUserId: string
        workspaceId: string
        organizationId: string
        sourceContext: Feature['sourceContext']
    }): Promise<Feature | undefined> => {
        const now = Date.now()
        const featureId = data.featureId ?? uuid()
        // All features are org-scoped so they are accessible across every workspace in the org.
        const scope: FeatureScope = 'organization'
        const scopeOwnerId = data.organizationId

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
            const additions: Array<{ blob: BlobRecord; reference: BlobReference }> = []
            for (const sample of feature.sampleImages) {
                if (!sample.blobHash) throw new Error(`FEATURE_SAMPLE_BLOB_REQUIRED:${sample.idx}`)
                const blob = await BlobModel.get({ organizationId: scopeOwnerId, blobHash: sample.blobHash })
                if (!blob) throw new Error(`FEATURE_SAMPLE_BLOB_NOT_FOUND:${sample.blobHash}`)
                additions.push({
                    blob,
                    reference: {
                        blobKey: blob.blobKey,
                        blobHash: blob.blobHash,
                        organizationId: blob.organizationId,
                        referenceKey: `feature#${featureId}#sample#${sample.idx}`,
                        ownerType: 'feature',
                        ownerId: featureId,
                        createdAt: now,
                    },
                })
            }
            const blobReferenceOperations = buildBlobReferenceBatchOperations({ additions, now }).operations
            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'put',
                        tableName: getDynamoDbTableStageName('FEATURES', ORG_NAME, STAGE),
                        item: feature,
                    },
                    {
                        type: 'put',
                        tableName: getDynamoDbTableStageName('FEATURES_META', ORG_NAME, STAGE),
                        item: {
                            featureId, category: data.category, name: data.name, summary: data.summary,
                            tags: data.tags, scope, scopeOwnerId, status: 'active',
                            ownerUserId: data.ownerUserId,
                            scopeAndOwner: buildScopeAndOwnerKey(scope, scopeOwnerId),
                            sampleZeroKey: buildSampleKey(featureId, data.sampleImages[0]),
                            sampleZeroUrl: getSampleUrl(data.sampleImages[0]),
                            updatedAt: now,
                        } as FeatureMeta,
                    },
                    ...blobReferenceOperations,
                ],
                origin: 'Feature.createFeature',
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
        if (feature.status !== 'active') return { error: 'NOT_FOUND' }
        if (!canRead(requesterContext.userId, feature, requesterContext.workspaceId, requesterContext.organizationId)) return { error: 'PERMISSION_DENIED' }
        return feature
    },

    getOwnedFeature: async ({ featureId, ownerUserId }: { featureId: string; ownerUserId: string }): Promise<Feature | { error: string }> => {
        const item = await dynamoDBService.getItem({
            tableName: getDynamoDbTableStageName('FEATURES', ORG_NAME, STAGE),
            key: { featureId, version: 1 },
            origin: `Feature.getOwnedFeature(${featureId})`,
        })
        if (!item || Object.keys(item).length === 0) return { error: 'NOT_FOUND' }
        const feature = item as Feature
        if (feature.ownerUserId !== ownerUserId) return { error: 'PERMISSION_DENIED' }
        return feature
    },

    listByScope: async ({ scope, scopeOwnerId, requesterContext, paging }: {
        scope: FeatureScope; scopeOwnerId: string; requesterContext: RequesterContext
        paging?: { limit?: number; lastKey?: Record<string, any> }
    }): Promise<{ items: FeatureMeta[]; lastKey?: Record<string, any> }> => {
        // Meta partition query — the meta rows are projections, so this reads
        // fewer bytes than the main-table GSI it replaces. Recency ordering is
        // an in-memory sort over one org's features.
        const result = await dynamoDBService.queryItems({
            tableName: getDynamoDbTableStageName('FEATURES_META', ORG_NAME, STAGE),
            keyConditions: { scopeAndOwner: buildScopeAndOwnerKey(scope, scopeOwnerId) },
            fetchAllItems: true,
            origin: `Feature.listByScope(${scope})`,
        })
        const items = (result?.items || []) as FeatureMeta[]
        const visible = items
            .filter((f) => f.status === 'active' && canRead(requesterContext.userId, f as unknown as Feature, requesterContext.workspaceId, requesterContext.organizationId))
            .sort((left, right) => right.updatedAt - left.updatedAt)
        return {
            items: visible.map((f) => ({
                featureId: f.featureId, category: f.category, name: f.name, summary: f.summary,
                tags: f.tags, scope: f.scope, scopeOwnerId: f.scopeOwnerId, status: f.status,
                ownerUserId: f.ownerUserId,
                sampleZeroKey: f.sampleZeroKey,
                sampleZeroUrl: f.sampleZeroUrl,
                updatedAt: f.updatedAt,
            })),
        }
    },

    updateFeature: async ({ featureId, ownerUserId, updates }: {
        featureId: string; ownerUserId: string
        updates: Partial<Pick<Feature, 'summary' | 'tags' | 'instructions' | 'parameters'>>
    }): Promise<{ error: string } | undefined> => {
        const feature = await FeatureModel.getOwnedFeature({ featureId, ownerUserId })
        if ('error' in feature) return feature
        const now = Date.now()
        const metaUp: any = { updatedAt: now }
        if (updates.summary !== undefined) metaUp.summary = updates.summary
        if (updates.tags !== undefined) metaUp.tags = updates.tags
        await dynamoDBService.transactWrite({
            operations: [
                {
                    type: 'update',
                    tableName: getDynamoDbTableStageName('FEATURES', ORG_NAME, STAGE),
                    key: { featureId, version: 1 },
                    updates: { ...updates, updatedAt: now },
                },
                {
                    type: 'update',
                    tableName: getDynamoDbTableStageName('FEATURES_META', ORG_NAME, STAGE),
                    key: { scopeAndOwner: buildScopeAndOwnerKey(feature.scope, feature.scopeOwnerId), featureId },
                    updates: metaUp,
                },
            ],
            origin: 'Feature.updateFeature',
        })
    },

    deleteFeature: async ({ featureId }: { featureId: string }): Promise<void> => {
        // The meta row is addressed by scopeAndOwner — load the feature first
        // to obtain it. Missing feature means there is nothing to delete.
        const item = await dynamoDBService.getItem({
            tableName: getDynamoDbTableStageName('FEATURES', ORG_NAME, STAGE),
            key: { featureId, version: 1 },
            origin: `Feature.deleteFeature(${featureId})`,
        })
        if (!item || Object.keys(item).length === 0) return
        const feature = item as Feature
        if (feature.status !== 'removed') {
            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'update',
                        tableName: getDynamoDbTableStageName('FEATURES', ORG_NAME, STAGE),
                        key: { featureId, version: 1 },
                        updates: { status: 'removed', updatedAt: Date.now() },
                    },
                    {
                        type: 'update',
                        tableName: getDynamoDbTableStageName('FEATURES_META', ORG_NAME, STAGE),
                        key: { scopeAndOwner: buildScopeAndOwnerKey(feature.scope, feature.scopeOwnerId), featureId },
                        updates: { status: 'removed', updatedAt: Date.now() },
                    },
                ],
                origin: 'Feature.markRemoved',
            })
        }
        for (const sample of feature.sampleImages) {
            if (!sample.blobHash) continue
            const removal = await BlobModel.removeReference({
                organizationId: feature.scopeOwnerId,
                blobHash: sample.blobHash,
                referenceKey: `feature#${feature.featureId}#sample#${sample.idx}`,
            })
            if (removal.deletionRequired) {
                await BlobModel.deleteZeroReferenceBlob({
                    organizationId: feature.scopeOwnerId,
                    blobHash: sample.blobHash,
                })
            }
        }
        await dynamoDBService.transactWrite({
            operations: [
                {
                    type: 'delete',
                    tableName: getDynamoDbTableStageName('FEATURES', ORG_NAME, STAGE),
                    key: { featureId, version: 1 },
                },
                {
                    type: 'delete',
                    tableName: getDynamoDbTableStageName('FEATURES_META', ORG_NAME, STAGE),
                    key: { scopeAndOwner: buildScopeAndOwnerKey(feature.scope, feature.scopeOwnerId), featureId },
                },
            ],
            origin: 'Feature.deleteFeature',
        })
    },

}

export default FeatureModel
