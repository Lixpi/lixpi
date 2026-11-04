import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    CONVERSATION_RESPONSE_MAX_BYTES,
    type ConversationSubmitRequest,
} from '@lixpi/constants'
import {
    type TransactOperation,
} from '@lixpi/dynamodb-service'
import {
    ConversationRepository,
    conversationPartition,
    conversationSequenceKey,
    conversationWorkspacePartition,
    type ConversationMeta,
} from './conversation-repository.ts'
import {
    ConversationService,
    type ConversationServicePorts,
} from './conversation-service.ts'

class AtomicConversationDatabase {
    readonly rows = new Map<string, Record<string, unknown>>()
    readonly commits: TransactOperation[][] = []

    private key(item: Record<string, unknown>): string {
        return `${item.pk}|${item.sk}`
    }

    readonly getItem = async ({ key }: { key: Record<string, unknown> }) => structuredClone(this.rows.get(this.key(key)))

    readonly queryItems = async (request: {
        keyConditions: { pk: string }
        sortKeyCondition?: { value: string }
        exclusiveStartKey?: { sk: string }
        scanIndexForward: boolean
        limit: number
    }) => {
        const matching = [...this.rows.values()].filter(row =>
            row.pk === request.keyConditions.pk
            && String(row.sk).startsWith(request.sortKeyCondition?.value ?? '')
            && (!request.exclusiveStartKey || (request.scanIndexForward ? String(row.sk) > request.exclusiveStartKey.sk : String(row.sk) < request.exclusiveStartKey.sk)),
        ).sort((left, right) => String(left.sk).localeCompare(String(right.sk)))

        if (!request.scanIndexForward)
            matching.reverse()

        const items = matching.slice(0, request.limit)

        return {
            items: structuredClone(items),
            ...(matching.length > items.length ? { lastEvaluatedKey: { sk: items.at(-1)!.sk } } : {}),
        }
    }

    readonly transactWrite = async ({ operations }: { operations: TransactOperation[] }) => {
        const keys = new Set<string>()

        for (const operation of operations) {
            const key = this.key(operation.type === 'put' ? operation.item : operation.key)

            if (keys.has(key))
                throw new Error('Duplicate transaction target')

            keys.add(key)
            const existing = this.rows.get(key)
            const conflict = operation.conditionExpression?.startsWith('attribute_not_exists')
                ? Boolean(existing)
                : operation.conditionExpression === '#revision = :revision'
                    ? existing?.revision !== operation.expressionAttributeValues?.[':revision']
                    : false

            if (conflict) {
                const error = new Error('Concurrent transaction')
                error.name = 'ConditionalCheckFailedException'

                throw error
            }
        }

        for (const operation of operations) {
            if (operation.type === 'put')
                this.rows.set(this.key(operation.item), structuredClone(operation.item))

            if (operation.type === 'delete')
                this.rows.delete(this.key(operation.key))
        }

        this.commits.push(structuredClone(operations))
    }
}

