'use strict'

import * as process from 'node:process'

import {
    DEFAULT_ASSET_SUBJECT_IDENTITY,
    getDynamoDbTableStageName,
    type Asset,
    type CanvasNode,
    type CanvasState,
    type OperationStatusCanvasNode,
    type Workspace,
} from '@lixpi/constants'

import {
    assertAssetComponents,
    buildAssetProjectionOperations,
} from '../models/asset.ts'
import { deriveSubjectIdentityFromLineage } from '../services/asset-subject-identity-service.ts'

const { ORG_NAME, STAGE } = process.env

type LegacyUploadPlaceholderCanvasNode = {
    nodeId: string
    type: 'uploadPlaceholder'
    fileName: string
    status: 'converting' | 'failed'
    message?: string
    assetId?: string
    kind?: OperationStatusCanvasNode['kind']
    position: OperationStatusCanvasNode['position']
    dimensions: OperationStatusCanvasNode['dimensions']
    parentNodeId?: string
    extent?: 'parent'
    createdAt: number
    updatedAt: number
}

export type UnifiedMediaReferenceMigrationAudit = {
    legacyAssetIds: string[]
    legacyWorkspaceIds: string[]
    quarantined: Array<{
        entityType: 'asset' | 'workspace'
        entityId: string
        reason: string
    }>
}

export function migrateAssetMediaIdentity(asset: Asset | Record<string, unknown>): Asset {
    const next = {
        ...asset,
        depictionMedium: asset.depictionMedium ?? 'unknown',
        subjectIdentity: asset.subjectIdentity ?? structuredClone(DEFAULT_ASSET_SUBJECT_IDENTITY),
    } as Asset
    assertAssetComponents(next)
    return next
}

export function migrateOperationStatusCanvasNodes(canvasState: CanvasState): CanvasState {
    let changed = false
    const nodes = (canvasState.nodes as Array<CanvasNode | LegacyUploadPlaceholderCanvasNode>).map(node => {
        if (node.type !== 'uploadPlaceholder') return node as CanvasNode
        changed = true
        return {
            nodeId: node.nodeId,
            type: 'operationStatus',
            operation: 'upload',
            status: node.status === 'failed' ? 'failed' : 'in-progress',
            title: node.fileName,
            message: node.message ?? (node.status === 'failed' ? 'Upload failed.' : 'Preparing media…'),
            ...(node.assetId ? { assetId: node.assetId } : {}),
            ...(node.kind ? { kind: node.kind } : {}),
            ...(node.parentNodeId ? { parentId: node.parentNodeId } : {}),
            ...(node.extent ? { extent: node.extent } : {}),
            position: node.position,
            dimensions: node.dimensions,
            createdAt: node.createdAt,
            updatedAt: node.updatedAt,
        } satisfies OperationStatusCanvasNode
    })
    return changed ? { ...canvasState, nodes } : canvasState
}

export class UnifiedMediaReferenceMigration {
    async audit(): Promise<UnifiedMediaReferenceMigrationAudit> {
        const audit: UnifiedMediaReferenceMigrationAudit = {
            legacyAssetIds: [],
            legacyWorkspaceIds: [],
            quarantined: [],
        }
        const assetResult = await dynamoDBService.scanItems({
            tableName: getDynamoDbTableStageName('ASSETS', ORG_NAME, STAGE),
            limit: 1000,
            fetchAllItems: true,
            consistentRead: true,
            origin: 'UnifiedMediaReferenceMigration.auditAssets',
        })
        for (const rawAsset of (assetResult?.items ?? []) as Asset[]) {
            try {
                const migrated = migrateAssetMediaIdentity(rawAsset)
                if (!rawAsset.depictionMedium || !rawAsset.subjectIdentity) audit.legacyAssetIds.push(rawAsset.assetId)
                assertAssetComponents(migrated)
            } catch (error) {
                audit.quarantined.push({
                    entityType: 'asset',
                    entityId: rawAsset.assetId,
                    reason: error instanceof Error ? error.message : String(error),
                })
            }
        }
        const workspaceResult = await dynamoDBService.scanItems({
            tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
            limit: 1000,
            fetchAllItems: true,
            consistentRead: true,
            origin: 'UnifiedMediaReferenceMigration.auditWorkspaces',
        })
        for (const workspace of (workspaceResult?.items ?? []) as Workspace[]) {
            try {
                const migrated = migrateOperationStatusCanvasNodes(workspace.canvasState)
                if (migrated !== workspace.canvasState) audit.legacyWorkspaceIds.push(workspace.workspaceId)
                if ((migrated.nodes as Array<{ type?: string }>).some(node => node.type === 'uploadPlaceholder')) {
                    throw new Error('LEGACY_UPLOAD_PLACEHOLDER_REMAINED')
                }
            } catch (error) {
                audit.quarantined.push({
                    entityType: 'workspace',
                    entityId: workspace.workspaceId,
                    reason: error instanceof Error ? error.message : String(error),
                })
            }
        }
        return audit
    }

