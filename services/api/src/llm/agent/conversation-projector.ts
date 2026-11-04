import { createHash } from 'node:crypto'
import {
    type ConversationMessage,
    type ConversationMessageNode,
    type ConversationTurn,
} from '@lixpi/constants'
import {
    DOCUMENT_TYPE,
    HeadlessProseMirrorEngine,
    aiResponseMessageNodeType,
} from '@lixpi/prosemirror'
import { getAssetRecord } from '../../models/asset.ts'
import AssetDocumentService from '../../services/asset-document-service.ts'
import { AiChatProseMirrorStreamAssembler } from '../../prosemirror/ai-chat-stream-assembler.ts'
import { AssetProseMirrorStepTransport } from '../../prosemirror/asset-prosemirror-step-transport.ts'
import {
    AgentPayloadStore,
    type AgentPayload,
    type AgentPayloadPort,
} from './agent-payload-store.ts'
import {
    type ConversationOwner,
} from './conversation-owner.ts'
import {
    conversationSequenceKey,
    type ConversationRepository,
} from './conversation-repository.ts'

type ProjectionBatch = {
    baseVersion: number
    steps: object[]
}

type ProjectionRecord = {
    sk: string
    payload: AgentPayload
}

export type ConversationProjectionPorts = {
    getAsset: typeof getAssetRecord
    loadSnapshot: typeof AssetDocumentService.loadSnapshot
    applySteps: typeof AssetDocumentService.applySystemSteps
    transport: () => Pick<AssetProseMirrorStepTransport, 'getCurrentSubjectState' | 'publishAiStreamStep'>
    payloads: (
        organizationId: string,
        assetId: string,
    ) => AgentPayloadPort
}

const projectionPorts: ConversationProjectionPorts = {
    getAsset: getAssetRecord,
    loadSnapshot: AssetDocumentService.loadSnapshot,
    applySteps: AssetDocumentService.applySystemSteps,
    transport: () => AssetProseMirrorStepTransport.fromSingleton(),
    payloads: (organizationId, assetId) => new AgentPayloadStore(organizationId, assetId),
}

// Messages are accepted durably before projection. The document pointer and its
// step publication record commit together under the conversation owner fence.
export class ConversationProjector {
    constructor(
        private readonly repository: ConversationRepository,
        private readonly ports: ConversationProjectionPorts = projectionPorts,
    ) {}

    async project(owner: ConversationOwner): Promise<void> {
        await this.drain(owner)
        const meta = await owner.read()
        const asset = await this.ports.getAsset(meta.conversationAssetId)

        if (
            !asset
            || asset.organizationId !== meta.organizationId
            || asset.conversationRuntime !== 'deep-agents'
            || asset.states.lifecycle === 'deleting'
        )
            throw new Error('AGENT_CONVERSATION_ASSET_UNAVAILABLE')

        const snapshot = await this.ports.loadSnapshot(asset, 'conversation')
        const previous = snapshot?.doc as ConversationMessageNode | undefined
        const previousNodes = previous?.content?.[0]?.content ?? []
        const byId = new Map(
            previousNodes.map(node => [String(node.attrs?.id ?? ''), node]),
        )
        const content: ConversationMessageNode[] = []
        let after: string | undefined

        do {
            const page = await this.repository.query<ConversationMessage>(
                owner.partition,
                'MESSAGE#',
                { after },
            )

            for (const message of page.items) {
                const existing = byId.get(message.messageId)

                if (
                    existing
                    && (message.role === 'user' || (message.complete !== false && existing.attrs?.isReceivingAnimation === false))
                ) {
                    content.push(existing)

                    continue
                }

                if (message.role === 'configuration') {
                    content.push({
                        type: aiResponseMessageNodeType,
                        attrs: {
                            id: message.messageId,
                            isInitialRenderAnimation: false,
                            isReceivingAnimation: false,
                        },
                        content: [{
                            type: 'paragraph',
                            content: [{
                                type: 'text',
                                text: message.text,
                                marks: [{ type: 'em' }],
                            }],
                        }],
                    })

                    continue
                }

                const turn = await this.repository.read<ConversationTurn>(owner.partition, `TURN#${message.turnId}`)

                if (
                    !turn
                    || turn.commandSeq > meta.commandSeq
                )
                    continue

                if (message.role === 'user') {
                    content.push({
                        ...turn.fragment,
                        attrs: {
                            ...turn.fragment.attrs,
                            id: message.messageId,
                            createdAt: message.createdAt,
                            referenceNodeIds: [],
                        },
                    })
                } else {
                    const assembler = new AiChatProseMirrorStreamAssembler({
                        organizationId: meta.organizationId,
                        workspaceId: meta.workspaceId,
                        aiChatThreadId: meta.conversationAssetId,
                        leaseId: '',
                        leaseHolderId: '',
                        provider: 'anthropic',
                        projectionOnly: true,
                        responseMessageId: message.messageId,
                    })
                    assembler.parseToken(message.text)
                    await assembler.end()
                    const parsed = assembler.snapshotForProjection() as ConversationMessageNode
                    const response = parsed.content?.[0]?.content?.[0] ?? { type: aiResponseMessageNodeType }
                    content.push({
                        ...response,
                        attrs: {
                            ...response.attrs,
                            id: message.messageId,
                            isInitialRenderAnimation: false,
                            isReceivingAnimation: message.complete === false,
                        },
                    })
                }
            }

            after = page.cursor
        } while (after)

        const engine = new HeadlessProseMirrorEngine({
            documentType: DOCUMENT_TYPE.ASSET_CONVERSATION,
            doc: snapshot?.doc,
            version: snapshot?.version ?? 0,
        })
        const next = engine.schema.nodeFromJSON({
            type: 'doc',
            content: [{
                type: 'aiChatThread',
                attrs: { threadId: meta.conversationAssetId },
                content,
            }],
        })
        next.check()
        const start = engine.doc.content.findDiffStart(next.content)

        if (start === null)
            return

        const end = engine.doc.content.findDiffEnd(next.content)!
        const overlap = start - Math.min(end.a, end.b)
        const previousEnd = end.a + Math.max(overlap, 0)
        const nextEnd = end.b + Math.max(overlap, 0)
        const transaction = engine.state.tr.replace(
            start,
            previousEnd,
            next.slice(start, nextEnd),
        )

        if (!transaction.doc.eq(next))
            throw new Error('AGENT_DOCUMENT_PROJECTION_MISMATCH')

        const batch: ProjectionBatch = {
            baseVersion: engine.version,
            steps: transaction.steps.map(step => step.toJSON()),
        }
        const version = engine.version + batch.steps.length
        const sk = `DOCUMENT_STEPS#${conversationSequenceKey(version)}`
        const payloads = this.ports.payloads(meta.organizationId, meta.conversationAssetId)
        const prepared = await payloads.prepare(
            'json',
            Buffer.from(
                JSON.stringify(batch),
            ),
            sk,
        )
        await this.ports.applySteps({
            asset,
            role: 'conversation',
            baseVersion: batch.baseVersion,
            steps: batch.steps,
            commitWith: async operations => {
                await owner.mutate(
                    current => ({
                        ...current,
                        documentRevision: version,
                        projectedCommandSeq: meta.commandSeq,
                    }),
                    () => [
                        ...operations,
                        ...prepared.operations,
                        this.repository.put(
                            owner.partition,
                            sk,
                            { payload: prepared.payload },
                        ),
                    ],
                )
            },
        })
        await this.drain(owner)
    }

