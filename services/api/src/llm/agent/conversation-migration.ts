import {
    createConversationSettings,
    getDynamoDbTableStageName,
    type Asset,
    type ConversationMessage,
    type ConversationMessageNode,
    type ConversationTurn,
} from '@lixpi/constants'
import {
    isTransactionConditionalCheckFailure,
    type TransactOperation,
} from '@lixpi/dynamodb-service'
import {
    DOCUMENT_TYPE,
    HeadlessProseMirrorEngine,
} from '@lixpi/prosemirror'
import AssetModel, { buildAssetScopeAndOwnerKey } from '../../models/asset.ts'
import AssetDocumentService from '../../services/asset-document-service.ts'
import { AssetProseMirrorStepTransport } from '../../prosemirror/asset-prosemirror-step-transport.ts'
import {
    AgentPayloadStore,
    type AgentPayload,
    type AgentPayloadPort,
} from './agent-payload-store.ts'
import {
    conversationMessageText,
    conversationPayloadHash,
} from './conversation-protocol.ts'
import {
    conversationPartition,
    conversationSequenceKey,
    conversationWorkspacePartition,
    type ConversationMeta,
    type ConversationRepository,
} from './conversation-repository.ts'
import {
    type ConversationAccess,
} from './conversation-service.ts'

type ImportRecord = {
    revision: number
    sourceHash: string
    sourceVersion: number
    payload: AgentPayload
    nextIndex: number
}
type ImportHistory = {
    doc: ConversationMessageNode
    messages: Array<{
        key: string
        message: ConversationMessage
        turn?: ConversationTurn
    }>
    commandSeq: number
}
export type ConversationMigrationPorts = {
    list: (
        access: ConversationAccess,
        cursor?: string,
    ) => Promise<{
        items: Array<{ assetId: string }>
        cursor?: string
    }>
    read: (
        access: ConversationAccess,
        assetId: string,
    ) => Promise<Asset | undefined>
    snapshot: (asset: Asset) => Promise<{
        doc: object
        version: number
        blobHash: string
    } | null>
    liveVersion: (asset: Asset) => Promise<number>
    payloads: (asset: Asset) => AgentPayloadPort
    activate: (
        asset: Asset,
        doc: ConversationMessageNode,
        commit: (operations: TransactOperation[]) => Promise<void>,
    ) => Promise<void>
    now: () => number
}

const requester = (access: ConversationAccess) => ({
    userId: access.userId,
    workspaceIds: [access.workspaceId],
    editableWorkspaceIds: [],
    organizationIds: [access.organizationId],
})
const defaultPorts = (): ConversationMigrationPorts => ({
    list: async (access, cursor) => await AssetModel.listAvailable({
        scopeAndOwners: [buildAssetScopeAndOwnerKey('workspace', access.workspaceId)],
        principalId: access.userId,
        organizationIds: [access.organizationId],
        limit: 5,
        cursor,
    }),
    read: async (access, assetId) => {
        const asset = await AssetModel.get({
            assetId,
            requester: requester(access),
        })

        return 'error' in asset ? undefined : asset
    },
    snapshot: asset => AssetDocumentService.loadSnapshot(asset, 'conversation'),
    liveVersion: async asset => (await AssetProseMirrorStepTransport.fromSingleton().getCurrentSubjectState({
        organizationId: asset.organizationId,
        assetId: asset.assetId,
        role: 'conversation',
    })).documentVersion,
    payloads: asset => new AgentPayloadStore(asset.organizationId, asset.assetId),
    activate: async (
        asset,
        doc,
        commit,
    ) => {
        await AssetDocumentService.replaceSystemSnapshot({
            asset: {
                ...asset,
                conversationRuntime: 'deep-agents',
            },
            role: 'conversation',
            doc,
            version: asset.documents.conversation!.version + 1,
            commitWith: async operations => await commit(
                operations.map(
                    operation => operation.type === 'update'
                        && operation.key.assetId === asset.assetId
                        ? {
                            ...operation,
                            updates: {
                                ...operation.updates,
                                conversationRuntime: 'deep-agents',
                            },
                        }
                        : operation,
                ),
            ),
        })
    },
    now: () => Date.now(),
})

