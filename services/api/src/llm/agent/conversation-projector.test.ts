import { describe, expect, it, vi } from 'vitest'
import { DOCUMENT_TYPE, HeadlessProseMirrorEngine, type AssetStepEnvelope } from '@lixpi/prosemirror'
import { type Asset } from '@lixpi/constants'
import { AiChatProseMirrorStreamAssembler } from '../../prosemirror/ai-chat-stream-assembler.ts'
import { ConversationProjector, type ConversationProjectionPorts } from './conversation-projector.ts'
import { createConversationExecutionFixture } from './conversation-test-support.ts'

const projectionFixture = async () => {
    const fixture = await createConversationExecutionFixture()
    const {
        owner,
        repository,
        partition,
        payloads,
    } = fixture
    await repository.commit([repository.replace(partition, 'TURN#turn', {
        ...fixture.turn,
        fragment: {
            type: 'aiUserMessage',
            content: [{
                type: 'paragraph',
                content: [{
                    type: 'text',
                    text: 'Question',
                }],
            }],
        },
    })])
    const document = () => repository.read<{
        doc: object
        version: number
    }>(partition, 'TEST_DOCUMENT')
    const events: AssetStepEnvelope[] = []
    let losePublishAcknowledgement = false
    const transport = {
        getCurrentSubjectState: async () => ({
            subjectSeq: events.length,
            streamSequence: events.length,
            documentVersion: events.at(-1)?.version ?? 0,
        }),
        publishAiStreamStep: vi.fn(async input => {
            expect(input.expectedLastStreamSequence).toBe(events.length)
            const envelope: AssetStepEnvelope = {
                ...input,
                kind: 'STEP',
                origin: 'ai-stream',
                schemaVersion: 'prosemirror-schema-v1',
            }
            events.push(envelope)

            if (losePublishAcknowledgement) {
                losePublishAcknowledgement = false

                throw new Error('PUBLISH_ACKNOWLEDGEMENT_LOST')
            }

            return {
                envelope,
                streamSequence: events.length,
            }
        }),
    }
    const ports: ConversationProjectionPorts = {
        getAsset: async () => ({
            assetId: 'conversation',
            organizationId: 'org',
            conversationRuntime: 'deep-agents',
            states: { lifecycle: 'active' },
        } as Asset),
        loadSnapshot: async () => await document() as Awaited<ReturnType<ConversationProjectionPorts['loadSnapshot']>>,
        applySteps: async input => {
            const snapshot = await document()
            expect(input.baseVersion).toBe(snapshot?.version ?? 0)
            const engine = new HeadlessProseMirrorEngine({
                documentType: DOCUMENT_TYPE.ASSET_CONVERSATION,
                doc: snapshot?.doc,
                version: snapshot?.version ?? 0,
            })

            for (const step of input.steps)
                engine.applyStepJson(step)

            engine.doc.check()
            await input.commitWith([repository.replace(partition, 'TEST_DOCUMENT', {
                doc: engine.snapshot(),
                version: engine.version,
            })])

            return { version: engine.version } as Awaited<ReturnType<ConversationProjectionPorts['applySteps']>>
        },
        payloads: () => payloads,
        transport: () => transport,
    }
    const projector = new ConversationProjector(repository, ports)
    await owner.message({
        messageId: '0001-0-user',
        turnId: 'turn',
        role: 'user',
        text: 'Question',
        createdAt: 1000,
    })

    return {
        ...fixture,
        projector,
        document,
        events,
        transport,
        ports,
        losePublishAck: () => void (losePublishAcknowledgement = true),
    }
}

