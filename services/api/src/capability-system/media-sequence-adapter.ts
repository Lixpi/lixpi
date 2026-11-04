import {
    createMediaSequenceDocument,
    MEDIA_SEQUENCE_MAX_SOURCES,
    mediaSequenceArtifactDefinition,
    type MediaSequence,
    type SequenceRevision,
    type SequenceSourceBinding,
    type SequencePatchResult,
} from '@lixpi/capability-system/shared'
import { createHash } from 'node:crypto'
import {
    defaultMediaRenderLimits,
    type MediaSequenceAccess,
    type MediaSequencePorts,
    type MediaSequenceReceipt,
    type MediaSourceProbeResult,
    type MediaSourceProbeRequest,
} from '@lixpi/capability-system/backend'
import {
    NATS_SUBJECTS,
    getDynamoDbTableStageName,
    type Asset,
    type AssetRenditionName,
    type AssetRequesterContext,
} from '@lixpi/constants'
import {
    type TransactOperation,
} from '@lixpi/dynamodb-service'
import {
    type default as NatsService,
} from '@lixpi/nats-service'
import AssetModel, { buildAssetScopeAndOwnerKey } from '../models/asset.ts'
import BlobModel, { buildBlobReferenceBatchOperations } from '../models/blob.ts'
import {
    type ConversationRepository,
} from '../llm/agent/conversation-repository.ts'
import { ConversationAdapters } from '../llm/agent/conversation-adapters.ts'
import {
    ArtifactRevisionStore,
    type ArtifactStoreAccess,
} from './artifact-revision-store.ts'
import { AgentExecutionScope } from '../llm/agent/agent-execution-scope.ts'
import { AccountRequestContext } from '../services/account-request-context.ts'

type StoredSequence = {
    sequence: MediaSequence
    revision: SequenceRevision
}
type SourceProbeCache = {
    result: unknown
    byteSize: number
    expiresAt: number
}
const probeVersion = 'media-source-v1'
const probePartition = (organizationId: string): string => `ORG#${encodeURIComponent(organizationId)}#MEDIA_SOURCE_PROBES`
const probeKey = (source: SequenceSourceBinding): string => `${probeVersion}#${source.blobHash}`

export class MediaSequenceAdapter {
    private readonly store: ArtifactRevisionStore

    constructor(
        private readonly repository: ConversationRepository,
        private readonly agentFences: (access: MediaSequenceAccess) => Promise<TransactOperation[]>,
        private readonly nats: Pick<NatsService, 'request'>,
    ) {
        this.store = new ArtifactRevisionStore(repository)
    }