// History rows are staged behind an import marker. They become visible only
// when the Asset runtime flag, META and workspace membership commit together.
export class ConversationMigration {
    constructor(
        private readonly repository: ConversationRepository,
        private readonly ports: ConversationMigrationPorts = defaultPorts(),
    ) {}

    async migrateWorkspace(access: ConversationAccess): Promise<{
        migrated: number
        skipped: number
        pending: number
    }> {
        const workspace = conversationWorkspacePartition(access.organizationId, access.workspaceId)
        const scan = await this.repository.read<{ cursor?: string }>(workspace, 'LEGACY_IMPORT_CURSOR')
        const page = await this.ports.list(access, scan?.cursor)
        const result = {
            migrated: 0,
            skipped: 0,
            pending: 0,
        }

        for (const item of page.items) {
            try {
                const status = await this.migrateAsset(access, item.assetId)
                result[status]++
            } catch (error) {
                if (!isTransactionConditionalCheckFailure(error))
                    throw error

                result.pending++
            }
        }

        if (!result.pending)
            await this.repository.commit([...access.fences, this.repository.replace(
                workspace,
                'LEGACY_IMPORT_CURSOR',
                page.cursor ? { cursor: page.cursor } : {},
            )])

        return result
    }

    async migrateAsset(
        access: ConversationAccess,
        assetId: string,
    ): Promise<'migrated' | 'skipped' | 'pending'> {
        const asset = await this.ports.read(access, assetId)
        const now = this.ports.now()

        if (
            !asset
            || asset.organizationId !== access.organizationId
            || asset.originWorkspaceId !== access.workspaceId
            || asset.conversationRuntime === 'deep-agents'
            || asset.states.lifecycle !== 'active'
            || asset.states.conversation === 'receiving'
            || (asset.editLease?.expiresAt ?? 0) > now
            || !asset.documents.conversation
        )
            return 'skipped'

        const pointer = asset.documents.conversation

        if (
            pointer.byteSize > 8 * 1024 * 1024
            || (await this.ports.liveVersion(asset)) > pointer.version
        )
            return 'skipped'

        const pk = conversationPartition(access.organizationId, assetId)

        if (await this.repository.read(pk, 'META'))
            return 'skipped'

        let marker = await this.repository.read<ImportRecord>(pk, 'IMPORT')
        const payloads = this.ports.payloads(asset)

        if (
            marker
            && (marker.sourceHash !== pointer.blobHash || marker.sourceVersion !== pointer.version)
        ) {
            await this.resetImport(
                pk,
                marker,
                payloads,
            )

            return 'pending'
        }

        if (!marker) {
            const snapshot = await this.ports.snapshot(asset)

            if (
                !snapshot
                || snapshot.blobHash !== pointer.blobHash
                || snapshot.version !== pointer.version
            )
                return 'pending'

            const bytes = Buffer.from(
                JSON.stringify(snapshot.doc),
            )

            if (
                bytes.byteLength > 8 * 1024 * 1024
                || !this.history(asset, snapshot.doc as ConversationMessageNode)
            )
                return 'skipped'

            const prepared = await payloads.prepare(
                'json',
                bytes,
                'IMPORT',
            )
            marker = {
                revision: 1,
                sourceHash: pointer.blobHash,
                sourceVersion: pointer.version,
                payload: prepared.payload,
                nextIndex: 0,
            }
            await this.repository.commit([...access.fences, this.assetFence(asset, now), this.absentMeta(pk), ...prepared.operations, this.repository.put(
                pk,
                'IMPORT',
                marker,
            )])
        }

        const frozen = JSON.parse(
            Buffer.from(await payloads.read(marker.payload)).toString('utf8'),
        ) as ConversationMessageNode
        const history = this.history(asset, frozen)

        if (!history)
            return 'skipped'

        const batch: ImportHistory['messages'] = []
        let batchBytes = 0

        for (const message of history.messages.slice(marker.nextIndex, marker.nextIndex + 20)) {
            const size = Buffer.byteLength(
                JSON.stringify(message),
            )

            if (
                batch.length
                && batchBytes + size > 2 * 1024 * 1024
            )
                break

            batch.push(message)
            batchBytes += size
        }

        if (batch.length) {
            const next = {
                ...marker,
                revision: marker.revision + 1,
                nextIndex: marker.nextIndex + batch.length,
            }
            const operations = batch.flatMap(
                ({
                    key,
                    message,
                    turn,
                }) => [this.repository.replace(
                    pk,
                    `MESSAGE#${key}`,
                    message,
                ), ...(turn ? [this.repository.replace(
                    pk,
                    `TURN#${turn.turnId}`,
                    turn,
                )] : [])],
            )
            await this.repository.commit([...access.fences, this.assetFence(asset, now), this.absentMeta(pk), ...operations, this.repository.put(
                pk,
                'IMPORT',
                next,
                marker.revision,
            )])
            marker = next
        }

        if (marker.nextIndex < history.messages.length)
            return 'pending'

        const meta: ConversationMeta = {
            protocolVersion: 1,
            organizationId: access.organizationId,
            workspaceId: access.workspaceId,
            conversationAssetId: assetId,
            ownerUserId: asset.ownerUserId,
            creationHash: `legacy-${marker.sourceHash}`,
            title: asset.title,
            activated: true,
            revision: 1,
            settings: createConversationSettings(),
            settingsRevision: 1,
            queueRevision: 1,
            queuePaused: false,
            commandSeq: history.commandSeq,
            eventSeq: 0,
            projectedCommandSeq: history.commandSeq,
            documentRevision: pointer.version + 1,
            epoch: 0,
            checkpointNamespace: 'context-1',
            createdAt: asset.createdAt,
            updatedAt: now,
        }
        await this.ports.activate(
            asset,
            history.doc,
            async operations => {
                const fenced = operations.map(
                    operation => operation.type === 'update'
                        && operation.key.assetId === assetId
                        ? this.guardActivation(operation, now)
                        : operation,
                )
                await this.repository.commit([...access.fences, ...fenced, this.importFence(pk, marker!.revision), this.repository.put(
                    pk,
                    'META',
                    meta,
                ), this.repository.replace(
                    conversationWorkspacePartition(access.organizationId, access.workspaceId),
                    `CONVERSATION#${assetId}`,
                    { conversationAssetId: assetId },
                )])
            },
        )

        return 'migrated'
    }

