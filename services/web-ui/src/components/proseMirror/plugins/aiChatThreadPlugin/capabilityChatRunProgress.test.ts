import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CapabilityRunEvent,
    type ConversationOperationSummary,
} from '@lixpi/constants'
import {
    type EditorView,
} from 'prosemirror-view'

import {
    CAPABILITY_CHAT_PROGRESS_MOUNT_CLASS,
    CapabilityChatRunProgressController,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/capabilityChatRunProgress.ts'
import { createAiResponseMessageShell } from './aiChatMessageShells.ts'

const operation = (overrides: Partial<ConversationOperationSummary> = {}): ConversationOperationSummary => ({
    operationId: 'operation-1',
    turnId: 'turn-1',
    responseMessageId: 'response-1',
    operationKey: 'media-sequence.export',
    stepLabel: 'Export sequence',
    state: 'running',
    outputAssetIds: {},
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
})

const event = (sequence: number): CapabilityRunEvent => {
    return {
        runId: 'run-1',
        sequence,
        eventType: sequence === 1 ? 'RUN_STARTED' : 'RUN_COMPLETED',
        timestamp: sequence,
        runStatus: sequence === 1 ? 'running' : 'completed',
    }
}

describe('CapabilityChatRunProgressController', () => {
    it('buffers operations for their exact response and restores their shared renderer when its NodeView remounts', () => {
        const root = document.createElement('div')
        const other = createAiResponseMessageShell({ messageId: 'response-2' })
        root.append(other.wrapper)
        const view = { dom: root } as EditorView
        const controller = new CapabilityChatRunProgressController()
        controller.renderOperations(view, [operation()])
        expect(other.capabilityProgressEl.children).toHaveLength(0)

        const first = createAiResponseMessageShell({ messageId: 'response-1' })
        root.prepend(first.wrapper)
        controller.sync(view)
        const progress = first.capabilityProgressEl.querySelector('.capability-run-progress')!
        expect(progress).not.toBeNull()
        expect(progress.textContent).toContain('Export sequence')
        expect(controller.getState('conversation-response:response-1')?.steps[0].status).toBe('running')

        const replacement = createAiResponseMessageShell({ messageId: 'response-1' })
        first.wrapper.replaceWith(replacement.wrapper)
        controller.sync(view)
        expect(replacement.capabilityProgressEl.firstElementChild).toBe(progress)
        expect(other.capabilityProgressEl.children).toHaveLength(0)
        controller.renderOperations(view, [])
        expect(replacement.capabilityProgressEl.children).toHaveLength(0)
        controller.destroy()
    })

    it('updates response progress without replacing output actions and rechecks outputs before opening', async () => {
        const root = document.createElement('div')
        const first = createAiResponseMessageShell({ messageId: 'response-1' })
        const second = createAiResponseMessageShell({ messageId: 'response-2' })
        root.append(first.wrapper, second.wrapper)
        document.body.append(root)
        const view = { dom: root } as EditorView
        const controller = new CapabilityChatRunProgressController()
        const ports = {
            resolve: vi.fn(async () => ({ title: '<b>Sequence export</b>' })),
            open: vi.fn(async () => {}),
        }
        const exported = operation({
            state: 'succeeded',
            outputAssetIds: { video: 'output-asset' },
        })
        const pending = operation({
            operationId: 'operation-2',
            responseMessageId: 'response-2',
            state: 'outcome-unknown',
        })

        try {
            controller.renderOperations(view, [exported, pending], ports)
            await Promise.resolve()
            const button = first.capabilityProgressEl.querySelector<HTMLButtonElement>('.capability-run-progress-outputs button')!
            expect(button.textContent).toContain('Open <b>Sequence export</b>')
            expect(button.querySelector('b')).toBeNull()
            expect(second.capabilityProgressEl.textContent).toContain('Checking the operation result.')
            button.focus()
            controller.renderOperations(view, [{
                ...exported,
                updatedAt: 3,
            }, {
                ...pending,
                state: 'failed',
            }], ports)
            expect(document.activeElement).toBe(button)
            expect(first.capabilityProgressEl.querySelector('.capability-run-progress-outputs button')).toBe(button)
            button.click()
            await vi.waitFor(() => expect(ports.open).toHaveBeenCalledWith('output-asset'))
            expect(ports.resolve).toHaveBeenCalledTimes(2)
            expect(controller.getState('conversation-response:response-2')?.status).toBe('failed')
        } finally {
            controller.destroy()
            root.remove()
        }
    })

    it('buffers progress state until a response mount exists, then attaches the shared renderer', () => {
        const root = document.createElement('div')
        const view = { dom: root } as EditorView
        const controller = new CapabilityChatRunProgressController()

        controller.applyEvent(view, event(1))
        expect(controller.getState('run-1')?.lastSequence).toBe(1)
        expect(root.querySelector('.capability-run-progress')).toBeNull()

        const mount = document.createElement('div')
        mount.className = CAPABILITY_CHAT_PROGRESS_MOUNT_CLASS
        root.appendChild(mount)
        controller.sync(view)
        controller.applyEvent(view, event(2))

        expect(mount.querySelector('[data-capability-run-id="run-1"]')).not.toBeNull()
        expect(controller.getState('run-1')?.status).toBe('completed')

        controller.destroy()
        expect(mount.querySelector('.capability-run-progress')).toBeNull()
    })
})
