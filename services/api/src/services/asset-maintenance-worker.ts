import * as process from 'node:process'

import type NATS_Service from '@lixpi/nats-service'
import {
    getDynamoDbTableStageName,
    NATS_SUBJECTS,
    type MediaGenerationRunMeta,
} from '@lixpi/constants'

import BlobModel from '../models/blob.ts'
import { retireSupersededCapabilityBlobReferences } from '../models/capability.ts'
import AssetModel, { getAssetRecord } from '../models/asset.ts'
import AssetMaintenance from './asset-maintenance.ts'
import AssetDocumentService from './asset-document-service.ts'
import AssetRenditionService, { RENDITION_WORKER_UNAVAILABLE } from './asset-rendition-service.ts'
import { deleteUnregisteredContentAddressedObjects } from './blob-storage.ts'
import { materializeAssetProvenance } from './asset-provenance-materializer.ts'
import {
    ASSET_MAINTENANCE_CONSUMER_NAME,
    ASSET_MAINTENANCE_STREAM_NAME,
    enqueueProvenanceRebuild,
    ensureAssetMaintenanceQueue,
} from './asset-maintenance-queue.ts'

const { ORG_NAME, STAGE } = process.env
const MAX_PROVENANCE_RETRY_ATTEMPTS = 5

const listOrganizationIds = async (): Promise<string[]> => {
    const result = await dynamoDBService.scanItems({
        tableName: getDynamoDbTableStageName('ORGANIZATIONS', ORG_NAME, STAGE),
        limit: 1000,
        fetchAllItems: true,
        consistentRead: true,
        origin: 'AssetMaintenance.listOrganizationIdsForBlobSweep',
    })
    return [
        ...new Set(
            (result?.items ?? [])
                .map((item: { organizationId?: unknown }) => item.organizationId)
                .filter((organizationId: unknown): organizationId is string => typeof organizationId === 'string' && Boolean(organizationId)),
        ),
    ]
}

type AssetMaintenanceMessage = {
    organizationId: string
    assetId?: string
    blobHash?: string
    workspaceId?: string
    conversationAssetId?: string
    generationRun?: MediaGenerationRunMeta
    terminalStatus?: 'completed' | 'failed' | 'cancelled'
    retryAttempt?: number
    ownerUserId?: string
    removeCatalog?: boolean
    surfaceId?: string
    notBefore?: number
}

type MaintenanceMessageDisposition = {
    nakDelayMs: number
}

const containsEmbeddedAsset = (node: unknown, assetId: string): boolean => {
    if (!node || typeof node !== 'object') return false
    const record = node as { attrs?: { assetId?: unknown }; content?: unknown }
    if (record.attrs?.assetId === assetId) return true
    return Array.isArray(record.content)
        && record.content.some((child) => containsEmbeddedAsset(child, assetId))
}