describe('conversation transcript projection', () => {
    it('projects configuration as a native emphasized paragraph and recovers it once after publication loss', async () => {
        const fixture = await projectionFixture()
        await fixture.projector.project(fixture.owner)
        await fixture.owner.message({
            messageId: '0001-2-settings-2',
            turnId: 'settings-2',
            role: 'configuration',
            text: 'Context: Explicit. During a run: Queue.',
            complete: true,
            createdAt: 1001,
        })
        fixture.losePublishAck()
        await expect(fixture.projector.project(fixture.owner)).rejects.toThrow('PUBLISH_ACKNOWLEDGEMENT_LOST')
        await new ConversationProjector(fixture.repository, fixture.ports).project(fixture.owner)
        const saved = await fixture.document()
        const engine = new HeadlessProseMirrorEngine({
            documentType: DOCUMENT_TYPE.ASSET_CONVERSATION,
            doc: saved!.doc,
        })
        const configuration = engine.doc.firstChild!.lastChild!
        expect(configuration.type.name).toBe('aiResponseMessage')
        expect(configuration.attrs.id).toBe('0001-2-settings-2')
        expect(configuration.textContent).toBe('Context: Explicit. During a run: Queue.')
        expect(configuration.firstChild!.firstChild!.marks.map(mark => mark.type.name)).toEqual(['em'])
        const replay = new HeadlessProseMirrorEngine({ documentType: DOCUMENT_TYPE.ASSET_CONVERSATION })

        for (const event of fixture.events)
            replay.applyStepJson(event.step)

        expect(replay.snapshot()).toEqual(saved!.doc)
        expect(fixture.events).toHaveLength(2)
        await fixture.projector.project(fixture.owner)
        expect(fixture.events).toHaveLength(2)
    })

    it('streams partial Markdown through native steps and replays the exact persisted document', async () => {
        const {
            owner,
            projector,
            document,
            events,
            repository,
            partition,
            database,
        } = await projectionFixture()
        await projector.project(owner)
        const message = {
            messageId: '0001-1-response',
            turnId: 'turn',
            role: 'assistant' as const,
            text: 'Hello **work',
            complete: false,
            createdAt: 1000,
        }
        await owner.partialMessage(message, message.text, 0)
        await projector.project(owner)
        const partial = await document()
        expect(JSON.stringify(partial?.doc)).toContain('work')
        expect(JSON.stringify(partial?.doc)).toContain('"isReceivingAnimation":true')
        await owner.message({
            ...message,
            text: 'Hello **workspace**.\n\nA second paragraph.',
            complete: true,
        })
        await projector.project(owner)
        const final = await document()
        const replay = new HeadlessProseMirrorEngine({ documentType: DOCUMENT_TYPE.ASSET_CONVERSATION })

        for (const event of events) {
            expect(event.version).toBe(replay.version + 1)
            replay.applyStepJson(event.step)
        }

        expect(replay.snapshot()).toEqual(final?.doc)
        expect(final?.version).toBe(events.length)
        expect(JSON.stringify(final?.doc)).toContain('"type":"strong"')
        expect(JSON.stringify(final?.doc)).toContain('A second paragraph.')
        expect(replay.doc.firstChild?.firstChild?.type.name).toBe('aiUserMessage')
        expect((await repository.query(partition, 'DOCUMENT_STEPS#')).items).toEqual([])
        const projection = database.commits.find(batch => batch.some(op => op.type === 'put' && op.item.sk === 'TEST_DOCUMENT'))!
        expect(projection.some(op => op.type === 'put' && String(op.item.sk).startsWith('DOCUMENT_STEPS#'))).toBe(true)
        expect(projection.some(op => op.type === 'put' && op.item.sk === 'META' && op.conditionExpression?.includes('#epoch'))).toBe(true)
        const count = events.length
        await projector.project(owner)
        expect(events).toHaveLength(count)
    })

    it('recovers a committed projection after transaction acknowledgement loss without appending again', async () => {
        const fixture = await projectionFixture()
        fixture.database.failAfterCommit = true
        await expect(fixture.projector.project(fixture.owner)).rejects.toThrow('TRANSACTION_ACKNOWLEDGEMENT_LOST')
        expect(fixture.events).toHaveLength(0)
        const recovered = new ConversationProjector(fixture.repository, fixture.ports)
        await recovered.project(fixture.owner)
        expect(fixture.events).toHaveLength(1)
        expect((await fixture.repository.query(fixture.partition, 'DOCUMENT_STEPS#')).items).toEqual([])
        await recovered.project(fixture.owner)
        expect(fixture.events).toHaveLength(1)
    })

    it('recovers lost publication acknowledgement from the authority version and releases retained payloads', async () => {
        const fixture = await projectionFixture()
        fixture.losePublishAck()
        await expect(fixture.projector.project(fixture.owner)).rejects.toThrow('PUBLISH_ACKNOWLEDGEMENT_LOST')
        expect(fixture.events).toHaveLength(1)
        await new ConversationProjector(fixture.repository, fixture.ports).project(fixture.owner)
        expect(fixture.events).toHaveLength(1)
        expect(fixture.transport.publishAiStreamStep).toHaveBeenCalledOnce()
        expect(fixture.payloads.released).toEqual(['DOCUMENT_STEPS#0000000000000001'])
    })

    it('rejects a stale owner before publishing a pending committed projection', async () => {
        const fixture = await projectionFixture()
        fixture.database.failAfterCommit = true
        await expect(fixture.projector.project(fixture.owner)).rejects.toThrow('TRANSACTION_ACKNOWLEDGEMENT_LOST')
        fixture.clock.now += 100_000
        await expect(fixture.projector.project(fixture.owner)).rejects.toThrow('CONVERSATION_OWNER_LOST')
        expect(fixture.events).toEqual([])
    })

    it('starts new steps at a migrated snapshot version ahead of the retained stream', async () => {
        const fixture = await projectionFixture()
        const engine = new HeadlessProseMirrorEngine({ documentType: DOCUMENT_TYPE.ASSET_CONVERSATION })
        await fixture.repository.commit([fixture.repository.replace(fixture.partition, 'TEST_DOCUMENT', {
            doc: engine.snapshot(),
            version: 18,
        })])
        fixture.events.push({
            version: 17,
            subjectSeq: 1,
        } as AssetStepEnvelope)
        await fixture.projector.project(fixture.owner)
        expect(fixture.events.at(-1)?.version).toBe(19)
        expect((await fixture.document())?.version).toBe(19)
    })

    it('parses markdown with a stable assistant ID without opening a NATS transport', async () => {
        const assembler = new AiChatProseMirrorStreamAssembler({
            organizationId: 'org',
            workspaceId: 'workspace',
            aiChatThreadId: 'conversation',
            leaseId: '',
            leaseHolderId: '',
            provider: 'anthropic',
            projectionOnly: true,
            responseMessageId: '0000000000000001-1-response-00000',
        })
        assembler.parseToken('Hello **workspace**.\n\nA second paragraph.')
        await assembler.end()
        const document = assembler.snapshotForProjection() as { content: Array<{ content: Array<{
            attrs: { id: string }
            content: unknown[]
        }> }> }
        const response = document.content[0].content[0]
        expect(response.attrs.id).toBe('0000000000000001-1-response-00000')
        expect(JSON.stringify(response.content)).toContain('workspace')
        expect(JSON.stringify(response.content)).toContain('second paragraph')
    })
})
