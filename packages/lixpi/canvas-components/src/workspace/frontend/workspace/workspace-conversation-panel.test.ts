// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { createConversationSettings, type ConversationSnapshot } from '@lixpi/constants'
import { WorkspaceConversationController, type WorkspaceConversationPorts } from './workspace-conversation-controller.ts'
import { WorkspaceConversationPanel } from './workspace-conversation-panel.ts'
import { type CanvasConversationEditorMount, type CanvasConversationThread } from './canvas-conversation-run.ts'

const fixture = (overrides: Partial<ConversationSnapshot> = {}) => {
    const current: ConversationSnapshot = {
        protocolVersion: 1,
        workspaceId: 'workspace',
        conversationAssetId: 'conversation',
        title: 'Conversation',
        settings: createConversationSettings(),
        settingsRevision: 1,
        queueRevision: 1,
        queuePaused: false,
        queuedTurns: [],
        messages: [{
            messageId: 'message',
            turnId: 'turn',
            role: 'assistant',
            text: 'Command-log text',
            complete: false,
            createdAt: 1,
        }],
        documentRevision: 1,
        eventSeq: 1,
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    }
    const ports: WorkspaceConversationPorts = {
        create: async () => current,
        list: async () => ({ conversations: [current] }),
        get: async () => current,
        submit: vi.fn(),
        settings: vi.fn(),
        stop: vi.fn(),
        queue: vi.fn(),
        replay: async () => ({
            events: [],
            eventSeq: 1,
            hasMore: false,
            snapshotRequired: false,
        }),
        subscribe: () => () => {},
    }
    const controller = new WorkspaceConversationController('workspace', 'user', ports, {
        getItem: () => null,
        setItem: vi.fn(),
    }, () => 'id')
    controller.current = current
    controller.conversations = [current]
    const editor = {
        activate: vi.fn(),
        destroy: vi.fn(),
        readContent: vi.fn(),
        readDocumentVersion: vi.fn(() => 8),
        recoverAuthority: vi.fn(async () => {}),
        submitPersisted: vi.fn(),
        renderOperations: vi.fn(),
    }
    const load = vi.fn(async (): Promise<CanvasConversationThread | null> => ({
        threadId: 'conversation',
        organizationId: 'organization',
        proseMirrorVersion: 8,
        content: {
            type: 'doc',
            content: [],
        },
    }))
    const mount = vi.fn((_request: CanvasConversationEditorMount) => editor)
    const panel = new WorkspaceConversationPanel(controller, document, vi.fn(), undefined, {
        load,
        mount,
    })
    document.body.append(panel.element)

    return {
        current,
        ports,
        controller,
        editor,
        load,
        mount,
        panel,
    }
}

