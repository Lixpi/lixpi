import {
    getAiInteractionCanonicalResponseSubject,
    STREAM_STATUS,
    type CapabilityRun,
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
    cancelCapabilityRun,
    updateCapabilityRunStatus,
} from '../models/capability-run.ts'
import { CapabilityRunEventLog } from '../services/capability-run-event-log.ts'
import { PipelineEventLog } from '../llm/graph/pipeline-event-log.ts'
import { AccountRequestContext } from '../services/account-request-context.ts'
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

const snapshotKey = (
    capabilityId: string,
    manifestBlobHash: string,
): string => `${capabilityId}\u0000${manifestBlobHash}`

type TrackedRun = {
    workspaceId: string
    status: CapabilityRunStatus
    cancel: () => Promise<void>
    cancellationEvent?: CapabilityRunEvent
}

export class CapabilityModelRunPersistence implements CapabilityRunPersistence {
    private readonly runs = new Map<string, TrackedRun>()

    constructor(
        private readonly ownerUserId: string,
        private readonly eventLog: CapabilityRunEventLog,
    ) {}

    async createRun(run: CapabilityRun): Promise<void> {
        const runId = run.runId
        const workspaceId = run.workspaceId
        const tracked: TrackedRun = {
            workspaceId,
            status: run.status,
            cancel: AccountRequestContext.prepareCleanup(async () => {
                if (!tracked.cancellationEvent)
                    throw new Error('CAPABILITY_CANCELLATION_REQUIRED')

                const cancelled = await cancelCapabilityRun({
                    runId,
                    workspaceId,
                    ownerUserId: this.ownerUserId,
                })

                if (cancelled) {
                    tracked.status = 'cancelled'
                    await this.eventLog.append({
                        userId: this.ownerUserId,
                        workspaceId,
                        event: tracked.cancellationEvent,
                    })
                }
            }),
        }
        this.runs.set(runId, tracked)
        await createCapabilityRun({
            ...run,
            ownerUserId: this.ownerUserId,
        })
    }

    private tracked(runId: string): TrackedRun {
        const tracked = this.runs.get(runId)

        if (!tracked)
            throw new Error('CAPABILITY_RUN_NOT_INITIALIZED')

        return tracked
    }

    async updateRun(run: CapabilityRun): Promise<void> {
        const tracked = this.tracked(run.runId)

        if (run.workspaceId !== tracked.workspaceId)
            throw new Error('CAPABILITY_RUN_WORKSPACE_MISMATCH')

        await updateCapabilityRunStatus({
            runId: run.runId,
            workspaceId: tracked.workspaceId,
            expectedStatuses: [tracked.status],
            status: run.status,
            currentStepIds: run.currentStepIds,
            outputAssetIds: run.outputAssetIds,
        })
        tracked.status = run.status
    }

    async appendEvent(event: CapabilityRunEvent): Promise<void> {
        await this.eventLog.append({
            userId: this.ownerUserId,
            workspaceId: this.tracked(event.runId).workspaceId,
            event,
        })
    }

    async cancelRun(
        run: Readonly<CapabilityRun>,
        event: Readonly<CapabilityRunEvent>,
    ): Promise<void> {
        const tracked = this.tracked(run.runId)

        if (
            run.workspaceId !== tracked.workspaceId
            || event.runId !== run.runId
            || !Number.isSafeInteger(event.sequence)
            || event.sequence < 1
        )
            throw new Error('CAPABILITY_CANCELLATION_MISMATCH')

        // Retain existing outputs and persist only the terminal cancellation.
        // Neither the supplied snapshot nor event can add output or progress data.
        tracked.cancellationEvent = {
            runId: run.runId,
            sequence: event.sequence,
            timestamp: Date.now(),
            eventType: 'RUN_CANCELLED',
            runStatus: 'cancelled',
            errorCode: 'CAPABILITY_RUN_CANCELLED',
            errorMessage: 'Capability run was cancelled',
        }
        await tracked.cancel()
    }
}

export const createCapabilityModelRunPersistence = (
    ownerUserId: string,
    eventLog = CapabilityRunEventLog.fromSingleton(),
): CapabilityRunPersistence => new CapabilityModelRunPersistence(ownerUserId, eventLog)

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

const publishCapabilityChatPayload = async (args: {
    workspaceId: string
    organizationId?: string
    conversationAssetId: string
    natsService: NATS_Service
    payload: {
        content: object
        conversationAssetId: string
        pipelineEventId: string
    }
}): Promise<void> => {
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

const toCatalogRequester = (requester: CapabilityRequesterContext): CatalogRequesterContext => {
    return {
        userId: requester.userId,
        organizationIds: requester.organizationId ? [requester.organizationId] : [],
    }
}