    private async drain(owner: ConversationOwner): Promise<void> {
        let after: string | undefined

        do {
            const page = await this.repository.query<ProjectionRecord>(
                owner.partition,
                'DOCUMENT_STEPS#',
                { after },
            )

            for (const record of page.items) {
                const meta = await owner.read()
                const payloads = this.ports.payloads(meta.organizationId, meta.conversationAssetId)
                const batch = JSON.parse(
                    Buffer.from(await payloads.read(record.payload)).toString('utf8'),
                ) as ProjectionBatch
                const coordinate = {
                    organizationId: meta.organizationId,
                    assetId: meta.conversationAssetId,
                    role: 'conversation' as const,
                }
                const transport = this.ports.transport()
                let state = await transport.getCurrentSubjectState(coordinate)

                for (const [index, step] of batch.steps.entries()) {
                    const version = batch.baseVersion + index + 1

                    if (state.documentVersion >= version)
                        continue

                    // A migrated or compacted snapshot may be ahead of the
                    // retained stream. Its first new step starts at that base.
                    if (
                        index > 0
                        && state.documentVersion !== version - 1
                    )
                        throw new Error('AGENT_DOCUMENT_PUBLICATION_CONFLICT')

                    await owner.fences()
                    const hash = createHash('sha256').update(
                        JSON.stringify(step),
                    ).digest('hex')
                    const result = await transport.publishAiStreamStep({
                        ...coordinate,
                        expectedLastStreamSequence: state.streamSequence,
                        subjectSeq: state.subjectSeq + 1,
                        version,
                        step,
                        msgId: `agent-document:${meta.conversationAssetId}:${version}:${hash}`,
                        aiProvider: 'anthropic',
                    })
                    state = {
                        subjectSeq: result.envelope.subjectSeq,
                        streamSequence: result.streamSequence,
                        documentVersion: version,
                    }
                }

                const release = await payloads.release(record.payload, record.sk)
                await owner.mutate(
                    current => current,
                    () => [
                        this.repository.remove(owner.partition, record.sk),
                        ...release.operations,
                    ],
                )
                await release.afterCommit()
            }

            after = page.cursor
        } while (after)
    }

    responseId(
        turn: ConversationTurn,
        index = 0,
    ): string {
        return `${conversationSequenceKey(turn.commandSeq)}-1-response-${String(index).padStart(5, '0')}`
    }
}