describe('WorkspaceConversationPanel native conversation editor', () => {
    it('mounts the authoritative conversation once and never renders command-log text as messages', async () => {
        const f = fixture()

        try {
            await vi.waitFor(() => expect(f.mount).toHaveBeenCalledOnce())
            const request = f.mount.mock.calls[0][0]
            expect(request.readOnly).toBe(true)
            expect(request.thread.proseMirrorVersion).toBe(8)
            expect(f.editor.activate).toHaveBeenCalledOnce()
            const text = document.createTextNode('Authority-rendered text')
            request.container.append(text)
            const range = document.createRange()
            range.setStart(text, 0)
            range.setEnd(text, 9)
            document.getSelection()!.addRange(range)
            f.current.messages[0].text += ' is only recovery state'
            await f.controller.refreshList()
            expect(f.mount).toHaveBeenCalledOnce()
            expect(request.container.firstChild).toBe(text)
            expect(document.getSelection()!.toString()).toBe('Authority')
            expect(f.panel.element.textContent).not.toContain('Command-log text')
            expect(f.panel.element.querySelector('article')).toBeNull()
            expect(f.editor.submitPersisted).not.toHaveBeenCalled()
            const stop = vi.spyOn(f.controller, 'stop').mockResolvedValue()
            request.onStop()
            expect(stop).toHaveBeenCalledOnce()
        } finally {
            f.panel.destroy()
            document.getSelection()?.removeAllRanges()
        }

        expect(f.editor.destroy).toHaveBeenCalledOnce()
    })

    it('preserves a scrolled native editor when authority transactions arrive', async () => {
        const f = fixture()

        try {
            await vi.waitFor(() => expect(f.mount).toHaveBeenCalledOnce())
            const transcript = f.panel.element.querySelector<HTMLElement>('.workspace-conversation-messages')!
            Object.defineProperties(transcript, {
                scrollHeight: { value: 1000 },
                clientHeight: { value: 200 },
            })
            transcript.scrollTop = 120
            transcript.dispatchEvent(new Event('scroll'))
            f.mount.mock.calls[0][0].onStreaming({ type: 'doc' })
            expect(transcript.scrollTop).toBe(120)
            const newMessages = f.panel.element.querySelector<HTMLButtonElement>('.workspace-conversation-new-messages')!
            expect(newMessages.hidden).toBe(false)
            newMessages.click()
            expect(transcript.scrollTop).toBe(1000)
        } finally { f.panel.destroy() }
    })

    it('does not mount a stale document after switching conversations or destroy', async () => {
        const f = fixture()
        await vi.waitFor(() => expect(f.mount).toHaveBeenCalledOnce())
        let resolve!: (thread: CanvasConversationThread | null) => void
        f.load.mockImplementationOnce(() => new Promise(done => void (resolve = done)))
        f.controller.current = {
            ...f.current,
            conversationAssetId: 'second',
        }
        await f.controller.refreshList()
        f.panel.destroy()
        resolve({
            threadId: 'second',
            organizationId: 'organization',
        })
        await Promise.resolve()
        expect(f.mount).toHaveBeenCalledOnce()
        expect(f.editor.destroy).toHaveBeenCalledOnce()
    })

    it('keeps an accepted interrupt answer out of ordinary queue cancellation', async () => {
        const f = fixture()

        try {
            f.current.queuedTurns = [{
                turnId: 'answer',
                clientMessageId: 'answer-client',
                commandSeq: 2,
                state: 'queued',
                createdAt: 1,
                interruptId: 'question',
            }]
            await f.controller.refreshList()
            expect(f.panel.element.querySelector('.workspace-conversation-queue')!.textContent).not.toContain('Cancel')
            expect(f.ports.queue).not.toHaveBeenCalled()
        } finally { f.panel.destroy() }
    })
})

describe('WorkspaceConversationPanel delegated conversations', () => {
    it('names the agent that started a delegated conversation and links back to its parent', async () => {
        const f = fixture()
        f.panel.destroy()
        const delegatedBy = {
            workspaceId: 'parent-workspace',
            workspaceName: 'Campaign',
            conversationAssetId: 'parent-conversation',
            turnId: 'parent-turn',
            operationId: 'delegation:abc',
        }
        const controller = new WorkspaceConversationController('workspace', 'user', f.ports, {
            getItem: () => null,
            setItem: vi.fn(),
        }, () => 'id')
        controller.current = {
            ...f.current,
            delegatedBy,
        }
        controller.conversations = [controller.current]
        const openConversation = vi.fn()
        const panel = new WorkspaceConversationPanel(
            controller,
            document,
            vi.fn(),
            undefined,
            {
                load: f.load,
                mount: f.mount,
            },
            openConversation,
        )

        try {
            const origin = panel.element.querySelector('.workspace-conversation-origin') as HTMLElement
            expect(origin.hidden).toBe(false)
            expect(origin.textContent).toContain('Started by Campaign agent')
            expect(panel.element.querySelector('option')!.textContent).toContain('Started by Campaign agent')

            ;(origin.querySelector('button') as HTMLButtonElement).click()
            expect(openConversation).toHaveBeenCalledWith('parent-workspace', 'parent-conversation')
        } finally { panel.destroy() }
    })

    it('hides the origin for a conversation a person started', () => {
        const f = fixture()

        try {
            expect((f.panel.element.querySelector('.workspace-conversation-origin') as HTMLElement).hidden).toBe(true)
        } finally { f.panel.destroy() }
    })
})

