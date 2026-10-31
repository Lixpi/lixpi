import {
    NATS_SUBJECTS,
    getDynamoDbTableStageName,
    type Asset,
    type AssetRequesterContext,
} from '@lixpi/constants'
import {
    type TransactOperation,
} from '@lixpi/dynamodb-service'
import {
    type default as NatsService,
} from '@lixpi/nats-service'
import {
    buildMediaRenderProvenance,
    type MediaRenderPlan,
    type MediaRenderResult,
} from '@lixpi/capability-system/backend'
import { MEDIA_SEQUENCE_ARTIFACT_TYPE_ID } from '@lixpi/capability-system/shared'
import {
    DOCUMENT_TYPE,
    HeadlessProseMirrorEngine,
    PROSEMIRROR_SCHEMA_VERSION,
} from '@lixpi/prosemirror'
import AssetModel, { publishAssetEvent } from '../models/asset.ts'
import BlobModel, {
    buildBlobReferenceBatchOperations,
    buildBlobReferenceRemovalOperations,
} from '../models/blob.ts'
import {
    enqueueBlobDeletion,
    enqueueRenditionRetry,
} from '../services/asset-maintenance-queue.ts'
import { ConversationAdapters } from '../llm/agent/conversation-adapters.ts'
import {
    type ConversationRepository,
} from '../llm/agent/conversation-repository.ts'
import { AgentPayloadStore } from '../llm/agent/agent-payload-store.ts'
import {
    type ArtifactStoreAccess,
} from './artifact-revision-store.ts'
import {
    type MediaRenderAdapterPorts,
    type MediaRenderRecord,
} from './media-render-adapter.ts'

export class MediaRenderPlatform {
    constructor(
        private readonly repository: ConversationRepository,
        private readonly nats: NatsService,
        private readonly onChanged: (record: MediaRenderRecord) => Promise<void> = async () => {},
    ) {}

    ports(): MediaRenderAdapterPorts {
        return {
            nats: this.nats,
            authorize: async (
                access,
                inputs,
                submitting,
            ) => await this.authorize(
                access,
                inputs,
                submitting,
            ),
            retainInputs: async (
                access,
                inputs,
                assetId,
            ) => await this.retain(
                access,
                inputs,
                assetId,
            ),
            releaseInputs: async record => await this.release(record),
            retainResult: async (record, result) => {
                const blob = await BlobModel.registerStoredBlob(result)

                if (record.inputs.some(input => input.blobHash === result.blobHash))
                    return []

                return buildBlobReferenceBatchOperations({ additions: [{
                    blob,
                    reference: {
                        blobKey: blob.blobKey,
                        blobHash: blob.blobHash,
                        organizationId: record.access.organizationId,
                        referenceKey: `asset#${record.outputAssetId}#render-result`,
                        ownerType: 'asset',
                        ownerId: record.outputAssetId,
                        createdAt: Date.now(),
                    },
                }] }).operations
            },
            payloads: (access, assetId) => new AgentPayloadStore(access.organizationId, assetId),
            finalize: async (
                record,
                result,
                commit,
            ) => await this.finalize(
                record,
                result,
                commit,
            ),
            publish: async record => {
                if (
                    record.state === 'completed'
                    && record.result?.mimeType === 'video/mp4'
                )
                    await enqueueRenditionRetry({
                        organizationId: record.access.organizationId,
                        assetId: record.outputAssetId,
                        retryAttempt: 0,
                    })

                await this.onChanged(record)
            },
            now: () => Date.now(),
        }
    }

    private requester(access: ArtifactStoreAccess): AssetRequesterContext {
        return {
            userId: access.userId,
            organizationIds: [access.organizationId],
            workspaceIds: [access.workspaceId],
            editableWorkspaceIds: [access.workspaceId],
        }
    }