describe('durable conversation acceptance', () => {
    let database: AtomicConversationDatabase
    let repository: ConversationRepository
    let service: ConversationService
    let ports: ConversationServicePorts
    let conversationAssetId: string
    let nextId: number

    const submit = (clientMessageId = 'message-1'): ConversationSubmitRequest => ({
        protocolVersion: 1,
        workspaceId: 'workspace-1',
        conversationAssetId,
        clientMessageId,
        settingsRevision: 1,
        references: [],
        fragment: {
            type: 'aiUserMessage',
            content: [{
                type: 'paragraph',
                content: [{
                    type: 'text',
                    text: 'hi',
                }],
            }],
        },
    })

    beforeEach(async () => {
        database = new AtomicConversationDatabase()
        repository = new ConversationRepository(database as unknown as ConstructorParameters<typeof ConversationRepository>[0], 'Conversations')
        nextId = 0
        ports = {
            authorize: vi.fn(async (workspaceId, userId) => {
                if (userId !== 'user-1')
                    throw new Error('ACCESS_DENIED')

                return {
                    workspaceId,
                    organizationId: 'org-1',
                    userId,
                    fences: [],
                }
            }),
            resolveReferences: vi.fn(async () => []),
            activate: vi.fn(async (_meta, operations) => await repository.commit(operations)),
            publish: vi.fn(async () => {}),
            createId: () => `id-${++nextId}`,
            now: () => 1000,
        }
        service = new ConversationService(repository, ports)
        const reservation = await service.create({
            protocolVersion: 1,
            workspaceId: 'workspace-1',
            clientConversationId: 'draft-1',
        }, 'user-1')
        conversationAssetId = reservation.conversationAssetId
    })

    it('reserves without activating an Asset and lists it only after accepted content', async () => {
        expect(ports.activate).not.toHaveBeenCalled()
        expect((await service.list({
            protocolVersion: 1,
            workspaceId: 'workspace-1',
        }, 'user-1')).conversations).toEqual([])
        await service.submit(submit(), 'user-1')
        expect(ports.activate).toHaveBeenCalledTimes(1)
        expect((await service.list({
            protocolVersion: 1,
            workspaceId: 'workspace-1',
        }, 'user-1')).conversations).toHaveLength(1)
    })

    it('returns the original identity on create retry and rejects changed initial settings', async () => {
        const request = {
            protocolVersion: 1 as const,
            workspaceId: 'workspace-1',
            clientConversationId: 'draft-1',
        }
        expect((await service.create(request, 'user-1')).conversationAssetId).toBe(conversationAssetId)
        await expect(service.create({
            ...request,
            settings: { contextMode: 'discovery' },
        }, 'user-1')).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    })

    it('commits acceptance, event, idempotency receipt and dispatch in one transaction', async () => {
        const acknowledgement = await service.submit(submit(), 'user-1')
        expect(acknowledgement).toMatchObject({
            status: 'accepted',
            documentRevision: 0,
            projectionPending: true,
        })
        const writes = database.commits.at(-1)!.filter(operation => operation.type === 'put').map(operation => String(operation.item.sk))
        expect(writes).toEqual(expect.arrayContaining(['CLIENT#message-1', 'TURN#id-1', 'COMMAND#0000000000000001', 'EVENT#0000000000000001', 'DISPATCH#id-1']))
        expect(database.commits.at(-1)!.some(operation => operation.type === 'put' && String(operation.item.pk).startsWith('DISPATCH#'))).toBe(true)
    })

    it('recovers a lost acknowledgement and rejects reuse for changed content', async () => {
        const first = await service.submit(submit(), 'user-1')
        expect(await service.submit(submit(), 'user-1')).toEqual({
            ...first,
            status: 'duplicate',
        })
        const changed = submit()
        changed.fragment.content![0].content![0].text = 'different'
        expect(await service.submit(changed, 'user-1')).toMatchObject({
            status: 'rejected',
            error: { code: 'CONVERSATION_IDEMPOTENCY_CONFLICT' },
        })
        const snapshot = await service.get({
            protocolVersion: 1,
            workspaceId: 'workspace-1',
            conversationAssetId,
            clientMessageId: 'message-1',
        }, 'user-1')
        expect(snapshot.acknowledgement).toEqual(first)
        expect(snapshot.queuedTurns).toHaveLength(1)
    })

    it('accepts a concurrent duplicate only once', async () => {
        const results = await Promise.all([service.submit(submit(), 'user-1'), service.submit(submit(), 'user-1')])
        expect(results.map(result => result.status).sort()).toEqual(['accepted', 'duplicate'])
        expect([...database.rows.values()].filter(row => String(row.sk).startsWith('COMMAND#'))).toHaveLength(1)
    })

    it('retains only the reservation after activation fails', async () => {
        vi.mocked(ports.activate).mockRejectedValueOnce(new Error('Storage unavailable'))
        await expect(service.submit(submit(), 'user-1')).rejects.toThrow('Storage unavailable')
        expect(database.rows.size).toBe(1)
        expect(await service.submit(submit(), 'user-1')).toMatchObject({ status: 'accepted' })
    })

    it('rejects stale settings without freezing or dispatching work', async () => {
        await service.settings({
            protocolVersion: 1,
            workspaceId: 'workspace-1',
            conversationAssetId,
            expectedRevision: 1,
            patch: { contextMode: 'mixed' },
        }, 'user-1')
        expect(await service.submit(submit(), 'user-1')).toMatchObject({
            status: 'rejected',
            error: {
                code: 'STALE_CONVERSATION_SETTINGS',
                currentRevision: 2,
            },
        })
        expect(ports.resolveReferences).not.toHaveBeenCalled()
        expect(ports.activate).not.toHaveBeenCalled()
    })

    it('keeps conversation sequences independent and rejects workspace substitution', async () => {
        await service.submit(submit(), 'user-1')
        const second = await service.create({
            protocolVersion: 1,
            workspaceId: 'workspace-1',
            clientConversationId: 'draft-2',
        }, 'user-1')
        expect(await service.submit({
            ...submit(),
            conversationAssetId: second.conversationAssetId,
        }, 'user-1')).toMatchObject({
            commandSeq: 1,
            eventSeq: 1,
        })
        await expect(service.get({
            protocolVersion: 1,
            workspaceId: 'workspace-2',
            conversationAssetId,
        }, 'user-1')).rejects.toThrow('CONVERSATION_NOT_FOUND')
        await expect(service.get({
            protocolVersion: 1,
            workspaceId: 'workspace-1',
            conversationAssetId,
        }, 'another-user')).rejects.toThrow('ACCESS_DENIED')
    })

    it('replays durable events after delivery loss and detects a missing event', async () => {
        await service.submit(submit(), 'user-1')
        await service.submit(submit('message-2'), 'user-1')
        const request = {
            protocolVersion: 1 as const,
            workspaceId: 'workspace-1',
            conversationAssetId,
            afterEventSeq: 0,
        }
        expect((await service.replay(request, 'user-1')).events.map(event => event.eventSeq)).toEqual([1, 2])
        database.rows.delete(`${conversationPartition('org-1', conversationAssetId)}|EVENT#0000000000000001`)
        expect(await service.replay(request, 'user-1')).toMatchObject({
            events: [],
            snapshotRequired: true,
        })
    })

    it('captures settings per turn instead of changing an accepted source scope', async () => {
        await service.submit(submit(), 'user-1')
        await service.settings({
            protocolVersion: 1,
            workspaceId: 'workspace-1',
            conversationAssetId,
            expectedRevision: 1,
            patch: { contextMode: 'discovery' },
        }, 'user-1')
        const turn = await repository.read<{ settings: { contextMode: string } }>(conversationPartition('org-1', conversationAssetId), 'TURN#id-1')
        expect(turn?.settings.contextMode).toBe('explicit')
        const meta = await repository.read<ConversationMeta>(conversationPartition('org-1', conversationAssetId), 'META')
        expect(meta?.settings.contextMode).toBe('discovery')
    })

    it('commits one configuration entry with settings and schedules projection without creating a turn', async () => {
        await service.submit(submit(), 'user-1')
        const request = {
            protocolVersion: 1 as const,
            workspaceId: 'workspace-1',
            conversationAssetId,
            expectedRevision: 1,
            patch: {
                contextMode: 'discovery' as const,
                midRunPolicy: 'queue' as const,
            },
        }
        const snapshot = await service.settings(request, 'user-1')
        const pk = conversationPartition('org-1', conversationAssetId)
        const messages = snapshot.messages.filter(message => message.role === 'configuration')
        expect(messages).toEqual([expect.objectContaining({
            messageId: '0000000000000001-2-settings-0000000000000002',
            text: 'Context: Discovery. During a run: Queue.',
            complete: true,
        })])
        expect(await repository.read(pk, 'DISPATCH#configuration')).toMatchObject({
            purpose: 'projection',
            projectionRevision: 2,
            userId: 'user-1',
        })
        expect((await repository.query(pk, 'TURN#')).items).toHaveLength(1)
        expect(snapshot.queueRevision).toBe(2)
        const commit = database.commits.at(-1)!
        expect(commit.filter(operation => operation.type === 'put').map(operation => operation.item.sk)).toEqual(expect.arrayContaining([
            'META', 'EVENT#0000000000000002', `MESSAGE#${messages[0].messageId}`, 'DISPATCH#configuration',
        ]))
        await expect(service.settings(request, 'user-1')).rejects.toThrow('STALE_CONVERSATION_SETTINGS')
        expect((await repository.query(pk, 'MESSAGE#')).items).toHaveLength(2)
    })

    it('retains configuration before activation without dispatching an uncreated conversation', async () => {
        const snapshot = await service.settings({
            protocolVersion: 1,
            workspaceId: 'workspace-1',
            conversationAssetId,
            expectedRevision: 1,
            patch: { contextMode: 'mixed' },
        }, 'user-1')
        const pk = conversationPartition('org-1', conversationAssetId)
        expect(snapshot.messages).toEqual([expect.objectContaining({
            role: 'configuration',
            text: 'Context: Mixed.',
        })])
        expect((await repository.query(pk, 'DISPATCH#')).items).toEqual([])
        expect((await repository.read<ConversationMeta>(pk, 'META'))?.activated).toBe(false)
        await service.settings({
            protocolVersion: 1,
            workspaceId: 'workspace-1',
            conversationAssetId,
            expectedRevision: 2,
            patch: { contextMode: 'mixed' },
        }, 'user-1')
        expect((await repository.query(pk, 'MESSAGE#')).items).toHaveLength(1)
    })

    it('opens the newest messages and pages backward without skipping or duplicating imported identities', async () => {
        const pk = conversationPartition('org-1', conversationAssetId)

        for (let index = 1; index <= 130; index++)
            await repository.commit([repository.put(pk, `MESSAGE#${conversationSequenceKey(index)}`, {
                messageId: `imported-${130 - index}`,
                turnId: 'turn',
                role: 'assistant',
                text: `Message ${index}`,
                complete: true,
                createdAt: index,
            })])

        const summaries = [1, 130].map(index => ({
            operationId: `operation-${index}`,
            responseMessageId: `imported-${130 - index}`,
            turnId: 'turn',
            operationKey: 'sequence.create',
            executionId: 'pipeline-execution',
            stepId: `step-${index}`,
            stepLabel: `Step ${index}`,
            state: 'succeeded',
            outputAssetIds: { sequence: `sequence-${index}` },
            createdAt: index,
            updatedAt: index,
        }))

        for (const summary of summaries)
            await repository.commit([repository.put(pk, `PUBLIC_OPERATION#${summary.responseMessageId}#${summary.operationId}`, {
                ...summary,
                authorizationId: 'private-receipt',
            })])

        const request = {
            protocolVersion: 1 as const,
            workspaceId: 'workspace-1',
            conversationAssetId,
        }
        const latest = await service.get(request, 'user-1')
        expect(latest.operations).toEqual([summaries[1]])
        expect(latest.messages.map(message => message.text)).toEqual(Array.from({ length: 50 }, (_, index) => `Message ${index + 81}`))
        const earlier = await service.messages({
            ...request,
            cursor: latest.messageCursor,
        }, 'user-1')
        const first = await service.messages({
            ...request,
            cursor: earlier.cursor,
        }, 'user-1')
        expect(first.cursor).toBeUndefined()
        expect(first.operations).toEqual([summaries[0]])
        expect([...first.messages, ...earlier.messages, ...latest.messages].map(message => message.text)).toEqual(Array.from({ length: 130 }, (_, index) => `Message ${index + 1}`))
        expect(latest.messages[0]).not.toHaveProperty('pk')
        const other = await service.create({
            protocolVersion: 1,
            workspaceId: 'workspace-1',
            clientConversationId: 'other',
        }, 'user-1')
        await expect(service.messages({
            ...request,
            conversationAssetId: other.conversationAssetId,
            cursor: latest.messageCursor,
        }, 'user-1')).rejects.toThrow('INVALID_CONVERSATION_CURSOR')
        await expect(service.messages({
            ...request,
            cursor: 'invalid',
        }, 'user-1')).rejects.toThrow('INVALID_CONVERSATION_CURSOR')
    })

    it('bounds UTF-8 transcript pages and omits rich queued payloads from snapshots', async () => {
        await service.submit(submit(), 'user-1')
        const pk = conversationPartition('org-1', conversationAssetId)

        for (let index = 2; index <= 8; index++)
            await repository.commit([repository.put(pk, `MESSAGE#${conversationSequenceKey(index)}`, {
                messageId: `message-${index}`,
                turnId: 'turn',
                role: 'assistant',
                text: '界'.repeat(80_000),
                complete: true,
                createdAt: index,
            })])

        const request = {
            protocolVersion: 1 as const,
            workspaceId: 'workspace-1',
            conversationAssetId,
        }
        const latest = await service.get(request, 'user-1')
        expect(latest.messages).toHaveLength(3)
        expect(Buffer.byteLength(JSON.stringify(latest))).toBeLessThan(CONVERSATION_RESPONSE_MAX_BYTES)
        expect(latest.queuedTurns[0]).not.toHaveProperty('fragment')
        const earlier = await service.messages({
            ...request,
            cursor: latest.messageCursor,
        }, 'user-1')
        expect(earlier.messages).toHaveLength(3)
        expect(Buffer.byteLength(JSON.stringify(earlier))).toBeLessThan(CONVERSATION_RESPONSE_MAX_BYTES)
        expect(earlier.messages.at(-1)?.messageId).toBe('message-5')
    })

    it('retries a snapshot when messages change after its metadata read', async () => {
        const pk = conversationPartition('org-1', conversationAssetId)
        const query = database.queryItems
        let changed = false
        vi.spyOn(database, 'queryItems').mockImplementation(async request => {
            const result = await query(request)

            if (
                !changed
                && request.sortKeyCondition?.value === 'MESSAGE#'
            ) {
                changed = true
                const meta = await repository.read<ConversationMeta>(pk, 'META')
                await repository.commit([
                    repository.replace(pk, 'META', {
                        ...meta,
                        revision: meta!.revision + 1,
                        eventSeq: 1,
                    }),
                    repository.put(pk, 'MESSAGE#0000000000000001', {
                        messageId: 'new',
                        turnId: 'turn',
                        role: 'assistant',
                        text: 'Arrived during load',
                        complete: true,
                        createdAt: 1,
                    }),
                ])
            }

            return result
        })
        const result = await service.get({
            protocolVersion: 1,
            workspaceId: 'workspace-1',
            conversationAssetId,
        }, 'user-1')
        expect(result.eventSeq).toBe(1)
        expect(result.messages[0].text).toBe('Arrived during load')
    })

    it('continues a conversation list at the last included record when byte limits shorten its page', async () => {
        const meta = await repository.read<ConversationMeta>(conversationPartition('org-1', conversationAssetId), 'META')
        const settings = structuredClone(meta!.settings)
        settings.models.reasoningOptions = { configGroups: Array.from({ length: 3 }, (_, index) => ({
            groupId: `group-${index}`,
            modelIds: ['model'],
            values: Object.fromEntries(Array.from({ length: 60 }, (_, key) => [`option-${key}`, 'x'.repeat(500)])),
        })) }

        for (let index = 0; index < 12; index++) {
            const id = `listed-${String(index).padStart(2, '0')}`
            await repository.commit([
                repository.put(conversationPartition('org-1', id), 'META', {
                    ...meta,
                    conversationAssetId: id,
                    settings,
                    activated: true,
                }),
                repository.put(conversationWorkspacePartition('org-1', 'workspace-1'), `CONVERSATION#${id}`, { conversationAssetId: id }),
            ])
        }

        const first = await service.list({
            protocolVersion: 1,
            workspaceId: 'workspace-1',
            limit: 100,
        }, 'user-1')
        expect(first.conversations.length).toBeGreaterThan(0)
        expect(first.conversations.length).toBeLessThan(12)
        expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(CONVERSATION_RESPONSE_MAX_BYTES)
        const second = await service.list({
            protocolVersion: 1,
            workspaceId: 'workspace-1',
            limit: 100,
            cursor: first.cursor,
        }, 'user-1')
        expect([...first.conversations, ...second.conversations].map(item => item.conversationAssetId)).toEqual(Array.from({ length: 12 }, (_, index) => `listed-${String(index).padStart(2, '0')}`))
        expect(second.cursor).toBeUndefined()
    })

    it('bounds event replay by bytes and detects gaps inside a returned page', async () => {
        const pk = conversationPartition('org-1', conversationAssetId)
        const meta = await repository.read<ConversationMeta>(pk, 'META')
        await repository.commit([repository.replace(pk, 'META', {
            ...meta,
            eventSeq: 4,
        })])

        for (let eventSeq = 1; eventSeq <= 4; eventSeq++)
            await repository.commit([repository.put(pk, `EVENT#${conversationSequenceKey(eventSeq)}`, {
                protocolVersion: 1,
                workspaceId: 'workspace-1',
                conversationAssetId,
                type: 'message.delta',
                payload: {
                    messageId: 'message',
                    text: '界'.repeat(80_000),
                    offset: 0,
                },
                turnId: 'turn',
                runId: 'run',
                epoch: 1,
                eventSeq,
                createdAt: 1,
            })])

        const request = {
            protocolVersion: 1 as const,
            workspaceId: 'workspace-1',
            conversationAssetId,
            afterEventSeq: 0,
        }
        const page = await service.replay(request, 'user-1')
        expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(CONVERSATION_RESPONSE_MAX_BYTES)
        expect(page.events).toHaveLength(3)
        expect(page.hasMore).toBe(true)
        database.rows.delete(`${pk}|EVENT#0000000000000002`)
        expect(await service.replay(request, 'user-1')).toMatchObject({
            snapshotRequired: true,
            events: [],
        })
    })
})
