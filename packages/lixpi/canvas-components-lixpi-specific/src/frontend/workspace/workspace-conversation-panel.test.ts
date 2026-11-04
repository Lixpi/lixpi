// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { createConversationSettings, type ConversationSnapshot } from '@lixpi/constants'
import { WorkspaceConversationController, type WorkspaceConversationPorts } from './workspace-conversation-controller.ts'
import { WorkspaceConversationPanel } from './workspace-conversation-panel.ts'
import { type CanvasConversationEditorMount, type CanvasConversationThread } from './canvas-conversation-run.ts'

const fixture = () => {
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
