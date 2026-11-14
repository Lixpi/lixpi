import {
    type CapabilityRun,
    type CapabilityRunEvent,
} from '@lixpi/constants'
import {
    createProgressTimeline,
    type ProgressTimelineInstance,
    type ProgressTimelineItem,
} from '@lixpi/ui-kit/components/progress-timeline'

import { createExecutionTraceTimelineDetailAdapter } from '$src/components/executionTrace/index.ts'
import {
    type PromptReferencePreviewRenderer,
} from '@lixpi/canvas-components/workspace/context'
import {
    type WorkspaceConversationOutputPorts,
} from '@lixpi/canvas-components/workspace'
import {
    type CapabilityProgressState,
    type CapabilityProgressStep,
    type CapabilityRunProgressView,
} from '@lixpi/prosemirror/frontend/editor'

import {
    type CapabilityCatalogClient,
} from '$src/services/capability-catalog-client.ts'
import { html } from '@lixpi/ui-primitives/dom'

const createStreamedCapabilityRun = (event: CapabilityRunEvent): CapabilityRun => ({
    runId: event.runId,
    rootCapabilityId: '',
    resolvedManifests: [],
    workspaceId: '',
    origin: 'model',
    status: event.runStatus,
    currentStepIds: event.stepId
        && event.stepStatus === 'running'
        ? [event.stepId]
        : [],
    outputAssetIds: event.outputAssetIds ?? [],
    eventStreamName: '',
    createdAt: event.timestamp,
    updatedAt: event.timestamp,
})

const isTerminalCapabilityRunStatus = (status: CapabilityRun['status']): boolean =>
    status === 'completed' || status === 'failed' || status === 'cancelled'

export const projectCapabilityRunEvents = (
    run: CapabilityRun,
    events: CapabilityRunEvent[],
): CapabilityProgressState => {
    const state: CapabilityProgressState = {
        runId: run.runId,
        status: run.status,
        lastSequence: 0,
        steps: [],
        outputAssetIds: [...run.outputAssetIds],
    }
    const stepsById = new Map<string, CapabilityProgressStep>()

    for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
        if (event.sequence <= state.lastSequence)
            continue

        state.lastSequence = event.sequence
        state.status = event.runStatus

        if (event.outputAssetIds)
            state.outputAssetIds = Array.from(
                new Set([
                    ...state.outputAssetIds,
                    ...event.outputAssetIds,
                ]),
            )

        if (
            !event.stepId
            || !event.stepStatus
        )
            continue

        const step = stepsById.get(event.stepId) ?? {
            stepId: event.stepId,
            title: event.stepTitle ?? event.stepId,
            status: 'pending',
        }
        step.title = event.stepTitle ?? step.title
        step.status = event.stepStatus
        step.summary = event.safeOutputSummary
            ?? event.safeInputSummary
            ?? step.summary
        step.error = event.errorMessage ?? step.error
        step.trace = event.trace ?? step.trace

        if (!stepsById.has(event.stepId)) {
            stepsById.set(event.stepId, step)
            state.steps.push(step)
        }
    }

    return state
}

export type CapabilityRunProgressInstance = CapabilityRunProgressView

class CapabilityRunProgress implements CapabilityRunProgressInstance {
    readonly element = html`
        <section className="capability-run-progress"></section>
    ` as HTMLElement
    private readonly timeline: ProgressTimelineInstance
    private readonly status = html`
        <span
            className="capability-run-progress-status"
            role="status"
        ></span>
    ` as HTMLElement
    private readonly label = html`<span className="capability-run-progress-label">Tool activity</span>` as HTMLElement
    private readonly header = html`
        <summary className="capability-run-progress-header">
            ${this.label}${this.status}
        </summary>
    ` as HTMLElement
    private readonly details = html`
        <details className="capability-run-progress-details">
            ${this.header}
        </details>
    ` as HTMLDetailsElement
    private readonly outputs = html`
        <ul
            className="capability-run-progress-outputs"
            aria-label="Outputs"
        ></ul>
    ` as HTMLElement
    private readonly outputRows = new Map<string, HTMLElement>()
    private replaySequence = 0
    private run: CapabilityRun | null = null
    private readonly eventsBySequence = new Map<number, CapabilityRunEvent>()
    private unsubscribeFromLiveEvents: (() => void) | null = null
    private projectedState: CapabilityProgressState | null = null

    constructor(
        private readonly client?: Pick<CapabilityCatalogClient, 'replay' | 'subscribeToRunEvents'>,
        previewRenderer?: PromptReferencePreviewRenderer,
        private readonly outputPorts?: WorkspaceConversationOutputPorts,
    ) {
        this.timeline = createProgressTimeline({
            ariaLabel: 'Tool run progress',
            ...createExecutionTraceTimelineDetailAdapter(previewRenderer ? { previewRenderer } : {}),
        })
        this.details.append(this.timeline.element)
        this.element.append(this.details, this.outputs)
    }

