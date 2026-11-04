import {
    type Asset,
    type ConversationTurn,
} from '@lixpi/constants'
import { buildBlobReferenceRemovalOperations } from '../../models/blob.ts'
import { enqueueBlobDeletion } from '../../services/asset-maintenance-queue.ts'
import {
    AgentPayloadStore,
    type AgentPayload,
} from './agent-payload-store.ts'
import {
    ConversationRepository,
    conversationPartition,
    conversationWorkspacePartition,
    conversationDuePartition,
    conversationDueKey,
    type ConversationDispatch,
} from './conversation-repository.ts'

export type AgentStateRow = {
    sk: string
    payload?: AgentPayload
    response?: AgentPayload
    request?: AgentPayload
    revision?: number
    retainedBlobs?: Array<{
        blobHash: string
        referenceKey: string
    }>
}

export type AgentStateRetentionResolver = (row: AgentStateRow) => Array<{
    payload: AgentPayload
    ownerKey: string
}>

let installedRetentionResolver: AgentStateRetentionResolver = () => []

export const setAgentStateRetentionResolver = (resolver: AgentStateRetentionResolver): void => void (installedRetentionResolver = resolver)

export const retainedAgentStatePayloads = (row: AgentStateRow): ReturnType<AgentStateRetentionResolver> => {
    if (row.sk.startsWith('OPERATION#'))
        return (['request', 'response'] as const).flatMap(
            field => row[field] ? [{
                payload: row[field]!,
                ownerKey: `operation#${row.sk.slice('OPERATION#'.length)}#${field}`,
            }] : [],
        )

    const payload = row.payload ?? row.response

    return payload ? [{
        payload,
        ownerKey: row.sk.startsWith('MESSAGE_CONTEXT#') ? `message-context#${row.sk.slice('MESSAGE_CONTEXT#'.length)}#${row.revision}` : row.sk,
    }] : []
}

export class AgentStateMaintenance {
    constructor(
        private readonly repository = new ConversationRepository(),
        private readonly retentionResolver: AgentStateRetentionResolver = installedRetentionResolver,
    ) {}

    async deleteAsset(asset: Asset): Promise<void> {
        const importing = asset.documents?.conversation
            && await this.repository.read(
                conversationPartition(asset.organizationId, asset.assetId),
                'IMPORT',
            )

        if (
            asset.conversationRuntime !== 'deep-agents'
            && !asset.artifactRevisionState
            && !importing
        )
            return

        const conversation = asset.conversationRuntime === 'deep-agents' || Boolean(importing)
        const pk = conversation ? conversationPartition(asset.organizationId, asset.assetId) : `ORG#${encodeURIComponent(asset.organizationId)}#ARTIFACT#${asset.assetId}`
        // Removing META first fences every outstanding owner before any retained
        // state is released. The deleting Asset cannot be activated again.
        await this.repository.commit([
            this.repository.remove(pk, 'META'),
            ...(conversation ? [this.repository.remove(
                conversationWorkspacePartition(asset.organizationId, asset.originWorkspaceId),
                `CONVERSATION#${asset.assetId}`,
            )] : []),
        ])
        const payloads = new AgentPayloadStore(asset.organizationId, asset.assetId)
        let after: string | undefined

        do {
            const page = await this.repository.query<AgentStateRow>(
                pk,
                '',
                { after },
            )

            for (const row of page.items) {
                const retained = [...(row.retainedBlobs ?? [])]

                if (row.sk.startsWith('TURN#')) {
                    const turn = row as unknown as ConversationTurn

                    for (const [index, source] of turn.references.entries()) {
                        if (source.blobHash)
                            retained.push({
                                blobHash: source.blobHash,
                                referenceKey: `asset#${asset.assetId}#turn#${turn.turnId}#source#${index}`,
                            })
                    }
                }

                // Each reference is released in its own retryable transaction.
                // Grouping different references to the same Blob without
                // aggregation would target one DynamoDB item more than once.
                for (const reference of retained)
                    await this.releaseReference(asset.organizationId, reference)

                const specialized = this.retentionResolver(row)
                const owned = specialized.length
                    ? specialized
                    : retainedAgentStatePayloads(row)

                for (const item of owned) {
                    const release = await payloads.release(item.payload, item.ownerKey)

                    if (release.operations.length)
                        await this.repository.commit(release.operations)

                    await release.afterCommit()
                }

                const operations = [this.repository.remove(pk, row.sk)]

                if (row.sk.startsWith('DISPATCH#')) {
                    const dispatch = row as unknown as ConversationDispatch
                    operations.push(
                        this.repository.remove(
                            conversationDuePartition(asset.assetId),
                            conversationDueKey(dispatch),
                        ),
                    )
                }

                await this.repository.commit(operations)
            }

            after = page.cursor
        } while (after)
    }

    private async releaseReference(
        organizationId: string,
        reference: {
            blobHash: string
            referenceKey: string
        },
    ): Promise<void> {
        const removal = await buildBlobReferenceRemovalOperations({
            organizationId,
            ...reference,
        })

        if (removal.operations.length)
            await this.repository.commit(removal.operations)

        if (removal.deletionRequired)
            await enqueueBlobDeletion({
                organizationId,
                blobHash: reference.blobHash,
            })
    }
}