    ports(): MediaSequencePorts {
        return {
            authorize: async (
                access,
                sequenceId,
                intent,
            ) => {
                await this.store.authorize(
                    access,
                    sequenceId,
                    intent === 'create',
                    intent !== 'read',
                )

                if (access.origin.kind === 'conversation') {
                    await AgentExecutionScope.authorize(
                        intent === 'read' ? 'inspect' : 'execute',
                        intent === 'read' ? [] : ['sequence-edit'],
                        intent === 'edit'
                            || intent === 'read'
                            ? [sequenceId]
                            : [],
                    )
                    await this.agentFences(access)
                }
            },
            load: async (
                access,
                sequenceId,
                revision,
            ) => (await this.store.load<StoredSequence>(
                access,
                sequenceId,
                revision,
            ))?.sequence,
            readMutation: async (
                access,
                sequenceId,
                mutationId,
            ): Promise<MediaSequenceReceipt | undefined> => {
                const stored = await this.store.mutation<StoredSequence>(
                    access,
                    sequenceId,
                    mutationId,
                )

                return stored ? {
                    ...stored,
                    requestHash: stored.revision.requestHash,
                } : undefined
            },
            listRevisions: async (
                access,
                sequenceId,
                afterRevision,
            ) => (await this.store.history<StoredSequence>(
                access,
                sequenceId,
                afterRevision,
            )).map(record => record.revision),
            resolveSource: (access, source) => this.resolveSource(access, source),
            commit: async (access, input) => {
                const references = await this.sourceReferences(access, input.sequence)
                const execution = access.origin.kind === 'conversation' ? AgentExecutionScope.current() : undefined
                const created = execution
                    && input.expectedRevision === 0
                    ? [this.repository.put(
                        execution.owner.partition,
                        `CREATED#${input.sequence.sequenceId}`,
                        {
                            assetId: input.sequence.sequenceId,
                            runId: (await execution.owner.read()).run!.runId,
                        },
                    )]
                    : []
                const committed = await this.store.commit({
                    access,
                    assetId: input.sequence.sequenceId,
                    title: input.sequence.name,
                    expectedRevision: input.expectedRevision,
                    revision: input.sequence.revision,
                    clientMutationId: input.revision.clientMutationId,
                    value: {
                        sequence: input.sequence,
                        revision: input.revision,
                    },
                    document: createMediaSequenceDocument(input.sequence),
                    definition: mediaSequenceArtifactDefinition,
                    ...(access.origin.kind === 'conversation' ? { fences: () => this.agentFences(access) } : {}),
                    additionalOperations: [...references.operations, ...created],
                    retainedBlobs: references.retainedBlobs,
                })

                if (
                    committed
                    && execution
                    && input.expectedRevision === 0
                )
                    execution.createdAssetIds.add(input.sequence.sequenceId)

                return committed
            },
            now: () => new Date().toISOString(),
        }
    }

    async reportEdit(
        access: MediaSequenceAccess,
        result: Exclude<SequencePatchResult, { status: 'conflict' }>,
    ): Promise<void> {
        if (access.origin.kind !== 'conversation')
            return

        const scope = AgentExecutionScope.current()
        await this.agentFences(access)
        const meta = await scope.owner.read()
        const operationId = `sequence-edit-${createHash('sha256')
            .update(
                JSON.stringify([scope.turn.turnId, result.sequence.sequenceId, result.revision.clientMutationId]),
            )
            .digest('hex')}`

        if (await this.repository.read(scope.owner.partition, `PUBLIC_OPERATION#${scope.responseMessageId}#${operationId}`))
            return

        const now = Date.now()
        await scope.owner.event(
            'operation.status',
            {
                operationId,
                conversationAssetId: scope.owner.job.conversationAssetId,
                turnId: scope.turn.turnId,
                runId: meta.run!.runId,
                responseMessageId: scope.responseMessageId,
                operationKey: result.revision.baseRevision === 0 ? 'sequence.create' : 'sequence.revise',
                inputHash: result.revision.requestHash,
                sources: [],
                state: 'succeeded',
                epoch: scope.owner.epoch,
                continuationEpoch: scope.continuationEpoch,
                outputAssetIds: { sequence: result.sequence.sequenceId },
                createdAt: now,
                updatedAt: now,
            },
        )
        await scope.owner.event(
            'output.committed',
            {
                operationId,
                outputSlot: 'sequence',
                assetId: result.sequence.sequenceId,
            },
        )
    }

    async resolveSource(
        access: ArtifactStoreAccess & { origin?: MediaSequenceAccess['origin'] },
        input: Pick<SequenceSourceBinding, 'sourceId' | 'assetId' | 'renditionId'>,
    ): Promise<SequenceSourceBinding> {
        return (await this.resolveSourceSnapshot(access, input)).source
    }

