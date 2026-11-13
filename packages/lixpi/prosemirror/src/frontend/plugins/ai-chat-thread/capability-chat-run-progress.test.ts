// @vitest-environment happy-dom
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
    type CapabilityProgressState,
    type CapabilityRunProgressFactory,
    type CapabilityRunProgressView,
} from './capability-chat-run-progress.ts'
import { createAiResponseMessageShell } from './ai-chat-message-shells.ts'

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

// A progress panel that shows its step titles and summaries, enough to see
// which response it is attached to and what it was given.
const createProgress = vi.fn<CapabilityRunProgressFactory>(() => {
    let state: CapabilityProgressState | null = null
    const element = document.createElement('section')
    element.className = 'capability-run-progress'
    const progress: CapabilityRunProgressView = {
        element,
        replay: async () => undefined,
        render: vi.fn((run, events) => {
            state = {
                runId: run.runId,
                status: run.status,
                lastSequence: events.length,
                steps: events.map(item => ({
                    stepId: item.stepId ?? '',
                    title: item.stepTitle ?? '',
                    status: item.stepStatus ?? 'pending',
                    summary: item.safeOutputSummary,
                })),
                outputAssetIds: run.outputAssetIds,
            }
            element.textContent = state.steps.map(step => [step.title, step.summary].filter(Boolean).join(' ')).join('\n')
        }),
        applyEvent: vi.fn(item => {
            state = {
                runId: item.runId,
                status: item.runStatus ?? state?.status ?? 'running',
                lastSequence: item.sequence,
                steps: state?.steps ?? [],
                outputAssetIds: state?.outputAssetIds ?? [],
            }
        }),
        getState: () => state,
        destroy: vi.fn(() => element.remove()),
    }

    return progress
})

describe('CapabilityChatRunProgressController', () => {
    it('buffers operations for their exact response and keeps the same panel when its NodeView remounts', () => {
        const root = document.createElement('div')
        const other = createAiResponseMessageShell({ messageId: 'response-2' })
        root.append(other.wrapper)
        const view = { dom: root } as EditorView
        const controller = new CapabilityChatRunProgressController(createProgress)
        controller.renderOperations(view, [operation()])
        expect(other.capabilityProgressEl.children).toHaveLength(0)

        const first = createAiResponseMessageShell({ messageId: 'response-1' })
        root.prepend(first.wrapper)
        controller.sync(view)
        const progress = first.capabilityProgressEl.querySelector('.capability-run-progress')!
        expect(progress).not.toBeNull()
        expect(progress.textContent).toContain('Export sequence')
        expect(controller.getState('conversation-response:response-1')?.steps[0]!.status).toBe('running')

        const replacement = createAiResponseMessageShell({ messageId: 'response-1' })
        first.wrapper.replaceWith(replacement.wrapper)
        controller.sync(view)
        expect(replacement.capabilityProgressEl.firstElementChild).toBe(progress)
        expect(other.capabilityProgressEl.children).toHaveLength(0)
        controller.renderOperations(view, [])
        expect(replacement.capabilityProgressEl.children).toHaveLength(0)
        controller.destroy()
    })

    it('updates a response panel in place, passes the output ports, and skips unchanged operations', () => {
        const root = document.createElement('div')
        const first = createAiResponseMessageShell({ messageId: 'response-1' })
        const second = createAiResponseMessageShell({ messageId: 'response-2' })
        root.append(first.wrapper, second.wrapper)
        const view = { dom: root } as EditorView
        const previewRenderer = { render: vi.fn() } as never
        const controller = new CapabilityChatRunProgressController(createProgress, previewRenderer)
        const ports = {
            resolve: vi.fn(async () => ({ title: 'Sequence export' })),
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

        controller.renderOperations(view, [exported, pending], ports)
        const panel = first.capabilityProgressEl.firstElementChild
        const progress = createProgress.mock.results.at(-2)!.value as CapabilityRunProgressView

        expect(createProgress).toHaveBeenCalledWith(previewRenderer, ports)
        expect(controller.getState('conversation-response:response-1')?.outputAssetIds).toEqual(['output-asset'])
        expect(second.capabilityProgressEl.textContent).toContain('Checking the operation result.')

        controller.renderOperations(view, [exported, {
            ...pending,
            state: 'failed',
        }], ports)

        expect(first.capabilityProgressEl.firstElementChild).toBe(panel)
        expect(progress.render).toHaveBeenCalledTimes(1)
        expect(controller.getState('conversation-response:response-2')?.status).toBe('failed')
        controller.destroy()
    })

    it('buffers progress state until a response mount exists, then attaches the panel', () => {
        const root = document.createElement('div')
        const view = { dom: root } as EditorView
        const controller = new CapabilityChatRunProgressController(createProgress)

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
