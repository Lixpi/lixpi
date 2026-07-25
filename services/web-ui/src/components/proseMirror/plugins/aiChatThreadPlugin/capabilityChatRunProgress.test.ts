import { describe, expect, it } from 'vitest'
import type { CapabilityRunEvent } from '@lixpi/constants'
import type { EditorView } from 'prosemirror-view'

import {
    CAPABILITY_CHAT_PROGRESS_MOUNT_CLASS,
    CapabilityChatRunProgressController,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/capabilityChatRunProgress.ts'

function event(sequence: number): CapabilityRunEvent {
    return {
        runId: 'run-1',
        sequence,
        eventType: sequence === 1 ? 'RUN_STARTED' : 'RUN_COMPLETED',
        timestamp: sequence,
        runStatus: sequence === 1 ? 'running' : 'completed',
    }
}

describe('CapabilityChatRunProgressController', () => {
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
