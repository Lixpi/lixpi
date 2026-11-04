import {
    NATS_SUBJECTS,
    type Asset,
    type AssetRequesterContext,
} from '@lixpi/constants'
import {
    isTransactionConditionalCheckFailure,
    type TransactOperation,
} from '@lixpi/dynamodb-service'
import {
    type CapabilityArtifactSharedDefinition,
} from '@lixpi/capability-system/shared'
import AssetModel, { publishAssetEvent } from '../models/asset.ts'
import BlobModel from '../models/blob.ts'
import AssetDocumentService from '../services/asset-document-service.ts'
import {
    conversationSequenceKey,
    type ConversationRepository,
} from '../llm/agent/conversation-repository.ts'
import { ConversationAdapters } from '../llm/agent/conversation-adapters.ts'
import {
    AgentPayloadStore,
    type AgentPayload,
} from '../llm/agent/agent-payload-store.ts'

export type ArtifactStoreAccess = {
    userId: string
    organizationId: string
    workspaceId: string
}

type ArtifactRevisionRecord = {
    revision: number
    payload: AgentPayload
    retainedBlobs?: Array<{
        blobHash: string
        referenceKey: string
    }>
}

export class ArtifactRevisionStore {
    constructor(private readonly repository: ConversationRepository) {}

    partition(
        access: ArtifactStoreAccess,
        assetId: string,
    ): string {
        return `ORG#${encodeURIComponent(access.organizationId)}#ARTIFACT#${assetId}`
    }

    async authorize(
        access: ArtifactStoreAccess,
        assetId: string,
        create: boolean,
        write: boolean,
    ): Promise<Asset | undefined> {
        const authorized = await new ConversationAdapters(this.repository).authorize(
            access.workspaceId,
            access.userId,
            write,
        )

        if (authorized.organizationId !== access.organizationId)
            throw new Error('ARTIFACT_TENANT_MISMATCH')

        const asset = await AssetModel.get({
            assetId,
            requester: this.requester(access, write),
        })

        if ('error' in asset) {
            if (
                create
                && asset.error === 'NOT_FOUND'
            )
                return undefined

            throw new Error('ARTIFACT_ACCESS_DENIED')
        }

        if (
            asset.organizationId !== access.organizationId
            || asset.states.lifecycle === 'deleting'
        )
            throw new Error('ARTIFACT_ACCESS_DENIED')

        return asset
    }

    async load<T>(
        access: ArtifactStoreAccess,
        assetId: string,
        revision?: number,
    ): Promise<T | undefined> {
        const pk = this.partition(access, assetId)
        const key = revision === undefined ? 'META' : `REVISION#${conversationSequenceKey(revision)}`
        const record = await this.repository.read<ArtifactRevisionRecord>(pk, key)

        if (!record)
            return undefined

        return await this.decode<T>(
            access,
            assetId,
            record.payload,
        )
    }

    async mutation<T>(
        access: ArtifactStoreAccess,
        assetId: string,
        clientMutationId: string,
    ): Promise<T | undefined> {
        const receipt = await this.repository.read<{ revision: number }>(
            this.partition(access, assetId),
            `MUTATION#${clientMutationId}`,
        )

        return receipt ? await this.load<T>(
            access,
            assetId,
            receipt.revision,
        ) : undefined
    }

    async history<T>(
        access: ArtifactStoreAccess,
        assetId: string,
        afterRevision: number,
    ): Promise<T[]> {
        const records: T[] = []
        let after: string | undefined = `REVISION#${conversationSequenceKey(afterRevision)}`

        do {
            const page = await this.repository.query<ArtifactRevisionRecord>(
                this.partition(access, assetId),
                'REVISION#',
                { after },
            )

            for (const record of page.items)
                records.push(await this.decode<T>(
                    access,
                    assetId,
                    record.payload,
                ))

            after = page.cursor
        } while (after)

        return records
    }

