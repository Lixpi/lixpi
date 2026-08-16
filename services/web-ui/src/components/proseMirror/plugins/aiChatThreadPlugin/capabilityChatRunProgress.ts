import type { CapabilityRunEvent } from '@lixpi/constants'
import type { EditorView } from 'prosemirror-view'

import type { PromptReferencePreviewRenderer } from '$src/components/proseMirror/plugins/promptReferencePickerPlugin/index.ts'

import {
    createCapabilityRunProgress,
    type CapabilityProgressState,
    type CapabilityRunProgressInstance,
} from '$src/components/capabilityRun/index.ts'

export const CAPABILITY_CHAT_PROGRESS_MOUNT_CLASS = 'ai-response-capability-progress'

export function getLastCapabilityChatProgressMount(root: HTMLElement): HTMLElement | null {
    const mounts = root.querySelectorAll<HTMLElement>(`.${CAPABILITY_CHAT_PROGRESS_MOUNT_CLASS}`)
    return mounts.item(mounts.length - 1)
}

export class CapabilityChatRunProgressController {
    private readonly progressByRunId = new Map<string, CapabilityRunProgressInstance>()

    constructor(private readonly previewRenderer?: PromptReferencePreviewRenderer) {}

    applyEvent(view: EditorView, event: CapabilityRunEvent): void {
        let progress = this.progressByRunId.get(event.runId)
        if (!progress) {
            progress = createCapabilityRunProgress(undefined, this.previewRenderer)
            progress.element.dataset.capabilityRunId = event.runId
            this.progressByRunId.set(event.runId, progress)
        }
        progress.applyEvent(event)
        this.sync(view)
    }

    sync(view: EditorView): void {
        const mount = getLastCapabilityChatProgressMount(view.dom)
        if (!mount) return
        for (const progress of this.progressByRunId.values()) {
            if (!progress.element.isConnected) mount.appendChild(progress.element)
        }
    }

    getState(runId: string): CapabilityProgressState | null {
        return this.progressByRunId.get(runId)?.getState() ?? null
    }

    destroy(): void {
        for (const progress of this.progressByRunId.values()) progress.destroy()
        this.progressByRunId.clear()
    }
}
