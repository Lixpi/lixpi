'use strict'

import * as process from 'node:process'

import NATS_Service from '@lixpi/nats-service'
import {
    getAssetStepSubject,
    getOrganizationAssetStepStreamName,
} from '@lixpi/prosemirror'
import {
    ASSET_DOCUMENT_ROLES,
    getDynamoDbTableStageName,
    NATS_SUBJECTS,
    type Asset,
    type AssetAccessList,
    type AssetDocumentRole,
    type BlobRecord,
    type BlobReference,
} from '@lixpi/constants'

import BlobModel, { buildBlobReferenceBatchOperations } from '../models/blob.ts'
import {
    buildAssetSearchRecord,
    buildAssetPrincipalScopeKey,
    buildAssetScopeAndOwnerKey,
    publishAssetEvent,
} from '../models/asset.ts'
import AssetModel from '../models/asset.ts'
import { enqueueBlobDeletion } from './asset-maintenance-queue.ts'

const { ORG_NAME, STAGE } = process.env

const assetsTableName = (): string => getDynamoDbTableStageName('ASSETS', ORG_NAME, STAGE)
const assetsMetaTableName = (): string => getDynamoDbTableStageName('ASSETS_META', ORG_NAME, STAGE)
const assetsSearchTableName = (): string => getDynamoDbTableStageName('ASSETS_SEARCH', ORG_NAME, STAGE)
const assetsAccessListTableName = (): string => getDynamoDbTableStageName('ASSETS_ACCESS_LIST', ORG_NAME, STAGE)
const assetReferencesTableName = (): string => getDynamoDbTableStageName('ASSET_REFERENCES', ORG_NAME, STAGE)

const getDeletingAsset = async (assetId: string): Promise<Asset | undefined> =>
    await dynamoDBService.getItem({
        tableName: assetsTableName(),
        key: { assetId },
        consistentRead: true,
        origin: 'AssetMaintenance.getDeletingAsset',
    }) as Asset | undefined

const listAssetAccess = async (assetId: string): Promise<AssetAccessList[]> => {
    const result = await dynamoDBService.queryItems({
        tableName: assetsAccessListTableName(),
        keyConditions: { assetId },
        limit: 100,
        fetchAllItems: true,
        consistentRead: true,
        origin: 'AssetMaintenance.listAssetAccess',
    })
    return (result?.items ?? []) as AssetAccessList[]
}

const hasReferences = async (assetId: string): Promise<boolean> => {
    const result = await dynamoDBService.queryItems({
        tableName: assetReferencesTableName(),
        keyConditions: { assetId },
        limit: 1,
        consistentRead: true,
        origin: 'AssetMaintenance.hasReferences',
    })
    return (result?.items?.length ?? 0) > 0
}

const purgeDocumentSubjects = async (asset: Asset): Promise<void> => {
    const natsService = NATS_Service.getInstance()
    if (!natsService) throw new Error('NATS service unavailable')
    const streamName = getOrganizationAssetStepStreamName(asset.organizationId)
    if (!await natsService.getJetStreamStreamInfoOrNull(streamName)) return
    for (const role of ASSET_DOCUMENT_ROLES) {
        const subject = getAssetStepSubject({
            organizationId: asset.organizationId,
            assetId: asset.assetId,
            role,
        })
        await natsService.purgeJetStreamSubject(streamName, subject)
    }
}

const buildAssetBlobRemovalOperations = async (asset: Asset) => {
    const pointers: Array<{ blobHash: string; referenceKey: string }> = []
    for (const role of Object.keys(asset.documents) as AssetDocumentRole[]) {
        const pointer = asset.documents[role]
        if (!pointer) continue
        pointers.push({
            blobHash: pointer.blobHash,
            referenceKey: `asset#${asset.assetId}#document#${role}`,
        })
    }
    for (const [name, rendition] of Object.entries(asset.media?.renditions ?? {})) {
        if (rendition?.status !== 'ready' || !rendition.blobHash) continue
        pointers.push({
            blobHash: rendition.blobHash,
            referenceKey: `asset#${asset.assetId}#rendition#${name}`,
        })
    }

    const removals: Array<{ blob: BlobRecord; reference: BlobReference }> = []
    for (const pointer of pointers) {
        const blob = await BlobModel.get({ organizationId: asset.organizationId, blobHash: pointer.blobHash })
        if (!blob) throw new Error(`ASSET_BLOB_NOT_FOUND:${pointer.blobHash}`)
        const reference = await BlobModel.getReference(blob.blobKey, pointer.referenceKey)
        if (!reference) throw new Error(`ASSET_BLOB_REFERENCE_NOT_FOUND:${pointer.referenceKey}`)
        removals.push({ blob, reference })
    }
    return buildBlobReferenceBatchOperations({ additions: [], removals })
}