    private async authorize(
        access: ArtifactStoreAccess,
        inputs: MediaRenderPlan['inputs'],
        submitting: boolean,
    ): Promise<TransactOperation[]> {
        const authorized = await new ConversationAdapters(this.repository).authorize(
            access.workspaceId,
            access.userId,
            true,
        )

        if (authorized.organizationId !== access.organizationId)
            throw new Error('MEDIA_RENDER_TENANT_MISMATCH')

        const fences = [...authorized.fences]
        const assets = new Map<string, Asset>()

        for (const input of inputs) {
            let asset = assets.get(input.assetId)

            if (!asset) {
                const loaded = await AssetModel.get({
                    assetId: input.assetId,
                    requester: this.requester(access),
                })

                if (
                    'error' in loaded
                    || loaded.organizationId !== access.organizationId
                    || loaded.states.lifecycle === 'deleting'
                )
                    throw new Error('MEDIA_RENDER_SOURCE_ACCESS_DENIED')

                asset = loaded
                assets.set(input.assetId, asset)
                fences.push({
                    type: 'check',
                    tableName: getDynamoDbTableStageName(
                        'ASSETS',
                        process.env.ORG_NAME!,
                        process.env.STAGE!,
                    ),
                    key: { assetId: asset.assetId },
                    conditionExpression: '#revision = :revision',
                    expressionAttributeNames: { '#revision': 'revision' },
                    expressionAttributeValues: { ':revision': asset.revision },
                })
            }

            const rendition = asset.media?.renditions[input.renditionId as keyof NonNullable<Asset['media']>['renditions']]

            if (
                submitting
                && (!rendition || rendition.status !== 'ready' || rendition.blobHash !== input.blobHash || rendition.byteSize !== input.byteSize)
            )
                throw new Error('MEDIA_RENDER_SOURCE_BINDING_CHANGED')
        }

        return fences
    }

    private async retain(
        access: ArtifactStoreAccess,
        inputs: MediaRenderPlan['inputs'],
        assetId: string,
    ): Promise<TransactOperation[]> {
        const additions = []

        for (const blobHash of new Set(
            inputs.map(input => input.blobHash),
        )) {
            const blob = await BlobModel.get({
                organizationId: access.organizationId,
                blobHash,
            })

            if (
                !blob
                || blob.status === 'deleting'
            )
                throw new Error('MEDIA_RENDER_SOURCE_UNAVAILABLE')

            additions.push({
                blob,
                reference: {
                    blobKey: blob.blobKey,
                    blobHash,
                    organizationId: access.organizationId,
                    referenceKey: `asset#${assetId}#render-source#${blobHash}`,
                    ownerType: 'asset' as const,
                    ownerId: assetId,
                    createdAt: Date.now(),
                },
            })
        }

        return buildBlobReferenceBatchOperations({ additions }).operations
    }

    private async release(record: MediaRenderRecord): Promise<{
        operations: TransactOperation[]
        afterCommit: () => Promise<void>
    }> {
        const operations: TransactOperation[] = []
        const deletions: string[] = []

        for (const blobHash of new Set(
            record.inputs.map(input => input.blobHash),
        )) {
            const removal = await buildBlobReferenceRemovalOperations({
                organizationId: record.access.organizationId,
                blobHash,
                referenceKey: `asset#${record.outputAssetId}#render-source#${blobHash}`,
            })
            operations.push(...removal.operations)

            if (removal.deletionRequired)
                deletions.push(blobHash)
        }

        const payload = await new AgentPayloadStore(record.access.organizationId, record.outputAssetId).release(record.payload, 'render-input')

        if (
            record.result
            && !record.inputs.some(input => input.blobHash === record.result!.blobHash)
        ) {
            const removal = await buildBlobReferenceRemovalOperations({
                organizationId: record.access.organizationId,
                blobHash: record.result.blobHash,
                referenceKey: `asset#${record.outputAssetId}#render-result`,
            })
            operations.push(...removal.operations)

            if (removal.deletionRequired)
                deletions.push(record.result.blobHash)
        }

        return {
            operations: [...operations, ...payload.operations],
            afterCommit: async () => {
                await payload.afterCommit()

                for (const blobHash of deletions)
                    await enqueueBlobDeletion({
                        organizationId: record.access.organizationId,
                        blobHash,
                    })
            },
        }
    }