const isCurrentDocumentSurface = async ({
    organizationId,
    embeddedAssetId,
    surfaceId,
}: {
    organizationId: string
    embeddedAssetId: string
    surfaceId: string
}): Promise<boolean> => {
    const match = /^(?:document#([^#]+)#content|capabilityArtifact#([^#]+))$/.exec(surfaceId)
    if (!match) return false
    const hostAssetId = match[1] ?? match[2]
    const role = match[2] ? 'capabilityArtifact' : 'content'
    const hostAsset = await getAssetRecord(hostAssetId!)
    if (!hostAsset || hostAsset.organizationId !== organizationId || !hostAsset.documents[role]) return false
    const snapshot = await AssetDocumentService.loadCurrentSnapshot(hostAsset, role)
    return Boolean(snapshot && containsEmbeddedAsset(snapshot.doc, embeddedAssetId))
}

const dispatchMaintenanceMessage = async ({
    subject,
    data,
}: {
    subject: string
    data: AssetMaintenanceMessage
}): Promise<void | MaintenanceMessageDisposition> => {
    if (subject === NATS_SUBJECTS.ASSET_MAINTENANCE_SUBJECTS.DELETE_ASSET) {
        if (!data.assetId) throw new Error('ASSET_ID_REQUIRED')
        const result = await AssetMaintenance.deleteAsset({
            organizationId: data.organizationId,
            assetId: data.assetId,
        })
        if (!result.deleted && result.reason === 'REFERENCES_REMAIN') {
            await AssetModel.repairProjections({ assetId: data.assetId })
            return
        }
        if (!result.deleted && result.reason !== 'ASSET_NOT_DELETING') {
            throw new Error(result.reason ?? 'ASSET_DELETION_FAILED')
        }
        return
    }
    if (subject === NATS_SUBJECTS.ASSET_MAINTENANCE_SUBJECTS.DELETE_BLOB) {
        if (!data.blobHash) throw new Error('BLOB_HASH_REQUIRED')
        const deleted = await BlobModel.deleteZeroReferenceBlob({
            organizationId: data.organizationId,
            blobHash: data.blobHash,
        })
        if (!deleted) {
            const blob = await BlobModel.get({
                organizationId: data.organizationId,
                blobHash: data.blobHash,
            })
            if (blob?.referenceCount === 0 && blob.status === 'deleting') {
                return { nakDelayMs: 30000 }
            }
        }
        return
    }
    if (subject === NATS_SUBJECTS.ASSET_MAINTENANCE_SUBJECTS.REBUILD_PROVENANCE) {
        if (!data.assetId || !data.workspaceId || !data.conversationAssetId || !data.generationRun || !data.terminalStatus) {
            throw new Error('INVALID_PROVENANCE_REBUILD_PAYLOAD')
        }
        if (data.notBefore && data.notBefore > Date.now()) {
            return { nakDelayMs: data.notBefore - Date.now() }
        }
        const asset = await getAssetRecord(data.assetId)
        if (!asset) return
        if (asset.organizationId !== data.organizationId) throw new Error('ASSET_TENANT_MISMATCH')
        try {
            await materializeAssetProvenance({
                assetId: data.assetId,
                workspaceId: data.workspaceId,
                conversationAssetId: data.conversationAssetId,
                generationRun: data.generationRun,
                terminalStatus: data.terminalStatus,
                allowMinimalCompletedProjection: (data.retryAttempt ?? 0) >= MAX_PROVENANCE_RETRY_ATTEMPTS - 1,
            })
        } catch (error) {
            const retryAttempt = (data.retryAttempt ?? 0) + 1
            if (retryAttempt >= MAX_PROVENANCE_RETRY_ATTEMPTS) {
                console.error('Asset provenance rebuild exhausted:', error)
                return
            }
            const backoffMs = Math.min(5 * 60000, 30000 * 2 ** Math.min(retryAttempt - 1, 4))
            await enqueueProvenanceRebuild({
                organizationId: data.organizationId,
                assetId: data.assetId,
                workspaceId: data.workspaceId,
                conversationAssetId: data.conversationAssetId,
                generationRun: data.generationRun,
                terminalStatus: data.terminalStatus,
                retryAttempt,
                notBefore: Date.now() + backoffMs,
            })
            if ((error as { message?: unknown })?.message !== 'PROVENANCE_PROJECTION_NOT_READY') {
                console.error('Asset provenance rebuild deferred:', error)
            }
        }
        return
    }
    if (subject === NATS_SUBJECTS.ASSET_MAINTENANCE_SUBJECTS.RETRY_RENDITION) {
        if (!data.assetId) throw new Error('ASSET_ID_REQUIRED')
        const asset = await getAssetRecord(data.assetId)
        if (!asset || asset.states.lifecycle === 'deleting') return
        if (asset.organizationId !== data.organizationId) throw new Error('ASSET_TENANT_MISMATCH')
        try {
            await AssetRenditionService.process({
                assetId: data.assetId,
                retryAttempt: data.retryAttempt ?? 1,
            })
        } catch (error) {
            // The file-conversion workload is not listening yet (NEX still deploying,
            // or the node is restarting). Redeliver without consuming a retry attempt.
            if ((error as { message?: string })?.message !== RENDITION_WORKER_UNAVAILABLE) throw error
            console.warn(`Rendition worker unavailable; retrying asset ${data.assetId} in 30s`)
            return { nakDelayMs: 30000 }
        }
        return
    }
    if (subject === NATS_SUBJECTS.ASSET_MAINTENANCE_SUBJECTS.REPAIR_PROJECTIONS) {
        if (!data.assetId) throw new Error('ASSET_ID_REQUIRED')
        const asset = await getAssetRecord(data.assetId)
        if (!asset) return
        if (asset.organizationId !== data.organizationId) throw new Error('ASSET_TENANT_MISMATCH')
        await AssetModel.repairProjections({ assetId: data.assetId })
        return
    }
    if (subject === NATS_SUBJECTS.ASSET_MAINTENANCE_SUBJECTS.CLEANUP_WORKSPACE_REFERENCE) {
        if (!data.assetId || !data.workspaceId || !data.ownerUserId) throw new Error('INVALID_WORKSPACE_REFERENCE_CLEANUP_PAYLOAD')
        await AssetModel.cleanupImportedWorkspaceAsset({
            organizationId: data.organizationId,
            assetId: data.assetId,
            workspaceId: data.workspaceId,
            ownerUserId: data.ownerUserId,
            removeCatalog: data.removeCatalog === true,
        })
        return
    }
    if (subject === NATS_SUBJECTS.ASSET_MAINTENANCE_SUBJECTS.CLEANUP_ASSET_SURFACE) {
        if (!data.assetId || !data.surfaceId) throw new Error('INVALID_ASSET_SURFACE_CLEANUP_PAYLOAD')
        if (
            await isCurrentDocumentSurface({
                organizationId: data.organizationId,
                embeddedAssetId: data.assetId,
                surfaceId: data.surfaceId,
            })
        ) return
        await AssetModel.removeAssetSurfaceReferenceSystem({
            organizationId: data.organizationId,
            assetId: data.assetId,
            surfaceId: data.surfaceId,
        })
        return
    }
    throw new Error(`UNSUPPORTED_MAINTENANCE_SUBJECT:${subject}`)
}

export const startAssetMaintenanceWorker = async (natsService: NATS_Service): Promise<void> => {
    await ensureAssetMaintenanceQueue(natsService)
    let nextStagingCollectionAt = 0
    let nextUnregisteredObjectCollectionAt = 0
    let nextCapabilityBlobRetirementAt = 0
    const poll = async (): Promise<void> => {
        try {
            await natsService.processJetStreamMessages<AssetMaintenanceMessage>(
                ASSET_MAINTENANCE_STREAM_NAME,
                ASSET_MAINTENANCE_CONSUMER_NAME,
                async (message) => await dispatchMaintenanceMessage(message),
                { maxMessages: 20, expiresMs: 1000, nakDelayMs: 30000 },
            )
            if (Date.now() >= nextStagingCollectionAt) {
                await BlobModel.collectOrphanedStagingBlobs({
                    olderThan: Date.now() - 24 * 60 * 60 * 1000,
                })
                nextStagingCollectionAt = Date.now() + 60 * 60 * 1000
            }
            if (Date.now() >= nextUnregisteredObjectCollectionAt) {
                await deleteUnregisteredContentAddressedObjects({
                    organizationIds: await listOrganizationIds(),
                    olderThan: Date.now() - 24 * 60 * 60 * 1000,
                    isRegistered: async (organizationId, blobHash) => Boolean(await BlobModel.get({ organizationId, blobHash })),
                })
                nextUnregisteredObjectCollectionAt = Date.now() + 24 * 60 * 60 * 1000
            }
            if (Date.now() >= nextCapabilityBlobRetirementAt) {
                await retireSupersededCapabilityBlobReferences({ limit: 100 })
                nextCapabilityBlobRetirementAt = Date.now() + 60 * 60 * 1000
            }
        } catch (error) {
            console.error('Asset maintenance worker poll failed:', error)
        }
        const timer = setTimeout(() => {
            void poll()
        }, 250)
        if (typeof timer === 'object' && 'unref' in timer) timer.unref()
    }
    void poll()
}