describe('WorkspaceConversationPanel presentation', () => {
    it('keeps a new empty conversation hidden until an accepted message arrives', async () => {
        const f = fixture({
            messages: [],
            documentRevision: 0,
        })

        try {
            expect(f.panel.element.hidden).toBe(true)
            expect(f.mount).not.toHaveBeenCalled()
            expect(f.panel.element.querySelector('.workspace-conversation-settings')).toBeNull()
            expect(f.panel.element.querySelector('select[aria-label="Next message policy"]')).toBeNull()
            f.current.messages.push({
                messageId: 'accepted-message',
                turnId: 'accepted-turn',
                role: 'user',
                text: 'Help me compare these experiments.',
                complete: true,
                createdAt: 2,
            })
            f.current.documentRevision = 1
            await f.controller.refreshList()
            await vi.waitFor(() => expect(f.mount).toHaveBeenCalledOnce())
            expect(f.panel.element.hidden).toBe(false)
            expect((f.panel.element.querySelector('.workspace-conversation-messages') as HTMLElement).hidden).toBe(false)
        } finally {
            f.panel.destroy()
        }
    })

    it('keeps previous conversations reachable without an empty transcript panel', async () => {
        const f = fixture({
            messages: [],
            documentRevision: 0,
        })
        const previous: ConversationSnapshot = {
            ...f.current,
            conversationAssetId: 'previous',
            title: 'Earlier discussion',
            documentRevision: 3,
        }
        f.ports.list = async () => ({ conversations: [f.current, previous] })

        try {
            await f.controller.refreshList()
            expect(f.panel.element.hidden).toBe(false)
            expect((f.panel.element.querySelector('.workspace-conversation-footer') as HTMLElement).hidden).toBe(false)
            expect((f.panel.element.querySelector('.workspace-conversation-messages') as HTMLElement).hidden).toBe(true)
            expect(f.mount).not.toHaveBeenCalled()
            const select = vi.spyOn(f.controller, 'select').mockResolvedValue(true)
            const picker = f.panel.element.querySelector<HTMLSelectElement>('.workspace-conversation-picker')!
            picker.value = 'previous'
            picker.dispatchEvent(new Event('change'))
            expect(select).toHaveBeenCalledWith('previous')
        } finally {
            f.panel.destroy()
        }
    })

    it('preserves the mounted transcript while collapsing and keeps Stop available', async () => {
        const f = fixture({
            run: {
                runId: 'run',
                turnId: 'turn',
                state: 'running',
                epoch: 1,
                instructionRevision: 1,
                continuationEpoch: 0,
                operationIds: [],
                updatedAt: 1,
                budget: {
                    modelCalls: 0,
                    toolCalls: 0,
                    specialistCalls: 0,
                    delegationCalls: 0,
                    maxModelCalls: 10,
                    maxToolCalls: 10,
                    maxSpecialistCalls: 10,
                    maxDelegationCalls: 10,
                },
            },
        })

        try {
            await vi.waitFor(() => expect(f.mount).toHaveBeenCalledOnce())
            const transcript = f.panel.element.querySelector<HTMLElement>('.workspace-conversation-messages')!
            Object.defineProperties(transcript, {
                scrollHeight: { value: 1000 },
                clientHeight: { value: 200 },
            })
            transcript.scrollTop = 120
            transcript.dispatchEvent(new Event('scroll'))
            const collapse = f.panel.element.querySelector<HTMLButtonElement>('[aria-label="Collapse conversation"]')!
            collapse.click()
            transcript.scrollTop = 0
            transcript.dispatchEvent(new Event('scroll'))
            f.mount.mock.calls[0][0].onStreaming({ type: 'doc' })
            expect(f.panel.element.dataset.collapsed).toBe('true')
            expect(collapse.ariaExpanded).toBe('false')
            expect(collapse.ariaLabel).toBe('Expand conversation')
            const stop = f.panel.element.querySelector<HTMLButtonElement>('[aria-label="Stop response"]')!
            expect(stop.hidden).toBe(false)
            const stopResponse = vi.spyOn(f.controller, 'stop').mockResolvedValue()
            stop.click()
            expect(stopResponse).toHaveBeenCalledOnce()
            collapse.click()
            expect(f.panel.element.dataset.collapsed).toBe('false')
            expect(transcript.scrollTop).toBe(120)
            expect(f.mount).toHaveBeenCalledOnce()
            expect(f.editor.destroy).not.toHaveBeenCalled()
            f.current.run!.state = 'completed'
            await f.controller.refreshList()
            expect(stop.hidden).toBe(true)
            expect((f.panel.element.querySelector('.workspace-conversation-state') as HTMLElement).hidden).toBe(true)
        } finally {
            f.panel.destroy()
        }
    })

    it('shows a recoverable connection error before the first message', async () => {
        const f = fixture({
            messages: [],
            documentRevision: 0,
        })
        f.ports.list = async () => { throw new Error('Connection unavailable') }

        try {
            await f.controller.refreshList()
            expect(f.panel.element.hidden).toBe(false)
            const status = f.panel.element.querySelector<HTMLElement>('.workspace-conversation-state')!
            expect(status.hidden).toBe(false)
            expect(status.textContent).toBe('Connection unavailable')
            f.ports.list = async () => ({ conversations: [f.current] })
            await f.controller.refreshList()
            expect(f.panel.element.hidden).toBe(true)
        } finally {
            f.panel.destroy()
        }
    })
})