    private history(
        asset: Asset,
        source: ConversationMessageNode,
    ): ImportHistory | undefined {
        const doc = structuredClone(source)

        if (
            doc.type !== 'doc'
            || doc.content?.length !== 1
            || doc.content[0].type !== 'aiChatThread'
        )
            return undefined

        new HeadlessProseMirrorEngine({
            documentType: DOCUMENT_TYPE.ASSET_CONVERSATION,
            doc,
            version: asset.documents.conversation!.version,
        })
        const thread = doc.content[0]
        const nodes = thread.content ?? []

        if (
            nodes.length > 10000
            || nodes.some(
                node => Buffer.byteLength(
                    JSON.stringify(node),
                ) > 240000,
            )
        )
            return undefined

        const active = (node: ConversationMessageNode): boolean => node.attrs?.isStreaming === true || node.attrs?.isReceivingAnimation === true || node.attrs?.isPending === true || Boolean(
            node.content?.some(active),
        )

        if (nodes.some(active))
            return undefined

        thread.attrs = {
            ...thread.attrs,
            threadId: asset.assetId,
        }
        const ids = new Set<string>()
        const messages: ImportHistory['messages'] = []
        let commandSeq = 0
        let turnId = ''

        for (const [index, node] of nodes.entries()) {
            const originalId = typeof node.attrs?.id === 'string' ? node.attrs.id : ''
            const messageId = originalId
                && !ids.has(originalId)
                ? originalId
                : `legacy-${conversationPayloadHash({
                    assetId: asset.assetId,
                    index,
                }).slice(0, 32)}`
            ids.add(messageId)
            node.attrs = {
                ...node.attrs,
                id: messageId,
            }
            const createdAt = Number.isSafeInteger(node.attrs.createdAt)
                && Number(node.attrs.createdAt) > 0
                ? Number(node.attrs.createdAt)
                : asset.createdAt + index
            let turn: ConversationTurn | undefined

            if (
                node.type === 'aiUserMessage'
                || !turnId
            ) {
                commandSeq++
                turnId = `legacy-${conversationPayloadHash({
                    assetId: asset.assetId,
                    index,
                    role: 'turn',
                }).slice(0, 32)}`
                turn = {
                    turnId,
                    clientMessageId: `legacy-${turnId}`,
                    commandSeq,
                    userId: asset.ownerUserId,
                    fragment: node.type === 'aiUserMessage' ? node : {
                        type: 'aiUserMessage',
                        content: [{ type: 'paragraph' }],
                    },
                    references: [],
                    settings: createConversationSettings(),
                    settingsRevision: 1,
                    midRunPolicy: 'queue',
                    state: 'completed',
                    createdAt,
                }
            }

            messages.push({
                key: `${conversationSequenceKey(commandSeq)}-${node.type === 'aiUserMessage' ? '0' : '1'}-legacy-${conversationSequenceKey(index)}`,
                message: {
                    messageId,
                    turnId,
                    role: node.type === 'aiUserMessage' ? 'user' : 'assistant',
                    text: conversationMessageText(node),
                    complete: true,
                    createdAt,
                },
                ...(turn ? { turn } : {}),
            })
        }

        return {
            doc,
            messages,
            commandSeq,
        }
    }

