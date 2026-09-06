import NATS_Service from '@lixpi/nats-service'
import {
    NATS_SUBJECTS,
    type MediaGenerationRunMeta,
} from '@lixpi/constants'

export const ASSET_MAINTENANCE_STREAM_NAME = 'ASSET_MAINTENANCE'
export const ASSET_MAINTENANCE_CONSUMER_NAME = 'api-asset-maintenance'

const getNatsService = (): NATS_Service => {
    const natsService = NATS_Service.getInstance()

    if (!natsService)
        throw new Error('NATS service unavailable')

    return natsService
}

export const ensureAssetMaintenanceQueue = async (natsService: NATS_Service = getNatsService()): Promise<void> => {
    await natsService.ensureJetStreamStream({
        name: ASSET_MAINTENANCE_STREAM_NAME,
        subjects: ['asset.maintenance.>', 'blob.maintenance.>'],
        retention: 'workqueue',
        storage: 'file',
        max_age: 30 * 24 * 60 * 60 * 1000000000,
    })
    await natsService.ensureJetStreamConsumer(
        ASSET_MAINTENANCE_STREAM_NAME,
        {
            durable_name: ASSET_MAINTENANCE_CONSUMER_NAME,
            ack_policy: 'explicit',
            deliver_policy: 'all',
            filter_subject: '>',
            ack_wait: 60 * 1000000000,
            max_deliver: -1,
        },
    )
}

export const enqueueAssetDeletion = async ({
    organizationId,
    assetId,
}: {
    organizationId: string
    assetId: string
}): Promise<void> => {
    await getNatsService().publishJetStream(
        NATS_SUBJECTS.ASSET_MAINTENANCE_SUBJECTS.DELETE_ASSET,
        {
            organizationId,
            assetId,
        },
    )
}

export const enqueueBlobDeletion = async ({
    organizationId,
    blobHash,
}: {
    organizationId: string
    blobHash: string
}): Promise<void> => {
    await getNatsService().publishJetStream(
        NATS_SUBJECTS.ASSET_MAINTENANCE_SUBJECTS.DELETE_BLOB,
        {
            organizationId,
            blobHash,
        },
    )
}

export const enqueueProvenanceRebuild = async (payload: {
    organizationId: string
    assetId: string
    workspaceId: string
    conversationAssetId: string
    generationRun: MediaGenerationRunMeta
    terminalStatus: 'completed' | 'failed' | 'cancelled'
    retryAttempt?: number
    notBefore?: number
}): Promise<void> => void (await getNatsService().publishJetStream(NATS_SUBJECTS.ASSET_MAINTENANCE_SUBJECTS.REBUILD_PROVENANCE, payload))

export const enqueueRenditionRetry = async (payload: {
    organizationId: string
    assetId: string
    retryAttempt: number
}): Promise<void> => void (await getNatsService().publishJetStream(NATS_SUBJECTS.ASSET_MAINTENANCE_SUBJECTS.RETRY_RENDITION, payload))

export const enqueueProjectionRepair = async (payload: {
    organizationId: string
    assetId: string
}): Promise<void> => void (await getNatsService().publishJetStream(NATS_SUBJECTS.ASSET_MAINTENANCE_SUBJECTS.REPAIR_PROJECTIONS, payload))

export const enqueueWorkspaceReferenceCleanup = async (payload: {
    organizationId: string
    assetId: string
    workspaceId: string
    ownerUserId: string
    removeCatalog: boolean
}): Promise<void> => void (await getNatsService().publishJetStream(NATS_SUBJECTS.ASSET_MAINTENANCE_SUBJECTS.CLEANUP_WORKSPACE_REFERENCE, payload))

export const enqueueAssetSurfaceCleanup = async (payload: {
    organizationId: string
    assetId: string
    surfaceId: string
}): Promise<void> => void (await getNatsService().publishJetStream(NATS_SUBJECTS.ASSET_MAINTENANCE_SUBJECTS.CLEANUP_ASSET_SURFACE, payload))