describe('WorkspaceConversationPanel failure copy', () => {
    it('shows selection recovery before a previous error and keeps the draft action explicit', async () => {
        const f = fixture()

        try {
            f.controller.selecting = true
            f.controller.error = 'An earlier response failed.'
            await f.controller.refreshList()
            const status = f.panel.element.querySelector<HTMLElement>('.workspace-conversation-state')!
            expect(status.textContent).toBe('Loading conversation...')
            expect(status.dataset.error).toBe('false')
        } finally {
            f.panel.destroy()
        }
    })

    it('keeps authorization diagnostics in state while showing an actionable message', async () => {
        const f = fixture()
        f.ports.list = async () => { throw new Error('AGENT_MODEL_CALL_NOT_AUTHORIZED') }

        try {
            await f.controller.refreshList()
            expect(f.controller.error).toBe('AGENT_MODEL_CALL_NOT_AUTHORIZED')
            const status = f.panel.element.querySelector<HTMLElement>('.workspace-conversation-state')!
            expect(status.textContent).toBe('The response could not start. Check your account settings.')
            expect(status.dataset.error).toBe('true')
        } finally {
            f.panel.destroy()
        }
    })
})

describe('Conversation history menu', () => {
    it('keeps management controls in one menu and closes it on Escape or an outside pointer', async () => {
        const f = fixture()

        try {
            await vi.waitFor(() => expect(f.mount).toHaveBeenCalledOnce())
            const trigger = f.panel.element.querySelector<HTMLButtonElement>('.workspace-conversation-history')!
            const menu = f.panel.element.querySelector<HTMLElement>('.workspace-conversation-menu')!
            expect(f.panel.element.querySelector('.workspace-conversation-header')).toBeNull()
            expect(menu.contains(f.panel.element.querySelector('[aria-label="New conversation"]'))).toBe(true)
            expect(menu.contains(f.panel.element.querySelector('.workspace-conversation-picker'))).toBe(true)
            expect(menu.classList.contains('is-visible')).toBe(false)
            trigger.click()
            expect(menu.classList.contains('is-visible')).toBe(true)
            expect(trigger.ariaExpanded).toBe('true')
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
            expect(menu.classList.contains('is-visible')).toBe(false)
            expect(document.activeElement).toBe(trigger)
            trigger.click()
            document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
            expect(menu.classList.contains('is-visible')).toBe(false)
            expect(trigger.ariaExpanded).toBe('false')
        } finally {
            f.panel.destroy()
        }
    })
})

describe('Projected conversation failures', () => {
    it('keeps the footer fallback until the matching error node is present and preserves transport errors', async () => {
        const failure = {
            code: 'AGENT_MODEL_CALL_NOT_AUTHORIZED',
            message: 'The response could not start. Check your account settings.',
            recoverable: false,
        }
        const f = fixture({
            messages: [{
                messageId: 'failed-message',
                turnId: 'failed-turn',
                role: 'assistant',
                text: failure.message,
                failure,
                complete: true,
                createdAt: 1,
            }],
            run: {
                runId: 'failed-run',
                turnId: 'failed-turn',
                state: 'failed',
                error: failure,
                epoch: 1,
                instructionRevision: 1,
                continuationEpoch: 0,
                operationIds: [],
                updatedAt: 1,
                budget: {
                    modelCalls: 0,
                    toolCalls: 0,
                    specialistCalls: 0,
                    delegationCalls: 0,
                    maxModelCalls: 10,
                    maxToolCalls: 10,
                    maxSpecialistCalls: 10,
                    maxDelegationCalls: 10,
                },
            },
        })

        try {
            await vi.waitFor(() => expect(f.mount).toHaveBeenCalledOnce())
            const status = f.panel.element.querySelector<HTMLElement>('.workspace-conversation-state')!
            expect(status.hidden).toBe(false)
            expect(status.textContent).toBe(failure.message)
            const errorNode = document.createElement('div')
            errorNode.dataset.messageId = 'failed-message'
            errorNode.dataset.failureCode = failure.code
            f.mount.mock.calls[0][0].container.append(errorNode)
            f.mount.mock.calls[0][0].onStreaming({ type: 'doc' })
            expect(status.hidden).toBe(true)
            f.controller.reportSubmissionError(new Error('Connection unavailable'))
            expect(status.hidden).toBe(false)
            expect(status.textContent).toBe('Connection unavailable')
            f.controller.error = ''
            f.panel.element.querySelector<HTMLButtonElement>('[aria-label="Collapse conversation"]')!.click()
            expect(status.hidden).toBe(false)
            expect(status.textContent).toBe(failure.message)
        } finally {
            f.panel.destroy()
        }
    })
})