const deleteAccessProjections = async (asset: Asset, accessRows: AssetAccessList[]): Promise<void> => {
    const operations = accessRows.flatMap((access) => [
        {
            type: 'delete' as const,
            tableName: assetsAccessListTableName(),
            key: { assetId: asset.assetId, principalId: access.principalId },
        },
        ...(access.principalId !== asset.ownerUserId
            ? [{
                type: 'delete' as const,
                tableName: assetsMetaTableName(),
                key: { scopeAndOwner: buildAssetPrincipalScopeKey(access.principalId), assetId: asset.assetId },
            }, ...(buildAssetSearchRecord(asset, buildAssetPrincipalScopeKey(access.principalId)) ? [{
                type: 'delete' as const,
                tableName: assetsSearchTableName(),
                key: {
                    scopeAndOwner: buildAssetPrincipalScopeKey(access.principalId),
                    searchKey: buildAssetSearchRecord(asset, buildAssetPrincipalScopeKey(access.principalId))!.searchKey,
                },
            }] : [])]
            : []),
    ])
    for (let index = 0; index < operations.length; index += 100) {
        await dynamoDBService.transactWrite({
            operations: operations.slice(index, index + 100),
            origin: 'AssetMaintenance.deleteAccessProjections',
        })
    }
}

const AssetMaintenance = {
    deleteAsset: async ({
        organizationId,
        assetId,
    }: {
        organizationId: string
        assetId: string
    }): Promise<{ deleted: boolean; reason?: string }> => {
        const asset = await getDeletingAsset(assetId)
        if (!asset) return { deleted: true }
        if (asset.organizationId !== organizationId) return { deleted: false, reason: 'TENANT_MISMATCH' }
        if (asset.states.lifecycle !== 'deleting' || asset.referenceCount !== 0) {
            return { deleted: false, reason: 'ASSET_NOT_DELETING' }
        }
        if (await hasReferences(assetId)) return { deleted: false, reason: 'REFERENCES_REMAIN' }

        await AssetModel.removeSurfaceReferencesByPrefixSystem({
            organizationId,
            surfacePrefix: `document#${assetId}#`,
        })
        await AssetModel.removeSurfaceReferencesByPrefixSystem({
            organizationId,
            surfacePrefix: `conversation#${assetId}#media#`,
        })
        await AssetModel.removeSurfaceReferencesByPrefixSystem({
            organizationId,
            surfacePrefix: `capabilityArtifact#${assetId}`,
        })

        const accessRows = await listAssetAccess(assetId)
        await purgeDocumentSubjects(asset)
        await deleteAccessProjections(asset, accessRows)
        const blobRemoval = await buildAssetBlobRemovalOperations(asset)
        const finalOperations = [
            ...blobRemoval.operations,
            {
                type: 'delete' as const,
                tableName: assetsMetaTableName(),
                key: {
                    scopeAndOwner: buildAssetScopeAndOwnerKey(asset.scope, asset.scopeOwnerId),
                    assetId,
                },
            },
            ...(buildAssetSearchRecord(asset) ? [{
                type: 'delete' as const,
                tableName: assetsSearchTableName(),
                key: {
                    scopeAndOwner: buildAssetScopeAndOwnerKey(asset.scope, asset.scopeOwnerId),
                    searchKey: buildAssetSearchRecord(asset)!.searchKey,
                },
            }] : []),
            {
                type: 'delete' as const,
                tableName: assetsTableName(),
                key: { assetId },
                conditionExpression: '#revision = :expectedRevision AND #referenceCount = :zero AND #states.#lifecycle = :deleting',
                expressionAttributeNames: {
                    '#revision': 'revision',
                    '#referenceCount': 'referenceCount',
                    '#states': 'states',
                    '#lifecycle': 'lifecycle',
                },
                expressionAttributeValues: {
                    ':expectedRevision': asset.revision,
                    ':zero': 0,
                    ':deleting': 'deleting',
                },
            },
        ]
        if (finalOperations.length > 100) return { deleted: false, reason: 'ASSET_BLOB_REFERENCE_LIMIT_EXCEEDED' }

        await dynamoDBService.transactWrite({
            operations: finalOperations,
            origin: 'AssetMaintenance.deleteAsset',
        })

        publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.DELETED, asset)

        for (const blobHash of blobRemoval.deletionBlobHashes) {
            await enqueueBlobDeletion({ organizationId, blobHash })
        }
        return { deleted: true }
    },
}

export default AssetMaintenance
