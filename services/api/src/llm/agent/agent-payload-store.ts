import { createHash } from 'node:crypto'
import {
    type TransactOperation,
} from '@lixpi/dynamodb-service'
import BlobModel, {
    buildBlobReferenceOperations,
    buildBlobReferenceRemovalOperations,
} from '../../models/blob.ts'
import { getContentAddressedBlob } from '../../services/blob-storage.ts'
import { enqueueBlobDeletion } from '../../services/asset-maintenance-queue.ts'

export type AgentPayload = {
    type: string
    hash: string
    byteSize: number
    inline?: string
    blobHash?: string
}

export type AgentPayloadPort = {
    prepare: (
        type: string,
        bytes: Uint8Array,
        ownerKey: string,
    ) => Promise<{
        payload: AgentPayload
        operations: TransactOperation[]
    }>
    read: (payload: AgentPayload) => Promise<Uint8Array>
    release: (
        payload: AgentPayload,
        ownerKey: string,
    ) => Promise<{
        operations: TransactOperation[]
        afterCommit: () => Promise<void>
    }>
}

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

export class AgentPayloadStore implements AgentPayloadPort {
    constructor(
        private readonly organizationId: string,
        private readonly conversationAssetId: string,
    ) {}

    async prepare(
        type: string,
        bytes: Uint8Array,
        ownerKey: string,
    ): Promise<{
        payload: AgentPayload
        operations: TransactOperation[]
    }> {
        const hash = digest(bytes)
        const payload = {
            type,
            hash,
            byteSize: bytes.byteLength,
        }

        if (bytes.byteLength <= 48_000)
            return {
                payload: {
                    ...payload,
                    inline: Buffer.from(bytes).toString('base64'),
                },
                operations: [],
            }

        const blob = await BlobModel.store({
            organizationId: this.organizationId,
            bytes,
            mimeType: 'application/octet-stream',
            description: 'Agent execution state',
        })

        return {
            payload: {
                ...payload,
                blobHash: blob.blobHash,
            },
            operations: buildBlobReferenceOperations({
                blob,
                reference: {
                    blobKey: blob.blobKey,
                    blobHash: blob.blobHash,
                    organizationId: this.organizationId,
                    referenceKey: this.referenceKey(ownerKey),
                    ownerType: 'asset',
                    ownerId: this.conversationAssetId,
                    createdAt: Date.now(),
                },
            }),
        }
    }

    async read(payload: AgentPayload): Promise<Uint8Array> {
        const bytes = payload.blobHash
            ? await getContentAddressedBlob({
                organizationId: this.organizationId,
                blobHash: payload.blobHash,
            })
            : Buffer.from(payload.inline ?? '', 'base64')

        if (
            bytes.byteLength !== payload.byteSize
            || digest(bytes) !== payload.hash
        )
            throw new Error('AGENT_PAYLOAD_CORRUPT')

        return bytes
    }

    async release(
        payload: AgentPayload,
        ownerKey: string,
    ): Promise<{
        operations: TransactOperation[]
        afterCommit: () => Promise<void>
    }> {
        if (!payload.blobHash)
            return {
                operations: [],
                afterCommit: async () => {},
            }

        const blobHash = payload.blobHash
        const removal = await buildBlobReferenceRemovalOperations({
            organizationId: this.organizationId,
            blobHash,
            referenceKey: this.referenceKey(ownerKey),
        })

        return {
            operations: removal.operations,
            afterCommit: async () => {
                if (removal.deletionRequired)
                    await enqueueBlobDeletion({
                        organizationId: this.organizationId,
                        blobHash,
                    })
            },
        }
    }

    private referenceKey(ownerKey: string): string {
        return `asset#${this.conversationAssetId}#agent#${digest(
            Buffer.from(ownerKey),
        )}`
    }
}