    private async resolveSourceSnapshot(
        access: ArtifactStoreAccess & { origin?: MediaSequenceAccess['origin'] },
        input: Pick<SequenceSourceBinding, 'sourceId' | 'assetId' | 'renditionId'>,
    ): Promise<{
        source: SequenceSourceBinding
        asset: Asset
    }> {
        if (access.origin?.kind === 'conversation')
            await AgentExecutionScope.assertReadTargets([input.assetId])

        const identity = await new ConversationAdapters(this.repository).authorize(
            access.workspaceId,
            access.userId,
            false,
        )

        if (identity.organizationId !== access.organizationId)
            throw new Error('MEDIA_SEQUENCE_SOURCE_UNAVAILABLE')

        if (![input.sourceId, input.assetId, input.renditionId].every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(id)))
            throw new Error('MEDIA_SEQUENCE_INVALID_SOURCE_ID')

        const asset = await AssetModel.get({
            assetId: input.assetId,
            requester: this.requester(access),
        })

        if (
            'error' in asset
            || asset.organizationId !== access.organizationId
            || asset.states.lifecycle === 'deleting'
            || !asset.media
            || !['image', 'video', 'audio'].includes(asset.media.kind)
        )
            throw new Error('MEDIA_SEQUENCE_SOURCE_UNAVAILABLE')

        const rendition = asset.media.renditions[input.renditionId as AssetRenditionName]

        if (
            !rendition
            || rendition.status !== 'ready'
            || !rendition.blobHash
            || !rendition.byteSize
        )
            throw new Error('MEDIA_SEQUENCE_SOURCE_UNAVAILABLE')

        const durationSeconds = rendition.durationSeconds ?? asset.media.durationSeconds

        if (
            asset.media.kind !== 'image'
            && (!durationSeconds || !Number.isFinite(durationSeconds))
        )
            throw new Error('MEDIA_SEQUENCE_SOURCE_METADATA_PENDING')

        const width = rendition.width ?? asset.media.width
        const height = rendition.height ?? asset.media.height

        if (
            asset.media.kind !== 'audio'
            && (!width || !height)
        )
            throw new Error('MEDIA_SEQUENCE_SOURCE_METADATA_PENDING')

        const source: SequenceSourceBinding = {
            sourceId: input.sourceId,
            assetId: asset.assetId,
            renditionId: rendition.name,
            blobHash: rendition.blobHash,
            byteSize: rendition.byteSize,
            kind: asset.media.kind as SequenceSourceBinding['kind'],
            timeBase: {
                numerator: 1,
                denominator: 1_000_000,
            },
            duration: asset.media.kind === 'image' ? 0 : Math.round(durationSeconds! * 1_000_000),
            ...(width ? { width } : {}),
            ...(height ? { height } : {}),
            ...(asset.media.hasAudio !== undefined ? { hasAudio: asset.media.hasAudio } : {}),
        }
        const cached = await this.cachedProbe(access, source)

