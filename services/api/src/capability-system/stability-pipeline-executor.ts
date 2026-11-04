import { createHash } from 'node:crypto'
import sharp from 'sharp'
import {
    buildMediaPipelineImageProvenance,
    createMediaPipelineImageHandler,
    type MediaPipelineContext,
    type MediaPipelineModelRoute,
    type MediaPipelineOperationHandler,
    type MediaPipelineOperationReceipt,
    type MediaPipelineOperationRequest,
} from '@lixpi/capability-system/backend'
import {
    NATS_SUBJECTS,
    type ConversationSourceSnapshot,
} from '@lixpi/constants'
import {
    pricingForCalledInferenceProvider,
    type ProviderUsageClient,
} from '@lixpi/usage-reporter'
import {
    DOCUMENT_TYPE,
    HeadlessProseMirrorEngine,
    PROSEMIRROR_SCHEMA_VERSION,
} from '@lixpi/prosemirror'
import AiModel from '../models/ai-model.ts'
import AssetModel, { publishAssetEvent } from '../models/asset.ts'
import BlobModel from '../models/blob.ts'
import { enqueueRenditionRetry } from '../services/asset-maintenance-queue.ts'
import { AccountRequestContext } from '../services/account-request-context.ts'
import { AgentExecutionScope } from '../llm/agent/agent-execution-scope.ts'
import {
    AgentOperations,
    type AgentOperationRecord,
} from '../llm/agent/agent-operations.ts'
import {
    AgentPayloadStore,
    type AgentPayloadPort,
} from '../llm/agent/agent-payload-store.ts'
import {
    type ConversationRepository,
} from '../llm/agent/conversation-repository.ts'
import { bedrockInference } from '../llm/providers/bedrock-inference.ts'
import {
    StabilityBedrockCall,
    type StabilityBedrockOutput,
} from '../llm/providers/stability-bedrock-call.ts'

export class StabilityPipelineExecutor {
    constructor(
        private readonly repository: ConversationRepository,
        private readonly metrics: ProviderUsageClient,
    ) {}

    handler(): MediaPipelineOperationHandler {
        return createMediaPipelineImageHandler({
            ensure: request => this.ensure(request),
            read: (context, operationId) => this.read(context, operationId),
            cancel: async (_context, operationId) => {
                const ledger = this.ledger()
                const record = await ledger.get(operationId)

                if (
                    record
                    && ['prepared', 'authorized'].includes(record.state)
                ) {
                    const cancelled = await ledger.update(
                        record,
                        {
                            state: 'cancelled',
                            usage: { imageCount: 0 },
                        },
                        [],
                        false,
                    )
                    await ledger.settle(cancelled)
                }
            },
        })
    }

    async routes(): Promise<MediaPipelineModelRoute[]> {
        const available = await AiModel.getAvailableAiModels()
        const candidates = available.models.filter(model => model.provider.toLowerCase() === 'stability')
        const routes: MediaPipelineModelRoute[] = []

        for (const candidate of candidates) {
            const profile = await AiModel.getAiModel({
                provider: candidate.provider,
                model: candidate.model,
                omitPricing: false,
            })

            if (!profile)
                continue

            let ready = false

            if (
                profile.inferenceProviderCalledByThePlatform === 'aws-bedrock'
                && bedrockInference.isEnabledFor('stability')
            ) {
                try {
                    await bedrockInference.resolveModelId('stability', profile.modelVersion)
                    ready = true
                } catch {
                    // Route is unavailable until AWS access is restored.
                }
            }

            routes.push({
                modelId: `${profile.provider}:${profile.model}`,
                operationKeys: ['image.generate'],
                inputKinds: [],
                outputKinds: ['image'],
                inferenceProviderCalledByThePlatform: profile.inferenceProviderCalledByThePlatform,
                adapterReady: true,
                credentialsReady: ready,
                regionReady: ready,
                pricingReady: Boolean(pricingForCalledInferenceProvider(profile)?.image),
            })
        }

        return routes
    }

    private ledger(): AgentOperations {
        return new AgentOperations(
            AgentExecutionScope.current().owner,
            this.repository,
            this.metrics,
        )
    }

    private payloads(context: MediaPipelineContext): AgentPayloadPort {
        return new AgentPayloadStore(context.organizationId, context.conversationAssetId)
    }

