import {
    type CapabilityRunEvent,
    type CapabilityRun,
    type CapabilityRunStepStatus,
    type ConversationOperationSummary,
} from '@lixpi/constants'
import {
    type EditorView,
} from 'prosemirror-view'

import {
    type PromptReferencePreviewRenderer,
} from '@lixpi/canvas-components-lixpi-specific/frontend/context'
import {
    type WorkspaceConversationOutputPorts,
} from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'

import {
    createCapabilityRunProgress,
    type CapabilityProgressState,
    type CapabilityRunProgressInstance,
} from '$src/components/capabilityRun/index.ts'

export const CAPABILITY_CHAT_PROGRESS_MOUNT_CLASS = 'ai-response-capability-progress'

export const getLastCapabilityChatProgressMount = (root: HTMLElement): HTMLElement | null => {
    const mounts = root.querySelectorAll<HTMLElement>(`.${CAPABILITY_CHAT_PROGRESS_MOUNT_CLASS}`)

    return mounts.item(mounts.length - 1)
}

const operationStepStatus: Record<ConversationOperationSummary['state'], CapabilityRunStepStatus> = {
    prepared: 'pending',
    authorized: 'pending',
    submitted: 'running',
    running: 'running',
    succeeded: 'completed',
    failed: 'failed',
    cancelled: 'cancelled',
    'outcome-unknown': 'running',
}

export class CapabilityChatRunProgressController {
    private readonly progressByRunId = new Map<string, CapabilityRunProgressInstance>()
    private readonly responseByRunId = new Map<string, string>()
    private readonly operationSignatures = new Map<string, string>()

    constructor(private readonly previewRenderer?: PromptReferencePreviewRenderer) {}

    applyEvent(
        view: EditorView,
        event: CapabilityRunEvent,
    ): void {
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
        for (const [runId, progress] of this.progressByRunId) {
            const responseMessageId = this.responseByRunId.get(runId)
            const mount = responseMessageId
                ? [...view.dom.querySelectorAll<HTMLElement>('.ai-response-message-wrapper')]
                    .find(element => element.dataset.messageId === responseMessageId)
                    ?.querySelector<HTMLElement>(`.${CAPABILITY_CHAT_PROGRESS_MOUNT_CLASS}`)
                : getLastCapabilityChatProgressMount(view.dom)

            if (
                mount
                && (responseMessageId ? progress.element.parentElement !== mount : !progress.element.isConnected)
            )
                mount.append(progress.element)
        }
    }

    renderOperations(
        view: EditorView,
        operations: ConversationOperationSummary[],
        outputPorts?: WorkspaceConversationOutputPorts,
    ): void {
        const byResponse = new Map<string, ConversationOperationSummary[]>()

        for (const operation of operations) {
            const group = byResponse.get(operation.responseMessageId) ?? []
            group.push(operation)
            byResponse.set(operation.responseMessageId, group)
        }

        const retained = new Set<string>()

        for (const [responseMessageId, group] of byResponse) {
            const runId = `conversation-response:${responseMessageId}`
            retained.add(runId)
            group.sort((left, right) => left.createdAt - right.createdAt || left.operationId.localeCompare(right.operationId))
            const signature = JSON.stringify(group)

            if (this.operationSignatures.get(runId) === signature)
                continue

            let progress = this.progressByRunId.get(runId)

            if (!progress) {
                progress = createCapabilityRunProgress(
                    undefined,
                    this.previewRenderer,
                    outputPorts,
                )
                progress.element.dataset.responseMessageId = responseMessageId
                this.progressByRunId.set(runId, progress)
                this.responseByRunId.set(runId, responseMessageId)
            }

            this.operationSignatures.set(runId, signature)
            const statuses = group.map(operation => operationStepStatus[operation.state])
            const status: CapabilityRun['status'] = statuses.some(value => value === 'running' || value === 'pending')
                ? 'running'
                : statuses.includes('failed')
                    ? 'failed'
                    : statuses.includes('cancelled')
                        ? 'cancelled'
                        : 'completed'
            const run: CapabilityRun = {
                runId,
                rootCapabilityId: '',
                resolvedManifests: [],
                workspaceId: '',
                origin: 'model',
                status,
                currentStepIds: group.filter(operation => operationStepStatus[operation.state] === 'running').map(operation => operation.operationId),
                outputAssetIds: [...new Set(
                    group.flatMap(operation => Object.values(operation.outputAssetIds)),
                )],
                eventStreamName: '',
                createdAt: group[0].createdAt,
                updatedAt: Math.max(...group.map(operation => operation.updatedAt)),
            }
            progress.render(
                run,
                group.map(
                    (operation, index) => ({
                        runId,
                        sequence: index + 1,
                        eventType: operation.state === 'succeeded'
                            ? 'STEP_COMPLETED'
                            : operation.state === 'failed'
                                ? 'STEP_FAILED'
                                : operation.state === 'cancelled'
                                    ? 'STEP_CANCELLED'
                                    : 'STEP_STARTED',
                        timestamp: operation.updatedAt,
                        runStatus: status,
                        stepId: operation.operationId,
                        stepTitle: operation.stepLabel ?? operation.operationKey.replace(/[._-]+/gu, ' '),
                        stepStatus: operationStepStatus[operation.state],
                        safeOutputSummary: operation.state === 'outcome-unknown' ? 'Checking the operation result.' : undefined,
                        errorMessage: operation.error?.message,
                    }),
                ),
            )
        }

        for (const runId of this.operationSignatures.keys())
            if (!retained.has(runId)) {
                this.progressByRunId.get(runId)?.destroy()
                this.progressByRunId.delete(runId)
                this.responseByRunId.delete(runId)
                this.operationSignatures.delete(runId)
            }

        this.sync(view)
    }

    getState(runId: string): CapabilityProgressState | null {
        return this.progressByRunId.get(runId)?.getState() ?? null
    }

    destroy(): void {
        for (const progress of this.progressByRunId.values())
            progress.destroy()

        this.progressByRunId.clear()
        this.responseByRunId.clear()
        this.operationSignatures.clear()
    }
}