        return {
            source: cached ? this.probedBinding(source, cached) : source,
            asset,
        }
    }

    async probeSource(
        access: ArtifactStoreAccess,
        input: Pick<SequenceSourceBinding, 'sourceId' | 'assetId' | 'renditionId'>,
    ): Promise<{
        source: SequenceSourceBinding
        waveform: number[]
    }> {
        const source = await this.resolveSource(access, input)
        const cached = await this.cachedProbe(access, source)

        if (cached)
            return {
                source: this.probedBinding(source, cached),
                waveform: cached.peaks,
            }

        const response = await this.nats.request<MediaSourceProbeRequest, MediaSourceProbeResult>(
            NATS_SUBJECTS.MEDIA_RENDER_SUBJECTS.PROBE_SOURCE,
            {
                organizationId: access.organizationId,
                source,
                accountContext: AccountRequestContext.workContext(),
            },
            95000,
        )
        const result = this.validateProbe(response, source)

        if (!result)
            throw new Error('MEDIA_SEQUENCE_INVALID_SOURCE_PROBE')

        AccountRequestContext.assertActive()
        const current = await this.resolveSource(access, input)

        if (
            current.blobHash !== source.blobHash
            || current.byteSize !== source.byteSize
        )
            throw new Error('MEDIA_SEQUENCE_STALE_SOURCE')

        await this.repository.commit([this.repository.replace(
            probePartition(access.organizationId),
            probeKey(source),
            {
                byteSize: source.byteSize,
                result,
                expiresAt: Math.floor(Date.now() / 1000) + 86400,
            },
        )])

        return {
            source: this.probedBinding(source, result),
            waveform: result.peaks,
        }
    }

    private async cachedProbe(
        access: ArtifactStoreAccess,
        source: SequenceSourceBinding,
    ): Promise<MediaSourceProbeResult | undefined> {
        const cached = await this.repository.read<SourceProbeCache>(
            probePartition(access.organizationId),
            probeKey(source),
        )

        if (
            !cached
            || cached.byteSize !== source.byteSize
            || !Number.isSafeInteger(cached.expiresAt)
            || cached.expiresAt <= Date.now() / 1000
        )
            return undefined

        return this.validateProbe(cached.result, source)
    }

    private validateProbe(
        value: unknown,
        source: SequenceSourceBinding,
    ): MediaSourceProbeResult | undefined {
        if (
            !value
            || typeof value !== 'object'
            || Array.isArray(value)
        )
            return undefined

        const result = value as MediaSourceProbeResult

        if (
            result.probeVersion !== probeVersion
            || result.blobHash !== source.blobHash
            || typeof result.hasAudio !== 'boolean'
            || !Number.isFinite(result.durationSeconds)
            || result.durationSeconds < 0
            || result.durationSeconds > defaultMediaRenderLimits.maxDurationSeconds
            || (source.kind !== 'image' && result.durationSeconds <= 0)
            || !Array.isArray(result.peaks)
            || result.peaks.length !== (result.hasAudio
                && result.durationSeconds > 0
                ? 512
                : 0)
            || result.peaks.some(peak => !Number.isFinite(peak) || peak < 0 || peak > 1)
        )
            return undefined

        if (
            source.kind !== 'audio'
            && (!Number.isSafeInteger(result.width) || !Number.isSafeInteger(result.height) || result.width! < 1 || result.height! < 1 || result.width! * result.height! > defaultMediaRenderLimits.maxPixels)
        )
            return undefined

        if (
            (source.kind === 'audio' && !result.hasAudio)
            || (result.hasAudio && (!Number.isSafeInteger(result.channels) || result.channels! < 1 || result.channels! > 64 || !Number.isSafeInteger(result.audioSampleRate) || result.audioSampleRate! < 8000 || result.audioSampleRate! > 384000))
        )
            return undefined

        return {
            probeVersion,
            blobHash: result.blobHash,
            durationSeconds: result.durationSeconds,
            hasAudio: result.hasAudio,
            peaks: [...result.peaks],
            ...(source.kind !== 'audio' ? {
                width: result.width,
                height: result.height,
            } : {}),
            ...(result.hasAudio ? {
                channels: result.channels,
                audioSampleRate: result.audioSampleRate,
            } : {}),
        }
    }

    private probedBinding(
        source: SequenceSourceBinding,
        result: MediaSourceProbeResult,
    ): SequenceSourceBinding {
        return {
            ...source,
            duration: source.kind === 'image' ? 0 : Math.round(result.durationSeconds * source.timeBase.denominator / source.timeBase.numerator),
            ...(source.kind !== 'audio' ? {
                width: result.width,
                height: result.height,
            } : {}),
            ...(result.channels ? { channels: result.channels } : {}),
            hasAudio: result.hasAudio,
        }
    }

    async listSources(
        access: ArtifactStoreAccess,
        cursor?: string,
    ): Promise<{
        items: Array<{
            name: string
            source: SequenceSourceBinding
            waveform?: number[]
        }>
        cursor?: string
    }> {
        await new ConversationAdapters(this.repository).authorize(
            access.workspaceId,
            access.userId,
            false,
        )
        const page = await AssetModel.listAvailable({
            scopeAndOwners: [buildAssetScopeAndOwnerKey('workspace', access.workspaceId)],
            principalId: access.userId,
            organizationIds: [access.organizationId],
            limit: 50,
            cursor,
        })
        const items: Array<{
            name: string
            source: SequenceSourceBinding
            waveform?: number[]
        }> = []

        for (const asset of page.items) {
            if (
                !['image', 'video', 'audio'].includes(asset.primaryCategory)
                || asset.scopeOwnerId !== access.workspaceId
            )
                continue

            try {
                const source = await this.resolveSource(
                    access,
                    {
                        sourceId: `source-${asset.assetId}`,
                        assetId: asset.assetId,
                        renditionId: 'original',
                    },
                )
                const cached = await this.cachedProbe(access, source)
                items.push({
                    name: asset.title,
                    source,
                    ...(cached?.peaks.length ? { waveform: cached.peaks } : {}),
                })
            } catch {
                // Incomplete metadata and unavailable renditions are omitted
                // until the existing file conversion worker finishes.
            }
        }

        return {
            items,
            ...(page.cursor ? { cursor: page.cursor } : {}),
        }
    }

    private async sourceReferences(
        access: ArtifactStoreAccess,
        sequence: MediaSequence,
    ): Promise<{
        operations: TransactOperation[]
        retainedBlobs: Array<{
            blobHash: string
            referenceKey: string
        }>
    }> {
        if (sequence.sources.length > MEDIA_SEQUENCE_MAX_SOURCES)
            throw new Error('MEDIA_SEQUENCE_SOURCE_LIMIT')

        const now = Date.now()
        const references = []
        const assets = new Map<string, Asset>()

        for (const source of sequence.sources) {
            const {
                source: resolved,
                asset,
            } = await this.resolveSourceSnapshot(access, source)

            if (
                resolved.blobHash !== source.blobHash
                || resolved.byteSize !== source.byteSize
            )
                throw new Error('MEDIA_SEQUENCE_STALE_SOURCE')

            const previous = assets.get(asset.assetId)

            if (
                previous
                && previous.revision !== asset.revision
            )
                throw new Error('MEDIA_SEQUENCE_STALE_SOURCE')

            assets.set(asset.assetId, asset)

            const blob = await BlobModel.get({
                organizationId: access.organizationId,
                blobHash: source.blobHash,
            })

            if (!blob)
                throw new Error('MEDIA_SEQUENCE_SOURCE_UNAVAILABLE')

            references.push({
                blob,
                reference: {
                    blobKey: blob.blobKey,
                    blobHash: blob.blobHash,
                    organizationId: access.organizationId,
                    referenceKey: `asset#${sequence.sequenceId}#sequence#${sequence.revision}#${source.sourceId}`,
                    ownerType: 'asset' as const,
                    ownerId: sequence.sequenceId,
                    createdAt: now,
                },
            })
        }

        return {
            operations: [
                ...Array.from(
                    assets.values(),
                    asset => ({
                        type: 'check' as const,
                        tableName: getDynamoDbTableStageName(
                            'ASSETS',
                            process.env.ORG_NAME!,
                            process.env.STAGE!,
                        ),
                        key: { assetId: asset.assetId },
                        conditionExpression: '#revision = :revision',
                        expressionAttributeNames: { '#revision': 'revision' },
                        expressionAttributeValues: { ':revision': asset.revision },
                    }),
                ),
                ...buildBlobReferenceBatchOperations({
                    additions: references,
                    now,
                }).operations,
            ],
            retainedBlobs: references.map(
                ({ reference }) => ({
                    blobHash: reference.blobHash,
                    referenceKey: reference.referenceKey,
                }),
            ),
        }
    }

    private requester(access: ArtifactStoreAccess): AssetRequesterContext {
        return {
            userId: access.userId,
            workspaceIds: [access.workspaceId],
            editableWorkspaceIds: [],
            organizationIds: [access.organizationId],
        }
    }
}