    private async read(
        context: MediaPipelineContext,
        operationId: string,
    ): Promise<MediaPipelineOperationReceipt | undefined> {
        const ledger = this.ledger()
        let record = await ledger.get(operationId)

        if (!record)
            return undefined

        if (
            record.response
            && record.state !== 'succeeded'
            && record.state !== 'failed'
        ) {
            const request = JSON.parse(
                Buffer.from(await this.payloads(context).read(record.request)).toString('utf8'),
            ) as MediaPipelineOperationRequest
            const response = JSON.parse(
                Buffer.from(await this.payloads(context).read(record.response)).toString('utf8'),
            ) as StabilityBedrockOutput
            record = await this.commitOutput(
                request,
                record,
                response,
            )
        } else if (record.state === 'submitted')
            record = await ledger.update(
                record,
                {
                    state: 'outcome-unknown',
                    error: {
                        code: 'AGENT_OPERATION_OUTCOME_UNKNOWN',
                        message: 'The image request ended before a durable result was recorded.',
                        recoverable: false,
                    },
                },
                [],
                false,
            )

        await ledger.settle(record)

        return this.receipt(record)
    }

    private async ensure(request: MediaPipelineOperationRequest): Promise<MediaPipelineOperationReceipt> {
        const scope = await AgentExecutionScope.authorize('execute', ['image'])
        const ledger = this.ledger()
        const stored = await ledger.get(request.operationId)

        if (
            stored
            && !['prepared', 'authorized'].includes(stored.state)
        )
            return (await this.read(request.context, request.operationId))!

        if (
            Object.keys(request.inputs).length
            || request.node.operationKey !== 'image.generate'
        )
            throw new Error('STABILITY_PIPELINE_REFERENCE_CONTROL_UNAVAILABLE')

        const id = request.node.modelId ?? ''
        const preferences = scope.turn.settings.models

        if (
            preferences.imageModelIds.length
            && !preferences.imageModelIds.includes(id)
        )
            throw new Error('PIPELINE_IMAGE_MODEL_NOT_SELECTED')

        let pinnedSize: string | undefined

        for (const group of preferences.imageOptions?.configGroups?.filter(group => group.modelIds.includes(id)) ?? [])
            for (const [key, value] of Object.entries(group.values)) {
                if (key !== 'imageSize')
                    throw new Error(`PIPELINE_IMAGE_CONTROL_UNSUPPORTED:${key}`)

                if (
                    pinnedSize
                    && pinnedSize !== value
                )
                    throw new Error('PIPELINE_IMAGE_PREFERENCE_CONFLICT')

                pinnedSize = value
            }

        pinnedSize ??= preferences.imageOptions?.imageSize

        if (
            pinnedSize
            && pinnedSize !== 'auto'
            && pinnedSize !== request.node.parameters.imageSize
        )
            throw new Error('PIPELINE_IMAGE_PREFERENCE_CONFLICT')

        const separator = id.indexOf(':')
        const provider = id.slice(0, separator)
        const model = id.slice(separator + 1)
        const profile = await AiModel.getAiModel({
            provider,
            model,
            omitPricing: false,
        })

        if (
            !profile
            || provider.toLowerCase() !== 'stability'
            || !bedrockInference.isEnabledFor('stability')
            || profile.inferenceProviderCalledByThePlatform !== 'aws-bedrock'
            || !pricingForCalledInferenceProvider(profile)?.image
        )
            throw new Error('STABILITY_PIPELINE_ROUTE_UNAVAILABLE')

        const prompt = request.node.parameters.prompt
        const imageSize = request.node.parameters.imageSize

        if (
            typeof prompt !== 'string'
            || !prompt.trim()
            || prompt.length > (profile.imagePromptMaxChars ?? 10000)
            || typeof imageSize !== 'string'
            || !profile.imageSizes?.some(size => size.value === imageSize)
        )
            throw new Error('STABILITY_PIPELINE_PARAMETERS_UNAVAILABLE')

        await bedrockInference.resolveModelId('stability', profile.modelVersion)
        const payloads = this.payloads(request.context)
        const prepared = await payloads.prepare(
            'json',
            Buffer.from(
                JSON.stringify(request),
            ),
            `operation#${request.operationId}#request`,
        )
        const outputAssetId = `image-${createHash('sha256').update(request.operationId).digest('hex')}`
        const sourceSnapshots: ConversationSourceSnapshot[] = [...new Map(
            [...request.sourceSnapshots ?? [], ...Object.values(request.inputs)].map(source => [source.sourceId, source]),
        ).values()].map(
            source => ({
                assetId: source.assetId,
                role: ['image', 'video', 'audio'].includes(source.kind)
                    ? 'media'
                    : source.kind === 'text'
                        ? 'content'
                        : 'artifact',
                revision: source.revision,
                blobHash: source.blobHash!,
                ...(source.renditionId ? { renditionId: source.renditionId } : {}),
                ...(source.documentVersion ? { documentVersion: source.documentVersion } : {}),
                acquiredBy: 'explicit',
                relationshipPath: [source.assetId],
            }),
        )
        let record = await ledger.prepare(
            {
                operationId: request.operationId,
                conversationAssetId: request.context.conversationAssetId,
                turnId: request.context.turnId,
                runId: request.context.runId,
                responseMessageId: request.context.responseMessageId,
                operationKey: request.node.operationKey,
                executionId: request.executionId,
                stepId: request.node.nodeId,
                stepLabel: request.node.nodeId,
                inputHash: request.inputHash,
                sources: sourceSnapshots,
                state: 'prepared',
                epoch: request.context.epoch,
                continuationEpoch: request.context.continuationEpoch,
                modelId: id,
                providerModelVersion: profile.modelVersion,
                inferenceProvider: 'aws-bedrock',
                outputAssetIds: { image: outputAssetId },
                outputSources: {},
                request: prepared.payload,
                revision: 1,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            },
            prepared.operations,
        )
        record = await ledger.authorize(record)
        await scope.owner.fences(request.context.continuationEpoch)
        AccountRequestContext.assertActive()
        record = await ledger.update(record, { state: 'submitted' })
        let observed: AgentOperationRecord | undefined
        const cleanup = AccountRequestContext.prepareCleanup(async () => { if (observed)
            await ledger.settle(observed) })

        try {
            const seed = (createHash('sha256').update(request.operationId).digest().readUInt32BE(0) % 4294967293) + 1
            const result = await new StabilityBedrockCall().invoke(
                {
                    modelVersion: record.providerModelVersion,
                    prompt,
                    imageSize,
                    seed,
                },
                scope.owner.abort.signal,
            )
            observed = {
                ...record,
                usage: { imageCount: result.filtered ? 0 : 1 },
                providerRequestId: result.providerRequestId || `agent-operation:${request.operationId}`,
            }
            const response = await payloads.prepare(
                'json',
                Buffer.from(
                    JSON.stringify(result),
                ),
                `operation#${request.operationId}#response`,
            )
            record = await ledger.update(
                record,
                {
                    response: response.payload,
                    usage: observed.usage,
                    providerRequestId: observed.providerRequestId,
                    state: 'running',
                },
                response.operations,
                false,
            )
            record = await this.commitOutput(
                request,
                record,
                result,
            )

            return this.receipt(record)
        } catch (error) {
            const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
            const rejected = Boolean(status && [400, 401, 403, 404, 413, 422, 429].includes(status))

            if (rejected)
                observed = {
                    ...record,
                    usage: { imageCount: 0 },
                }

            if (!record.response) {
                record = await ledger.update(
                    record,
                    {
                        state: rejected ? 'failed' : 'outcome-unknown',
                        ...(observed ? {
                            usage: observed.usage,
                            ...(observed.providerRequestId ? { providerRequestId: observed.providerRequestId } : {}),
                        } : {}),
                        error: {
                            code: rejected ? 'STABILITY_REQUEST_REJECTED' : 'AGENT_OPERATION_OUTCOME_UNKNOWN',
                            message: rejected ? 'The image provider rejected this request.' : 'The image request outcome is unknown. It has not been repeated.',
                            recoverable: false,
                        },
                    },
                    [],
                    false,
                )

                return this.receipt(record)
            }

            throw error
        } finally {
            await cleanup()
        }
    }