    private async finalize(
        record: MediaRenderRecord,
        result: MediaRenderResult,
        commit: (operations: TransactOperation[]) => Promise<void>,
    ): Promise<void> {
        if (
            !/^[a-f0-9]{64}$/u.test(result.blobHash)
            || !Number.isSafeInteger(result.byteSize)
            || result.byteSize < 1
            || result.bucketName !== `blobs-${record.access.organizationId}-files`
            || result.objectKey !== `sha256/${result.blobHash.slice(0, 2)}/${result.blobHash}`
        )
            throw new Error('MEDIA_RENDER_OUTPUT_INVALID')

        await BlobModel.registerStoredBlob(result)
        const {
            document,
            evidence,
        } = buildMediaRenderProvenance(
            result,
            record.inputs,
            record.conversation?.conversationAssetId,
        )
        new HeadlessProseMirrorEngine({
            documentType: DOCUMENT_TYPE.ASSET_PROVENANCE,
            doc: document,
            version: 1,
        })
        const bytes = Buffer.from(
            JSON.stringify(document),
        )
        const provenance = await BlobModel.store({
            organizationId: record.access.organizationId,
            bytes,
            mimeType: 'application/json',
            description: 'Media sequence export provenance',
        })
        const now = Date.now()
        const video = result.mimeType === 'video/mp4'
        const prepared = await AssetModel.prepareCreate({
            assetId: record.outputAssetId,
            organizationId: record.access.organizationId,
            title: `Sequence export ${record.sequenceRevision}`,
            scope: 'workspace',
            scopeOwnerId: record.access.workspaceId,
            originWorkspaceId: record.access.workspaceId,
            ownerUserId: record.access.userId,
            workspaceReference: {
                workspaceId: record.access.workspaceId,
                nodeIds: [],
                surfaceIds: [`render:${record.jobId}`],
            },
            states: {
                lifecycle: 'active',
                media: video ? 'processing' : 'ready',
                conversation: 'none',
                provenance: 'sealed',
            },
            documents: { provenance: {
                role: 'provenance',
                blobHash: provenance.blobHash,
                byteSize: bytes.byteLength,
                schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
                version: 1,
                updatedAt: now,
                sealedAt: now,
            } },
            lineage: {
                parentAssetId: record.sequenceId,
                sourceArtifact: {
                    artifactId: record.sequenceId,
                    artifactTypeId: MEDIA_SEQUENCE_ARTIFACT_TYPE_ID,
                    revision: record.sequenceRevision,
                },
                sourceAssetIds: [...new Set(
                    record.inputs.map(input => input.assetId),
                )],
                mediaRunId: record.jobId,
                ...(record.conversation ? { sourceConversationAssetId: record.conversation.conversationAssetId } : {}),
            },
            media: {
                kind: video ? 'video' : 'audio',
                originalName: `sequence-${record.sequenceRevision}.${video
                    ? 'mp4'
                    : result.mimeType === 'audio/wav'
                        ? 'wav'
                        : 'mp3'}`,
                sourceMimeType: result.mimeType,
                modelSafe: true,
                ...(result.width !== undefined ? { width: result.width } : {}),
                ...(result.height !== undefined ? { height: result.height } : {}),
                durationSeconds: result.durationSeconds,
                hasAudio: true,
                renditions: { original: {
                    name: 'original',
                    status: 'ready',
                    blobHash: result.blobHash,
                    byteSize: result.byteSize,
                    mimeType: result.mimeType,
                    ...(result.width !== undefined ? { width: result.width } : {}),
                    ...(result.height !== undefined ? { height: result.height } : {}),
                    durationSeconds: result.durationSeconds,
                    updatedAt: now,
                } },
            },
        })
        const authorization = await this.authorize(
            record.access,
            record.inputs,
            false,
        )
        const sameTarget = (
            left: TransactOperation,
            right: TransactOperation,
        ): boolean => left.tableName === right.tableName && JSON.stringify(left.type === 'put' ? { assetId: left.item.assetId } : left.key) === JSON.stringify(
            right.type === 'put' ? { assetId: right.item.assetId } : right.key,
        )
        const assetOperations = prepared.operations.filter(operation => !authorization.some(fence => sameTarget(operation, fence)))
        await commit([
            ...assetOperations,
            this.repository.put(
                `ORG#${encodeURIComponent(record.access.organizationId)}#RENDER#${record.jobId}`,
                'EVIDENCE',
                evidence,
            ),
        ])
        publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.CREATED, prepared.asset)
    }
}
