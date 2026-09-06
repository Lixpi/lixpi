import {
    getAiInteractionCanonicalResponseSubject,
    STREAM_STATUS,
    type CapabilityRunEvent,
    type CapabilityRunEventStreamPayload,
    type CapabilityRunStatus,
} from '@lixpi/constants'
import NATS_Service from '@lixpi/nats-service'

import {
    getAuthorizedCapabilityRecords,
    readAuthorizedCapabilityManifestSnapshot,
    readAuthorizedCapabilityResourceSnapshot,
    type CapabilityRequesterContext as CatalogRequesterContext,
} from '../models/capability.ts'
import {
    createCapabilityRun,
    updateCapabilityRunStatus,
} from '../models/capability-run.ts'
import { CapabilityRunEventLog } from '../services/capability-run-event-log.ts'
import { PipelineEventLog } from '../llm/graph/pipeline-event-log.ts'
import {
    type CapabilityRequesterContext,
    type CapabilityResolverStore,
    type CapabilityRunPersistence,
} from '@lixpi/capability-system/backend'

export class CapabilityModelResolverStore implements CapabilityResolverStore {
    private readonly manifestBySnapshot = new Map<string, Awaited<ReturnType<typeof readAuthorizedCapabilityManifestSnapshot>>['manifest']>()

    async batchGetAuthorizedCatalogRecords({
        capabilityIds,
        requester,
    }: Parameters<CapabilityResolverStore['batchGetAuthorizedCatalogRecords']>[0]) {
        return await getAuthorizedCapabilityRecords({
            capabilityIds,
            requester: toCatalogRequester(requester),
        })
    }

    async readManifest({
        record,
        requester,
    }: Parameters<CapabilityResolverStore['readManifest']>[0]): Promise<Uint8Array> {
        const loaded = await readAuthorizedCapabilityManifestSnapshot({
            record,
            requester: toCatalogRequester(requester),
        })
        this.manifestBySnapshot.set(
            snapshotKey(record.capabilityId, record.manifestBlobHash),
            loaded.manifest,
        )

        return loaded.bytes
    }

    async readResource({
        record,
        resource,
        requester,
    }: Parameters<CapabilityResolverStore['readResource']>[0]): Promise<Uint8Array> {
        const manifest = this.manifestBySnapshot.get(
            snapshotKey(record.capabilityId, record.manifestBlobHash),
        )

        if (!manifest)
            throw new Error(`Capability manifest snapshot ${record.capabilityId}/${record.manifestBlobHash} was not loaded`)

        const loaded = await readAuthorizedCapabilityResourceSnapshot({
            record,
            manifest,
            resourceId: resource.resourceId,
            requester: toCatalogRequester(requester),
        })

        return loaded.bytes
    }
}

function snapshotKey(
    capabilityId: string,
    manifestBlobHash: string,
): string {
    return `${capabilityId}\u0000${manifestBlobHash}`
}

export const createCapabilityModelRunPersistence = (
    ownerUserId: string,
    eventLog = CapabilityRunEventLog.fromSingleton(),
): CapabilityRunPersistence => {
    const workspaceIds = new Map<string, string>()
    const lastStatuses = new Map<string, CapabilityRunStatus>()

    return {
        async createRun(run): Promise<void> {
            await createCapabilityRun({
                ...run,
                ownerUserId,
            })
            workspaceIds.set(run.runId, run.workspaceId)
            lastStatuses.set(run.runId, run.status)
        },
        async updateRun(run): Promise<void> {
            const previousStatus = lastStatuses.get(run.runId)

            if (!previousStatus)
                throw new Error(`Capability run ${run.runId} is not initialized`)

            await updateCapabilityRunStatus({
                runId: run.runId,
                workspaceId: run.workspaceId,
                expectedStatuses: [previousStatus],
                status: run.status,
                currentStepIds: run.currentStepIds,
                outputAssetIds: run.outputAssetIds,
            })
            lastStatuses.set(run.runId, run.status)
        },
        async appendEvent(event): Promise<void> {
            const workspaceId = workspaceIds.get(event.runId)

            if (!workspaceId)
                throw new Error(`Capability run ${event.runId} has no workspace mapping`)

            await eventLog.append({
                userId: ownerUserId,
                workspaceId,
                event,
            })
        },
    }
}

export const mirrorCapabilityRunEventToChat = async (args: {
    event: Readonly<CapabilityRunEvent>
    workspaceId: string
    organizationId?: string
    conversationAssetId: string
}): Promise<void> => {
    const natsService = NATS_Service.getInstance()

    if (!natsService)
        return

    const content: CapabilityRunEventStreamPayload = {
        status: STREAM_STATUS.CAPABILITY_RUN_EVENT,
        aiProvider: 'Capability',
        capabilityRunEvent: structuredClone(args.event),
        conversationAssetId: args.conversationAssetId,
    }
    const payload = {
        content,
        conversationAssetId: args.conversationAssetId,
        pipelineEventId: `capability:${args.event.runId}:${args.event.sequence}`,
    }
    await publishCapabilityChatPayload({
        ...args,
        natsService,
        payload,
    })

    if (args.event.canvasGeometry) {
        await publishCapabilityChatPayload({
            ...args,
            natsService,
            payload: {
                content: {
                    status: STREAM_STATUS.CANVAS_GEOMETRY_RESOLVED,
                    aiProvider: 'Capability',
                    canvasGeometry: structuredClone(args.event.canvasGeometry),
                },
                conversationAssetId: args.conversationAssetId,
                pipelineEventId: `capability:${args.event.runId}:${args.event.sequence}:canvas`,
            },
        })
    }
}

async function publishCapabilityChatPayload(args: {
    workspaceId: string
    organizationId?: string
    conversationAssetId: string
    natsService: NATS_Service
    payload: {
        content: object
        conversationAssetId: string
        pipelineEventId: string
    }
}): Promise<void> {
    try {
        const durable = await new PipelineEventLog(args.natsService).publishEvent({
            workspaceId: args.workspaceId,
            pipelineId: args.conversationAssetId,
            eventId: args.payload.pipelineEventId,
            payload: args.payload,
        })
        args.natsService.publish(
            getAiInteractionCanonicalResponseSubject(args.organizationId ?? args.workspaceId, args.conversationAssetId),
            {
                ...args.payload,
                pipelineStreamSeq: durable.streamSequence,
            },
        )
    } catch {
        args.natsService.publish(
            getAiInteractionCanonicalResponseSubject(args.organizationId ?? args.workspaceId, args.conversationAssetId),
            args.payload,
        )
    }
}

function toCatalogRequester(requester: CapabilityRequesterContext): CatalogRequesterContext {
    return {
        userId: requester.userId,
        organizationIds: requester.organizationId ? [requester.organizationId] : [],
    }
}