    private async commitOutput(
        request: MediaPipelineOperationRequest,
        record: AgentOperationRecord,
        result: StabilityBedrockOutput,
    ): Promise<AgentOperationRecord> {
        const ledger = this.ledger()

        if (result.filtered)
            return await ledger.update(
                record,
                {
                    state: 'failed',
                    error: {
                        code: 'STABILITY_CONTENT_FILTERED',
                        message: 'The provider did not return an image for this request.',
                        recoverable: true,
                    },
                },
                [],
                false,
            )

        const bytes = Buffer.from(result.imageBase64, 'base64')

        if (
            !bytes.length
            || bytes.length > 64 * 1024 * 1024
        )
            throw new Error('STABILITY_OUTPUT_SIZE_INVALID')

        const metadata = await sharp(bytes, { limitInputPixels: 16_777_216 }).metadata()

        if (
            metadata.format !== 'png'
            || !metadata.width
            || !metadata.height
        )
            throw new Error('STABILITY_OUTPUT_FORMAT_INVALID')

        const assetId = record.outputAssetIds.image
        const blob = await BlobModel.store({
            organizationId: request.context.organizationId,
            bytes,
            mimeType: 'image/png',
            description: 'Generated pipeline image',
        })
        const document = buildMediaPipelineImageProvenance(
            request,
            {
                assetId,
                blobHash: blob.blobHash,
                seed: result.seed,
            },
        )
        new HeadlessProseMirrorEngine({
            documentType: DOCUMENT_TYPE.ASSET_PROVENANCE,
            doc: document,
            version: 1,
        })
        const provenanceBytes = Buffer.from(
            JSON.stringify(document),
        )
        const provenance = await BlobModel.store({
            organizationId: request.context.organizationId,
            bytes: provenanceBytes,
            mimeType: 'application/json',
            description: 'Pipeline image provenance',
        })
        const now = Date.now()
        const prepared = await AssetModel.prepareCreate({
            assetId,
            organizationId: request.context.organizationId,
            title: String(request.node.parameters.prompt).slice(0, 120),
            scope: 'workspace',
            scopeOwnerId: request.context.workspaceId,
            originWorkspaceId: request.context.workspaceId,
            ownerUserId: request.context.userId,
            workspaceReference: {
                workspaceId: request.context.workspaceId,
                nodeIds: [],
                surfaceIds: [`conversation#${request.context.conversationAssetId}#operation#${request.operationId}#image`],
            },
            states: {
                lifecycle: 'active',
                media: 'processing',
                conversation: 'none',
                provenance: 'sealed',
            },
            generatedOutputReview: { status: 'candidate' },
            lineage: {
                sourceConversationAssetId: request.context.conversationAssetId,
                sourceAssetIds: record.sources.map(source => source.assetId),
                mediaRunId: record.operationId,
                mediaModelId: record.modelId,
                generationSeed: result.seed,
                promptFingerprint: record.inputHash,
            },
            documents: { provenance: {
                role: 'provenance',
                blobHash: provenance.blobHash,
                byteSize: provenanceBytes.byteLength,
                schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
                version: 1,
                updatedAt: now,
                sealedAt: now,
            } },
            media: {
                kind: 'image',
                originalName: `${assetId}.png`,
                sourceMimeType: 'image/png',
                modelSafe: true,
                width: metadata.width,
                height: metadata.height,
                renditions: { original: {
                    name: 'original',
                    status: 'ready',
                    blobHash: blob.blobHash,
                    byteSize: bytes.byteLength,
                    mimeType: 'image/png',
                    width: metadata.width,
                    height: metadata.height,
                    updatedAt: now,
                } },
            },
        })
        const source: ConversationSourceSnapshot = {
            assetId,
            role: 'media',
            revision: prepared.asset.revision,
            blobHash: blob.blobHash,
            renditionId: 'original',
            acquiredBy: 'explicit',
            relationshipPath: [assetId],
        }
        const fences = await AgentExecutionScope.current().owner.fences()
        const next = await ledger.update(
            record,
            {
                state: 'succeeded',
                outputSources: { image: source },
            },
            [
                ...prepared.operations.filter(operation => !fences.some(fence => fence.tableName === operation.tableName)),
                this.repository.put(
                    AgentExecutionScope.current().owner.partition,
                    `CREATED#${assetId}`,
                    {
                        assetId,
                        runId: request.context.runId,
                    },
                ),
            ],
            false,
        )
        publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.CREATED, prepared.asset)
        await enqueueRenditionRetry({
            organizationId: request.context.organizationId,
            assetId,
            retryAttempt: 0,
        })
        await AgentExecutionScope.current().owner.event(
            'output.committed',
            {
                operationId: record.operationId,
                outputSlot: 'image',
                assetId,
            },
        )

        return next
    }

    private receipt(record: AgentOperationRecord): MediaPipelineOperationReceipt {
        return {
            operationId: record.operationId,
            inputHash: record.inputHash,
            state: record.state,
            outputs: Object.fromEntries(
                Object.entries(record.outputSources).map(
                    ([slot, source]) =>
                        [slot, {
                            sourceId: `source-${source.assetId}`,
                            assetId: source.assetId,
                            revision: source.revision,
                            kind: 'image',
                            blobHash: source.blobHash,
                            renditionId: source.renditionId,
                        }],
                ),
            ),
            ...(record.error ? { error: record.error } : {}),
        }
    }
}