describe('Native transcript recovery', () => {
    const activeRun: NonNullable<ConversationSnapshot['run']> = {
        runId: 'run',
        turnId: 'turn',
        state: 'running',
        epoch: 1,
        instructionRevision: 1,
        continuationEpoch: 0,
        operationIds: [],
        updatedAt: 1,
        budget: {
            modelCalls: 0,
            toolCalls: 0,
            specialistCalls: 0,
            delegationCalls: 0,
            maxModelCalls: 10,
            maxToolCalls: 10,
            maxSpecialistCalls: 10,
            maxDelegationCalls: 10,
        },
    }

    it('reopens the relay on run transitions and stalled native progress without per-delta requests or remounts', async () => {
        vi.useFakeTimers()
        const f = fixture({
            run: structuredClone(activeRun),
            documentRevision: 8,
        })

        try {
            await vi.advanceTimersByTimeAsync(0)
            expect(f.editor.recoverAuthority).toHaveBeenCalledOnce()
            const transcript = f.panel.element.querySelector<HTMLElement>('.workspace-conversation-messages')!
            transcript.scrollTop = 120
            const content = document.createTextNode('Selected native response')
            f.mount.mock.calls[0][0].container.append(content)
            const range = document.createRange()
            range.setStart(content, 0)
            range.setEnd(content, 8)
            document.getSelection()!.addRange(range)
            f.current.run!.epoch = 2
            await f.controller.refreshList()
            await vi.advanceTimersByTimeAsync(0)
            expect(f.editor.recoverAuthority).toHaveBeenCalledTimes(2)

            for (let index = 0; index < 3; index += 1) {
                f.current.messages[0].text += 'delta'
                await f.controller.refreshList()
            }

            expect(f.editor.recoverAuthority).toHaveBeenCalledTimes(2)
            await vi.advanceTimersByTimeAsync(2500)
            expect(f.editor.recoverAuthority).toHaveBeenCalledTimes(3)
            f.editor.readDocumentVersion.mockReturnValue(9)
            await vi.advanceTimersByTimeAsync(2500)
            expect(f.editor.recoverAuthority).toHaveBeenCalledTimes(3)
            f.current.run!.state = 'completed'
            await f.controller.refreshList()
            await vi.advanceTimersByTimeAsync(0)
            expect(f.editor.recoverAuthority).toHaveBeenCalledTimes(4)
            await vi.advanceTimersByTimeAsync(2500)
            expect(f.editor.recoverAuthority).toHaveBeenCalledTimes(4)

            f.editor.recoverAuthority.mockImplementationOnce(async () => void f.editor.readDocumentVersion.mockReturnValue(10))
            f.current.documentRevision = 10
            await f.controller.refreshList()
            await vi.advanceTimersByTimeAsync(0)
            expect(f.editor.recoverAuthority).toHaveBeenCalledTimes(5)
            expect(f.mount).toHaveBeenCalledOnce()
            expect(f.editor.destroy).not.toHaveBeenCalled()
            expect(transcript.scrollTop).toBe(120)
            expect(document.getSelection()!.toString()).toBe('Selected')
        } finally {
            f.panel.destroy()
            document.getSelection()?.removeAllRanges()
            vi.useRealTimers()
        }
    })

    it('retries failed authority recovery only on the existing recovery tick', async () => {
        vi.useFakeTimers()
        const f = fixture()
        f.editor.recoverAuthority.mockRejectedValueOnce(new Error('Relay unavailable'))

        try {
            await vi.advanceTimersByTimeAsync(0)
            expect(f.editor.recoverAuthority).toHaveBeenCalledOnce()
            await f.controller.refreshList()
            await f.controller.refreshList()
            await vi.advanceTimersByTimeAsync(2499)
            expect(f.editor.recoverAuthority).toHaveBeenCalledOnce()
            await vi.advanceTimersByTimeAsync(1)
            expect(f.editor.recoverAuthority).toHaveBeenCalledTimes(2)
            await vi.advanceTimersByTimeAsync(2500)
            expect(f.editor.recoverAuthority).toHaveBeenCalledTimes(2)
        } finally {
            f.panel.destroy()
            vi.useRealTimers()
        }
    })
})