    async run(): Promise<{ migratedAssets: number; migratedWorkspaces: number }> {
        const preflight = await this.audit()
        if (preflight.quarantined.length > 0) {
            throw new Error(`UNIFIED_MEDIA_REFERENCE_MIGRATION_QUARANTINE_REQUIRED:${JSON.stringify(preflight.quarantined)}`)
        }
        const assetResult = await dynamoDBService.scanItems({
            tableName: getDynamoDbTableStageName('ASSETS', ORG_NAME, STAGE),
            limit: 1000,
            fetchAllItems: true,
            consistentRead: true,
            origin: 'UnifiedMediaReferenceMigration.assets',
        })
        let migratedAssets = 0
        const assetsById = new Map<string, Asset>()
        for (const rawAsset of (assetResult?.items ?? []) as Asset[]) {
            if (rawAsset.depictionMedium && rawAsset.subjectIdentity) {
                assetsById.set(rawAsset.assetId, rawAsset)
                continue
            }
            const next = migrateAssetMediaIdentity(rawAsset)
            const now = Date.now()
            const migrated = { ...next, revision: rawAsset.revision + 1, updatedAt: now }
            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'update',
                        tableName: getDynamoDbTableStageName('ASSETS', ORG_NAME, STAGE),
                        key: { assetId: rawAsset.assetId },
                        updates: {
                            depictionMedium: next.depictionMedium,
                            subjectIdentity: next.subjectIdentity,
                            revision: rawAsset.revision + 1,
                            updatedAt: now,
                        },
                        conditionExpression: '#revision = :expectedRevision',
                        expressionAttributeNames: { '#revision': 'revision' },
                        expressionAttributeValues: { ':expectedRevision': rawAsset.revision },
                    },
                    ...await buildAssetProjectionOperations(migrated),
                ],
                origin: 'UnifiedMediaReferenceMigration.asset',
            })
            assetsById.set(rawAsset.assetId, migrated)
            migratedAssets += 1
        }

        for (const asset of assetsById.values()) {
            const sourceAssetIds = asset.lineage?.sourceAssetIds ?? []
            if (sourceAssetIds.length === 0) continue
            const sourceAssets = sourceAssetIds.flatMap(assetId => assetsById.get(assetId) ?? [])
            if (sourceAssets.length !== sourceAssetIds.length) continue
            const subjectIdentity = deriveSubjectIdentityFromLineage(sourceAssets, { generatedOutput: true })
            if (JSON.stringify(subjectIdentity) === JSON.stringify(asset.subjectIdentity)) continue
            const now = Date.now()
            const migrated = {
                ...asset,
                subjectIdentity,
                revision: asset.revision + 1,
                updatedAt: now,
            }
            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'update',
                        tableName: getDynamoDbTableStageName('ASSETS', ORG_NAME, STAGE),
                        key: { assetId: asset.assetId },
                        updates: { subjectIdentity, revision: migrated.revision, updatedAt: now },
                        conditionExpression: '#revision = :expectedRevision',
                        expressionAttributeNames: { '#revision': 'revision' },
                        expressionAttributeValues: { ':expectedRevision': asset.revision },
                    },
                    ...await buildAssetProjectionOperations(migrated),
                ],
                origin: 'UnifiedMediaReferenceMigration.generatedLineage',
            })
            assetsById.set(asset.assetId, migrated)
            migratedAssets += 1
        }

        const workspaceResult = await dynamoDBService.scanItems({
            tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
            limit: 1000,
            fetchAllItems: true,
            consistentRead: true,
            origin: 'UnifiedMediaReferenceMigration.workspaces',
        })
        let migratedWorkspaces = 0
        for (const workspace of (workspaceResult?.items ?? []) as Workspace[]) {
            const canvasState = migrateOperationStatusCanvasNodes(workspace.canvasState)
            if (canvasState === workspace.canvasState) continue
            const now = Math.max(Date.now(), (workspace.canvasStateUpdatedAt ?? workspace.updatedAt) + 1)
            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'update',
                        tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                        key: { workspaceId: workspace.workspaceId },
                        updates: { canvasState, canvasStateUpdatedAt: now, updatedAt: now },
                        conditionExpression: '(#canvasStateUpdatedAt = :expected OR (attribute_not_exists(#canvasStateUpdatedAt) AND #updatedAt = :expected))',
                        expressionAttributeNames: {
                            '#canvasStateUpdatedAt': 'canvasStateUpdatedAt',
                            '#updatedAt': 'updatedAt',
                        },
                        expressionAttributeValues: { ':expected': workspace.canvasStateUpdatedAt ?? workspace.updatedAt },
                    },
                    {
                        type: 'update',
                        tableName: getDynamoDbTableStageName('WORKSPACES_META', ORG_NAME, STAGE),
                        key: { workspaceId: workspace.workspaceId },
                        updates: { updatedAt: now },
                    },
                ],
                origin: 'UnifiedMediaReferenceMigration.workspace',
            })
            migratedWorkspaces += 1
        }
        return { migratedAssets, migratedWorkspaces }
    }
}
