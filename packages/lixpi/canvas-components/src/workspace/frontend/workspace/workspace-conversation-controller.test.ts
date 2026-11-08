import { describe, expect, it, vi } from 'vitest'

import { createConversationSettings, type ConversationEvent, type ConversationOperationSummary, type ConversationSnapshot, type ConversationSubmitRequest } from '@lixpi/constants'
import { WorkspaceConversationController, type WorkspaceConversationPorts } from './workspace-conversation-controller.ts'

const snapshot = (id = 'conversation'): ConversationSnapshot => ({
    protocolVersion: 1,
    workspaceId: 'workspace',
    conversationAssetId: id,
    title: id,
    settings: createConversationSettings(),
    settingsRevision: 1,
    queueRevision: 1,
    queuePaused: false,
    queuedTurns: [],
    messages: [],
    documentRevision: 0,
    eventSeq: 0,
    createdAt: 1,
    updatedAt: 1,
})
const harness = () => {
    const data = snapshot()
    let receive: (event: ConversationEvent) => void = () => {}
    const subscriptions: Array<ReturnType<typeof vi.fn>> = []
    const ports: WorkspaceConversationPorts = {
        create: async () => snapshot('created'),
        list: async () => ({ conversations: [data, snapshot('other')] }),
        get: vi.fn(async request => structuredClone(request.conversationAssetId === 'conversation' ? data : snapshot(request.conversationAssetId))),
        submit: vi.fn(async request => ({
            status: 'accepted',
            clientMessageId: request.clientMessageId,
            turnId: 'turn',
            commandSeq: 1,
            eventSeq: 1,
            documentRevision: 1,
            projectionPending: false,
        })),
        settings: async request => ({
            ...data,
            settingsRevision: 2,
            settings: {
                ...data.settings,
                ...request.patch,
            },
        }),
        stop: vi.fn(),
        queue: vi.fn(),
        replay: vi.fn(async () => ({
            events: [],
            eventSeq: 0,
            hasMore: false,
            snapshotRequired: false,
        })),
        subscribe: (_, __, listener) => { receive = listener; const dispose = vi.fn(); subscriptions.push(dispose)

        return dispose },
    }
    const stored = new Map<string, string>()
    const storage = {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => void stored.set(key, value),
    }
    let id = 0
    const controller = new WorkspaceConversationController('workspace', 'user', ports, storage, () => `id-${++id}`)

    return {
        controller,
        data,
        ports,
        stored,
        storage,
        subscriptions,
        emit: (event: ConversationEvent) => receive(event),
    }
}