    private assetFence(
        asset: Asset,
        now: number,
    ): TransactOperation {
        const guarded = this.guardActivation(
            {
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
            },
            now,
        )

        return guarded
    }

    private guardActivation(
        operation: TransactOperation,
        now: number,
    ): TransactOperation {
        return {
            ...operation,
            conditionExpression: `${operation.conditionExpression} AND attribute_not_exists(#runtime) AND (attribute_not_exists(#lease) OR #lease.#expiry <= :now) AND #states.#conversation <> :receiving`,
            expressionAttributeNames: {
                ...operation.expressionAttributeNames,
                '#runtime': 'conversationRuntime',
                '#lease': 'editLease',
                '#expiry': 'expiresAt',
                '#states': 'states',
                '#conversation': 'conversation',
            },
            expressionAttributeValues: {
                ...operation.expressionAttributeValues,
                ':now': now,
                ':receiving': 'receiving',
            },
        }
    }

    private absentMeta(pk: string): TransactOperation {
        return {
            type: 'check',
            tableName: this.repository.tableName,
            key: {
                pk,
                sk: 'META',
            },
            conditionExpression: 'attribute_not_exists(#pk)',
            expressionAttributeNames: { '#pk': 'pk' },
        }
    }

    private importFence(
        pk: string,
        revision: number,
    ): TransactOperation {
        return {
            type: 'check',
            tableName: this.repository.tableName,
            key: {
                pk,
                sk: 'IMPORT',
            },
            conditionExpression: '#revision = :revision',
            expressionAttributeNames: { '#revision': 'revision' },
            expressionAttributeValues: { ':revision': revision },
        }
    }

    private async resetImport(
        pk: string,
        marker: ImportRecord,
        payloads: AgentPayloadPort,
    ): Promise<void> {
        for (const prefix of ['MESSAGE#', 'TURN#']) {
            const page = await this.repository.query<{ sk: string }>(
                pk,
                prefix,
                { limit: 20 },
            )

            if (page.items.length) {
                await this.repository.commit(
                    [this.absentMeta(pk), this.importFence(pk, marker.revision), ...page.items.map(row => this.repository.remove(pk, row.sk))],
                )

                return
            }
        }

        const release = await payloads.release(marker.payload, 'IMPORT')
        await this.repository.commit([this.absentMeta(pk), ...release.operations, {
            ...this.repository.remove(pk, 'IMPORT'),
            conditionExpression: '#revision = :revision',
            expressionAttributeNames: { '#revision': 'revision' },
            expressionAttributeValues: { ':revision': marker.revision },
        }])
        await release.afterCommit()
    }
}