    async replay(runId: string): Promise<void> {
        if (!this.client)
            throw new Error('Capability run replay requires a catalog client')

        const replaySequence = ++this.replaySequence
        this.unsubscribeFromLiveEvents?.()
        this.unsubscribeFromLiveEvents = null
        this.run = null
        this.eventsBySequence.clear()
        this.projectedState = null
        this.element.replaceChildren(html`<div className="capability-run-progress-status">Loading run…</div>`)
        const bufferedLiveEvents: CapabilityRunEvent[] = []
        let replayComplete = false

        try {
            this.unsubscribeFromLiveEvents = this.client.subscribeToRunEvents(runId, event => {
                if (replaySequence !== this.replaySequence)
                    return

                if (!replayComplete) {
                    bufferedLiveEvents.push(event)

                    return
                }

                this.applyEvent(event)
            })
            let cursor: string | undefined

            do {
                const page = await this.client.replay(runId, cursor)

                if (replaySequence !== this.replaySequence)
                    return

                this.run = page.run
                page.events.forEach(event => this.eventsBySequence.set(event.sequence, event))
                cursor = page.cursor
            } while (cursor)

            bufferedLiveEvents.forEach(event => this.eventsBySequence.set(event.sequence, event))
            replayComplete = true
            this.renderCurrentState()
            this.stopLiveEventsIfSettled()
        } catch {
            if (replaySequence !== this.replaySequence)
                return

            this.unsubscribeFromLiveEvents?.()
            this.unsubscribeFromLiveEvents = null
            this.element.replaceChildren(
                html`<div className="capability-run-progress-status capability-run-step-error">Could not replay this Tool run.</div>`,
            )
        }
    }

    render(
        run: CapabilityRun,
        events: CapabilityRunEvent[],
    ): void {
        this.run = run
        this.eventsBySequence.clear()
        events.forEach(event => this.eventsBySequence.set(event.sequence, event))
        this.renderCurrentState()
    }

    applyEvent(event: CapabilityRunEvent): void {
        if (
            this.run
            && this.run.runId !== event.runId
        )
            return

        this.run ??= createStreamedCapabilityRun(event)
        this.eventsBySequence.set(event.sequence, event)
        this.renderCurrentState()
        this.stopLiveEventsIfSettled()
    }

    getState(): CapabilityProgressState | null {
        return this.projectedState
    }

    private renderCurrentState(): void {
        if (!this.run)
            return

        const state = projectCapabilityRunEvents(this.run, [...this.eventsBySequence.values()])
        this.projectedState = state
        const steps: ProgressTimelineItem[] = state.steps.map(
            step => ({
                id: step.stepId,
                title: step.title,
                status: step.status,
                summary: step.error ?? step.summary,
                ...(step.trace ? { detail: step.trace } : {}),
            }),
        )
        this.timeline.setItems(steps)
        const labels: Record<CapabilityRun['status'], string> = {
            pending: 'Waiting',
            running: 'Working',
            completed: 'Completed',
            failed: 'Needs attention',
            cancelled: 'Stopped',
        }
        const activeStep = state.steps.find(step => step.status === 'running')
        this.label.textContent = state.status === 'running' ? (activeStep?.title ?? 'Tool activity') : 'Tool activity'
        this.status.textContent = labels[state.status]
        this.element.dataset.state = state.status

        if (this.details.parentElement !== this.element)
            this.element.replaceChildren(this.details, this.outputs)

        this.renderOutputs(state.outputAssetIds)
    }

    private renderOutputs(assetIds: string[]): void {
        const ids = new Set(this.outputPorts ? assetIds : [])

        for (const [assetId, row] of this.outputRows)
            if (!ids.has(assetId)) {
                row.remove()
                this.outputRows.delete(assetId)
            }

        for (const assetId of ids) {
            if (this.outputRows.has(assetId))
                continue

            const row = html`<li>Loading output...</li>` as HTMLElement
            this.outputRows.set(assetId, row)
            this.outputs.append(row)
            void this.resolveOutput(assetId, row)
        }

        this.outputs.hidden = ids.size === 0
    }

    private async resolveOutput(
        assetId: string,
        row: HTMLElement,
    ): Promise<void> {
        if (!this.outputPorts)
            return

        try {
            const output = await this.outputPorts.resolve(assetId)

            if (this.outputRows.get(assetId) !== row)
                return

            const button = html`
                <button
                    type="button"
                    onclick=${() => void this.openOutput(
                        assetId,
                        button,
                        error,
                    )}
                >
                    Open ${output.title}
                </button>
            ` as HTMLButtonElement
            const error = html`
                <span
                    className="capability-run-step-error"
                    role="status"
                ></span>
            ` as HTMLElement
            row.replaceChildren(button, error)
        } catch {
            if (this.outputRows.get(assetId) === row)
                row.textContent = 'Output unavailable'
        }
    }

    private async openOutput(
        assetId: string,
        button: HTMLButtonElement,
        error: HTMLElement,
    ): Promise<void> {
        if (!this.outputPorts)
            return

        button.disabled = true
        error.textContent = ''

        try {
            await this.outputPorts.resolve(assetId)

            if (!this.outputRows.has(assetId))
                return

            await this.outputPorts.open(assetId)
        } catch {
            error.textContent = 'Could not open this output.'
        } finally {
            button.disabled = false
        }
    }

    private stopLiveEventsIfSettled(): void {
        if (
            !this.projectedState
            || !isTerminalCapabilityRunStatus(this.projectedState.status)
        )
            return

        this.unsubscribeFromLiveEvents?.()
        this.unsubscribeFromLiveEvents = null
    }

    destroy(): void {
        this.replaySequence += 1
        this.unsubscribeFromLiveEvents?.()
        this.unsubscribeFromLiveEvents = null
        this.timeline.destroy()
        this.outputRows.clear()
        this.element.remove()
    }
}

export const createCapabilityRunProgress = (
    client?: Pick<CapabilityCatalogClient, 'replay' | 'subscribeToRunEvents'>,
    previewRenderer?: PromptReferencePreviewRenderer,
    outputPorts?: WorkspaceConversationOutputPorts,
): CapabilityRunProgressInstance => new CapabilityRunProgress(
    client,
    previewRenderer,
    outputPorts,
)