describe('WorkspaceConversationController', () => {
    it('removes a started turn from the queue and refreshes first-turn document activation through completion', async () => {
        const {
            controller,
            data,
            ports,
            emit,
        } = harness()
        const queued = (turnId: string, commandSeq: number) => ({
            turnId,
            clientMessageId: turnId,
            commandSeq,
            state: 'queued' as const,
            createdAt: commandSeq,
        })
        data.queuedTurns = [queued('turn', 1), queued('next', 2)]
        await controller.initialize()
        const run = {
            runId: 'run',
            turnId: 'turn',
            state: 'running' as const,
            epoch: 1,
            instructionRevision: 1,
            continuationEpoch: 0,
            budget: {
                modelCalls: 1,
                toolCalls: 0,
                specialistCalls: 0,
                maxModelCalls: 20,
                maxToolCalls: 20,
                maxSpecialistCalls: 2,
            },
            operationIds: [],
            updatedAt: 2,
        }
        let stale!: (snapshot: ConversationSnapshot) => void
        vi.mocked(ports.get).mockImplementationOnce(() => new Promise(resolve => void (stale = resolve)))
        const base = {
            protocolVersion: 1 as const,
            workspaceId: 'workspace',
            conversationAssetId: 'conversation',
            turnId: 'turn',
            runId: 'run',
            epoch: 1,
            createdAt: 2,
        }
        emit({
            ...base,
            eventSeq: 1,
            type: 'run.state',
            payload: run,
        })
        expect(controller.current?.queuedTurns.map(turn => turn.turnId)).toEqual(['next'])
        const complete = {
            ...run,
            state: 'completed' as const,
            updatedAt: 3,
        }
        vi.mocked(ports.get).mockResolvedValueOnce({
            ...structuredClone(data),
            eventSeq: 2,
            documentRevision: 2,
            queueRevision: 2,
            queuedTurns: [queued('next', 2)],
            run: complete,
        })
        emit({
            ...base,
            eventSeq: 2,
            type: 'run.state',
            payload: complete,
        })
        await vi.waitFor(() => expect(controller.current?.documentRevision).toBe(2))
        stale({
            ...structuredClone(data),
            eventSeq: 1,
            run,
        })
        await Promise.resolve()
        expect(controller.current?.run?.state).toBe('completed')
        expect(controller.current?.queuedTurns.map(turn => turn.turnId)).toEqual(['next'])
        expect(controller.current?.documentRevision).toBe(2)
        controller.destroy()
    })

    it('retries a snapshot that trailed a run event even when replay has no new events', async () => {
        const {
            controller,
            data,
            ports,
            emit,
        } = harness()
        await controller.initialize()
        const run = {
            runId: 'run',
            turnId: 'turn',
            state: 'completed' as const,
            epoch: 1,
            instructionRevision: 1,
            continuationEpoch: 0,
            budget: {
                modelCalls: 1,
                toolCalls: 0,
                specialistCalls: 0,
                maxModelCalls: 20,
                maxToolCalls: 20,
                maxSpecialistCalls: 2,
            },
            operationIds: [],
            updatedAt: 2,
        }
        emit({
            protocolVersion: 1,
            workspaceId: 'workspace',
            conversationAssetId: 'conversation',
            turnId: 'turn',
            runId: 'run',
            epoch: 1,
            createdAt: 2,
            eventSeq: 1,
            type: 'run.state',
            payload: run,
        })
        await Promise.resolve()
        expect(controller.current?.documentRevision).toBe(0)
        vi.mocked(ports.get).mockResolvedValue({
            ...data,
            eventSeq: 1,
            documentRevision: 1,
            run,
        })
        await controller.recover()
        expect(controller.current?.documentRevision).toBe(1)
        controller.destroy()
    })
    it('does not replace streamed text or rewind the cursor when an older settings response arrives', async () => {
        const {
            controller,
            data,
            ports,
            emit,
        } = harness()
        data.messages = [{
            messageId: 'response',
            turnId: 'turn',
            role: 'assistant',
            text: 'Hello',
            complete: false,
            createdAt: 1,
        }]
        await controller.initialize()
        let finish!: (snapshot: ConversationSnapshot) => void
        ports.settings = vi.fn(() => new Promise(resolve => void (finish = resolve)))
        const changing = controller.changeSettings({ midRunPolicy: 'queue' })
        const settings = {
            ...data.settings,
            midRunPolicy: 'queue' as const,
        }
        const base = {
            protocolVersion: 1 as const,
            workspaceId: 'workspace',
            conversationAssetId: 'conversation',
            turnId: 'turn',
            runId: 'run',
            epoch: 1,
            createdAt: 1,
        }
        emit({
            ...base,
            eventSeq: 1,
            type: 'settings.changed',
            payload: {
                settings,
                revision: 2,
            },
        })
        emit({
            ...base,
            eventSeq: 2,
            type: 'message.delta',
            payload: {
                messageId: 'response',
                offset: 5,
                text: ' world',
            },
        })
        finish({
            ...structuredClone(data),
            eventSeq: 1,
            settingsRevision: 2,
            settings,
        })
        await changing
        expect(controller.current?.messages[0].text).toBe('Hello world')
        expect(controller.current?.eventSeq).toBe(2)
        expect(controller.current?.settings.midRunPolicy).toBe('queue')
        controller.destroy()
    })

    it('retains an unsent reservation in the picker and restores its private pending draft after reload', async () => {
        const {
            controller,
            ports,
            storage,
            stored,
        } = harness()
        await controller.initialize()
        await controller.create()
        await controller.refreshList()
        expect(controller.current?.conversationAssetId).toBe('created')
        expect(controller.conversations.map(item => item.conversationAssetId)).toContain('created')
        const pending: ConversationSubmitRequest = {
            protocolVersion: 1,
            workspaceId: 'workspace',
            conversationAssetId: 'created',
            clientMessageId: 'unsent-id',
            settingsRevision: 1,
            references: [],
            fragment: {
                type: 'aiUserMessage',
                content: [{
                    type: 'paragraph',
                    content: [{
                        type: 'text',
                        text: 'Keep my draft',
                    }],
                }],
            },
        }
        stored.set('lixpi:conversation-active:user:workspace:pending:created', JSON.stringify(pending))
        controller.destroy()
        const restored = new WorkspaceConversationController('workspace', 'user', ports, storage, () => 'new-id')
        await restored.initialize()
        expect(restored.current?.conversationAssetId).toBe('created')
        expect(restored.pendingSubmission).toEqual(pending)
        expect(restored.conversations.map(item => item.conversationAssetId)).toContain('created')
        const anotherUser = new WorkspaceConversationController('workspace', 'another-user', ports, storage, () => 'another-id')
        await anotherUser.initialize()
        expect(anotherUser.current?.conversationAssetId).toBe('conversation')
        expect(anotherUser.pendingSubmission).toBeUndefined()
        restored.destroy()
        anotherUser.destroy()
    })

    it('tries an authorized GET for the private selection before falling back from an expired reservation', async () => {
        const {
            controller,
            ports,
            stored,
        } = harness()
        stored.set('lixpi:conversation-active:user:workspace', 'expired')
        ports.get = vi.fn(async request => {
            if (request.conversationAssetId === 'expired')
                throw new Error('CONVERSATION_RESERVATION_EXPIRED')

            return snapshot(request.conversationAssetId)
        })
        await controller.initialize()
        expect(vi.mocked(ports.get).mock.calls.map(([request]) => request.conversationAssetId)).toEqual(['expired', 'conversation'])
        expect(controller.current?.conversationAssetId).toBe('conversation')
        expect(controller.error).toBe('')
        controller.destroy()
    })

    it('restores operation cards, merges committed outputs, and retains earlier cards across snapshots', async () => {
        const {
            controller,
            data,
            ports,
            emit,
        } = harness()
        const operation: ConversationOperationSummary = {
            operationId: 'operation',
            turnId: 'turn',
            responseMessageId: 'message',
            operationKey: 'sequence.create',
            state: 'running',
            outputAssetIds: {},
            createdAt: 1,
            updatedAt: 1,
        }
        data.operations = [operation]
        data.messages = [{
            messageId: 'message',
            turnId: 'turn',
            role: 'assistant',
            text: '',
            complete: false,
            createdAt: 1,
        }]
        data.messageCursor = 'earlier'
        await controller.initialize()
        expect(controller.operations.get('operation')).toEqual(operation)
        emit({
            protocolVersion: 1,
            workspaceId: 'workspace',
            conversationAssetId: 'conversation',
            type: 'output.committed',
            eventSeq: 1,
            turnId: 'turn',
            runId: 'run',
            epoch: 1,
            createdAt: 2,
            payload: {
                operationId: 'operation',
                outputSlot: 'sequence',
                assetId: 'sequence-asset',
            },
        })
        expect(controller.operations.get('operation')?.outputAssetIds).toEqual({ sequence: 'sequence-asset' })
        ports.messages = async () => ({
            messages: [{
                messageId: 'earlier-message',
                turnId: 'earlier-turn',
                role: 'assistant',
                text: 'Earlier output',
                complete: true,
                createdAt: 0,
            }],
            operations: [{
                ...operation,
                operationId: 'earlier-operation',
                responseMessageId: 'earlier-message',
                turnId: 'earlier-turn',
                state: 'succeeded',
            }],
        })
        await controller.loadEarlier()
        data.eventSeq = 2
        data.operations = [{
            ...operation,
            state: 'succeeded',
            updatedAt: 3,
        }]
        ports.replay = async () => ({
            events: [],
            eventSeq: 2,
            snapshotRequired: true,
            hasMore: false,
        })
        await controller.recover()
        expect(controller.operations.size).toBe(2)
        expect(controller.operations.get('operation')).toMatchObject({
            state: 'succeeded',
            outputAssetIds: { sequence: 'sequence-asset' },
        })
        expect(controller.current?.operations).toHaveLength(2)
        await controller.select('other')
        expect(controller.operations.size).toBe(0)
        controller.destroy()
    })

    it('keeps conversation selection private and releases the previous live subscription', async () => {
        const {
            controller,
            stored,
            subscriptions,
        } = harness()
        await controller.initialize()
        await controller.select('other')
        expect(controller.current?.conversationAssetId).toBe('other')
        expect(stored.get('lixpi:conversation-active:user:workspace')).toBe('other')
        expect(subscriptions[0]).toHaveBeenCalledOnce()
        controller.destroy()
        expect(subscriptions[1]).toHaveBeenCalledOnce()
    })

    it('replays an event gap before applying the later delta and ignores duplicates', async () => {
        const {
            controller,
            ports,
            emit,
        } = harness()
        await controller.initialize()
        const event = (eventSeq: number, offset: number, text: string): ConversationEvent => ({
            protocolVersion: 1,
            workspaceId: 'workspace',
            conversationAssetId: 'conversation',
            eventSeq,
            type: 'message.delta',
            turnId: 'turn',
            runId: 'run',
            epoch: 1,
            createdAt: 1,
            payload: {
                messageId: 'message',
                offset,
                text,
            },
        })
        ports.replay = vi.fn(async () => ({
            events: [event(1, 0, 'Hello ')],
            eventSeq: 2,
            hasMore: false,
            snapshotRequired: false,
        }))
        emit(event(2, 6, 'world'))
        await controller.recover()
        emit(event(2, 6, 'world'))
        expect(controller.current?.messages[0].text).toBe('Hello world')
        expect(controller.current?.eventSeq).toBe(2)
        controller.destroy()
    })

    it('keeps an unacknowledged command identity and resubmits it without creating another turn', async () => {
        const {
            controller,
            ports,
        } = harness()
        await controller.initialize()
        const requests: ConversationSubmitRequest[] = []
        ports.submit = vi.fn(async request => {
            requests.push(request)

            if (requests.length === 1)
                throw new Error('Disconnected')

            return {
                status: 'duplicate',
                clientMessageId: request.clientMessageId,
                turnId: 'turn',
                commandSeq: 1,
                eventSeq: 1,
                documentRevision: 1,
                projectionPending: false,
            }
        })
        const fragment = {
            type: 'aiUserMessage',
            content: [{
                type: 'paragraph',
                content: [{
                    type: 'text',
                    text: 'Plan this edit',
                }],
            }],
        }
        await expect(controller.submit(fragment, [], createConversationSettings().models)).rejects.toThrow('Disconnected')
        await controller.submit(fragment, [], createConversationSettings().models)
        expect(requests[0]).toEqual(requests[1])
        expect(controller.pendingSubmission).toBeUndefined()
        controller.destroy()
    })

    it('recovers an accepted acknowledgement after transport loss', async () => {
        const {
            controller,
            ports,
            data,
        } = harness()
        await controller.initialize()
        ports.submit = vi.fn(async () => { throw new Error('Lost reply') })
        ports.get = vi.fn(async request => ({
            ...data,
            ...(request.clientMessageId ? { acknowledgement: {
                status: 'duplicate' as const,
                clientMessageId: request.clientMessageId,
                turnId: 'turn',
                commandSeq: 1,
                eventSeq: 1,
                documentRevision: 1,
                projectionPending: false,
            } } : {}),
        }))
        await expect(controller.submit({
            type: 'aiUserMessage',
            content: [{
                type: 'paragraph',
                content: [{
                    type: 'text',
                    text: 'Hello',
                }],
            }],
        }, [], createConversationSettings().models)).resolves.toBeUndefined()
        expect(controller.pendingSubmission).toBeUndefined()
        controller.destroy()
    })

    it('restores an unacknowledged command after reload and keeps its original identity', async () => {
        const {
            controller,
            ports,
            storage,
        } = harness()
        await controller.initialize()
        ports.submit = vi.fn(async () => { throw new Error('Disconnected') })
        const fragment = {
            type: 'aiUserMessage',
            content: [{
                type: 'paragraph',
                content: [{
                    type: 'text',
                    text: 'Keep this draft',
                }],
            }],
        }
        await expect(controller.submit(fragment, [], createConversationSettings().models)).rejects.toThrow('Disconnected')
        const previous = controller.pendingSubmission
        controller.destroy()
        const restored = new WorkspaceConversationController('workspace', 'user', ports, storage, () => 'different-id')
        await restored.initialize()
        expect(restored.pendingSubmission).toEqual(previous)
        ports.submit = vi.fn(async request => ({
            status: 'duplicate',
            clientMessageId: request.clientMessageId,
            turnId: 'turn',
            commandSeq: 1,
            eventSeq: 1,
            documentRevision: 1,
            projectionPending: false,
        }))
        await restored.submit(fragment, [], createConversationSettings().models)
        expect(ports.submit).toHaveBeenCalledWith(previous)
        expect(storage.getItem('lixpi:conversation-active:user:workspace:pending:conversation')).toBe('null')
        restored.destroy()
    })

    it('does not submit to the previous conversation while another selection is loading', async () => {
        const {
            controller,
            ports,
        } = harness()
        await controller.initialize()
        let resolve!: (value: ConversationSnapshot) => void
        ports.get = vi.fn(() => new Promise<ConversationSnapshot>(done => void (resolve = done)))
        const selection = controller.select('other')
        await expect(controller.submit({ type: 'aiUserMessage' }, [], createConversationSettings().models)).rejects.toThrow('loading')
        expect(ports.submit).not.toHaveBeenCalled()
        resolve(snapshot('other'))
        await selection
        expect(controller.current?.conversationAssetId).toBe('other')
        expect(controller.selecting).toBe(false)
        controller.destroy()
    })

    it('prepends older pages in storage order while retaining streaming text and the live event cursor', async () => {
        const {
            controller,
            data,
            ports,
            emit,
        } = harness()
        data.messages = [{
            messageId: 'recent',
            orderKey: '0002',
            turnId: 'turn',
            role: 'assistant',
            text: 'Hello',
            complete: false,
            createdAt: 2,
        }]
        data.messageCursor = 'older'
        await controller.initialize()
        let finish!: (value: Awaited<ReturnType<NonNullable<WorkspaceConversationPorts['messages']>>>) => void
        ports.messages = vi.fn(() => new Promise(resolve => void (finish = resolve)))
        const loading = controller.loadEarlier()
        emit({
            protocolVersion: 1,
            workspaceId: 'workspace',
            conversationAssetId: 'conversation',
            type: 'message.delta',
            payload: {
                messageId: 'recent',
                offset: 5,
                text: ' world',
            },
            turnId: 'turn',
            runId: 'run',
            epoch: 1,
            eventSeq: 1,
            createdAt: 3,
        })
        finish({ messages: [
            {
                messageId: 'z-imported',
                orderKey: '0001',
                turnId: 'older-turn',
                role: 'user',
                text: 'Earlier',
                complete: true,
                createdAt: 1,
            },
            {
                ...data.messages[0],
                text: 'Hello',
            },
        ] })
        await loading
        expect(controller.current?.messages.map(message => message.text)).toEqual(['Earlier', 'Hello world'])
        expect(controller.current?.eventSeq).toBe(1)
        expect(controller.current?.messageCursor).toBeUndefined()
        data.eventSeq = 1
        data.messages[0].text = 'Hello world'
        await controller.changeSettings({ midRunPolicy: 'queue' })
        expect(controller.current?.messages.map(message => message.text)).toEqual(['Earlier', 'Hello world'])
        expect(controller.current?.messageCursor).toBeUndefined()
        controller.destroy()
    })

    it('does not install an old history page after switching conversations', async () => {
        const {
            controller,
            data,
            ports,
        } = harness()
        data.messageCursor = 'older'
        await controller.initialize()
        let finish!: (value: { messages: [] }) => void
        ports.messages = vi.fn(() => new Promise(resolve => void (finish = resolve)))
        const loading = controller.loadEarlier()
        await controller.select('other')
        finish({ messages: [] })
        await loading
        expect(controller.current?.conversationAssetId).toBe('other')
        expect(controller.loadingEarlier).toBe(false)
        controller.destroy()
    })

    it('restores selection after a temporary startup outage and clears a recovered replay error', async () => {
        const {
            controller,
            ports,
            stored,
            data,
        } = harness()
        stored.set('lixpi:conversation-active:user:workspace', 'other')
        ports.list = vi.fn().mockRejectedValueOnce(new Error('no responders')).mockResolvedValue({ conversations: [data, snapshot('other')] })
        await controller.initialize()
        expect(controller.current).toBeUndefined()
        expect(controller.error).toBe('no responders')
        await controller.refreshList()
        expect(controller.current?.conversationAssetId).toBe('other')
        expect(controller.error).toBe('')
        ports.replay = vi.fn().mockRejectedValueOnce(new Error('no responders')).mockResolvedValue({
            events: [],
            eventSeq: 0,
            hasMore: false,
            snapshotRequired: false,
        })
        await controller.recover()
        expect(controller.error).toBe('no responders')
        await controller.recover()
        expect(controller.error).toBe('')
        expect(controller.current?.conversationAssetId).toBe('other')
        controller.destroy()
    })
})