    async commit<T>(input: {
        access: ArtifactStoreAccess
        assetId: string
        title: string
        expectedRevision: number
        revision: number
        clientMutationId: string
        value: T
        document: object
        definition: CapabilityArtifactSharedDefinition
        fences?: () => Promise<TransactOperation[]>
        additionalOperations?: TransactOperation[]
        retainedBlobs?: Array<{
            blobHash: string
            referenceKey: string
        }>
    }): Promise<boolean> {
        const {
            access,
            assetId,
            definition,
        } = input
        definition.assertInitialDocument(input.document)
        const asset = await this.authorize(
            access,
            assetId,
            input.expectedRevision === 0,
            true,
        )

        if (
            asset
            && asset.artifact?.artifactTypeId !== definition.artifactTypeId
        )
            throw new Error('ARTIFACT_TYPE_CONFLICT')

        const payloads = new AgentPayloadStore(access.organizationId, assetId)
        const pk = this.partition(access, assetId)
        const sk = `REVISION#${conversationSequenceKey(input.revision)}`
        const prepared = await payloads.prepare(
            'json',
            Buffer.from(
                JSON.stringify(input.value),
            ),
            sk,
        )
        const record: ArtifactRevisionRecord = {
            revision: input.revision,
            payload: prepared.payload,
            ...(input.retainedBlobs ? { retainedBlobs: input.retainedBlobs } : {}),
        }
        const commit = async (assetOperations: TransactOperation[]) => {
            const authorized = await new ConversationAdapters(this.repository).authorize(
                access.workspaceId,
                access.userId,
                true,
            )
            // The Asset preparation includes a workspace touch, while this
            // transaction checks the exact access list and deletion state.
            const operations = assetOperations.filter(operation => !authorized.fences.some(fence => fence.tableName === operation.tableName))
            const transaction = [
                ...(input.fences ? await input.fences() : authorized.fences),
                ...operations,
                this.repository.put(
                    pk,
                    'META',
                    record,
                    input.expectedRevision || undefined,
                ),
                this.repository.put(
                    pk,
                    sk,
                    record,
                ),
                this.repository.put(
                    pk,
                    `MUTATION#${input.clientMutationId}`,
                    { revision: input.revision },
                ),
                ...prepared.operations,
                ...input.additionalOperations ?? [],
            ]

            // AccountDatabaseService appends the requester's admission check.
            if (transaction.length > 99)
                throw new Error('ARTIFACT_TRANSACTION_LIMIT')

            await this.repository.commit(transaction)
        }

        try {
            if (asset) {
                await AssetDocumentService.replaceSystemSnapshot({
                    asset,
                    role: 'capabilityArtifact',
                    doc: input.document,
                    version: input.revision,
                    title: input.title,
                    validateArtifactMutation: (_previous, proposed) => definition.assertInitialDocument(proposed),
                    commitWith: commit,
                })
            } else {
                const bytes = Buffer.from(
                    JSON.stringify(input.document),
                )
                const blob = await BlobModel.store({
                    organizationId: access.organizationId,
                    bytes,
                    mimeType: 'application/json',
                    description: input.title,
                })
                const preparedAsset = await AssetModel.prepareCreate({
                    assetId,
                    organizationId: access.organizationId,
                    title: input.title,
                    scope: 'workspace',
                    scopeOwnerId: access.workspaceId,
                    originWorkspaceId: access.workspaceId,
                    ownerUserId: access.userId,
                    artifact: {
                        artifactTypeId: definition.artifactTypeId,
                        schemaVersion: definition.schemaVersion,
                    },
                    artifactRevisionState: true,
                    documents: { capabilityArtifact: {
                        role: 'capabilityArtifact',
                        blobHash: blob.blobHash,
                        version: input.revision,
                        schemaVersion: definition.schemaVersion,
                        byteSize: bytes.byteLength,
                        updatedAt: Date.now(),
                    } },
                    workspaceReference: {
                        workspaceId: access.workspaceId,
                        nodeIds: [],
                        surfaceIds: [`artifact:${assetId}`],
                    },
                })
                await commit(preparedAsset.operations)
                publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.CREATED, preparedAsset.asset)
            }

            return true
        } catch (error) {
            if (isTransactionConditionalCheckFailure(error))
                return false

            throw error
        }
    }

    private async decode<T>(
        access: ArtifactStoreAccess,
        assetId: string,
        payload: AgentPayload,
    ): Promise<T> {
        return JSON.parse(
            Buffer.from(await new AgentPayloadStore(access.organizationId, assetId).read(payload)).toString('utf8'),
        ) as T
    }

    private requester(
        access: ArtifactStoreAccess,
        write: boolean,
    ): AssetRequesterContext {
        return {
            userId: access.userId,
            organizationIds: [access.organizationId],
            workspaceIds: [access.workspaceId],
            editableWorkspaceIds: write ? [access.workspaceId] : [],
        }
    }
}
