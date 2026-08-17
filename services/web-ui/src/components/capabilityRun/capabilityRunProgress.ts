import type {
    CapabilityRun,
    CapabilityRunEvent,
    CapabilityRunStepStatus,
    ExecutionTrace,
} from '@lixpi/constants'
import {
    createProgressTimeline,
    type ProgressTimelineInstance,
    type ProgressTimelineItem,
} from '@lixpi/ui-kit/components/progress-timeline'

import { createExecutionTraceTimelineDetailAdapter } from '$src/components/executionTrace/index.ts'
import type { PromptReferencePreviewRenderer } from '$src/components/proseMirror/plugins/promptReferencePickerPlugin/index.ts'

import type { CapabilityCatalogClient } from '$src/services/capability-catalog-client.ts'
import { html } from '$src/utils/domTemplates.ts'

export type CapabilityProgressStep = {
    stepId: string
    title: string
    status: CapabilityRunStepStatus
    summary?: string
    error?: string
    trace?: ExecutionTrace
}

export type CapabilityProgressState = {
    runId: string
    status: CapabilityRun['status']
    lastSequence: number
    steps: CapabilityProgressStep[]
    outputAssetIds: string[]
}

export function projectCapabilityRunEvents(
    run: CapabilityRun,
    events: CapabilityRunEvent[],
): CapabilityProgressState {
    const state: CapabilityProgressState = {
        runId: run.runId,
        status: run.status,
        lastSequence: 0,
        steps: [],
        outputAssetIds: [...run.outputAssetIds],
    }
    const stepsById = new Map<string, CapabilityProgressStep>()

    for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
        if (event.sequence <= state.lastSequence) continue
        state.lastSequence = event.sequence
        state.status = event.runStatus
        if (event.outputAssetIds) state.outputAssetIds = Array.from(new Set([...state.outputAssetIds, ...event.outputAssetIds]))
        if (!event.stepId || !event.stepStatus) continue

        const step = stepsById.get(event.stepId) ?? {
            stepId: event.stepId,
            title: event.stepTitle ?? event.stepId,
            status: 'pending',
        }
        step.title = event.stepTitle ?? step.title
        step.status = event.stepStatus
        step.summary = event.safeOutputSummary ?? event.safeInputSummary ?? step.summary
        step.error = event.errorMessage ?? step.error
        step.trace = event.trace ?? step.trace
        if (!stepsById.has(event.stepId)) {
            stepsById.set(event.stepId, step)
            state.steps.push(step)
        }
    }
    return state
}

export type CapabilityRunProgressInstance = {
    readonly element: HTMLElement
    replay: (runId: string) => Promise<void>
    render: (run: CapabilityRun, events: CapabilityRunEvent[]) => void
    applyEvent: (event: CapabilityRunEvent) => void
    getState: () => CapabilityProgressState | null
    destroy: () => void
}

class CapabilityRunProgress implements CapabilityRunProgressInstance {
    readonly element = html`<section className="capability-run-progress" aria-live="polite"></section>` as HTMLElement
    private readonly timeline: ProgressTimelineInstance
    private replaySequence = 0
    private run: CapabilityRun | null = null
    private readonly eventsBySequence = new Map<number, CapabilityRunEvent>()
    private unsubscribeFromLiveEvents: (() => void) | null = null
    private projectedState: CapabilityProgressState | null = null

    constructor(
        private readonly client?: Pick<CapabilityCatalogClient, 'replay' | 'subscribeToRunEvents'>,
        previewRenderer?: PromptReferencePreviewRenderer,
    ) {
        this.timeline = createProgressTimeline({
            ariaLabel: 'Tool run progress',
            ...createExecutionTraceTimelineDetailAdapter(previewRenderer ? { previewRenderer } : {}),
        })
    }

    async replay(runId: string): Promise<void> {
        if (!this.client) throw new Error('Capability run replay requires a catalog client')
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
            this.unsubscribeFromLiveEvents = this.client.subscribeToRunEvents(runId, (event) => {
                if (replaySequence !== this.replaySequence) return
                if (!replayComplete) {
                    bufferedLiveEvents.push(event)
                    return
                }
                this.applyEvent(event)
            })
            let cursor: string | undefined
            do {
                const page = await this.client.replay(runId, cursor)
                if (replaySequence !== this.replaySequence) return
                this.run = page.run
                page.events.forEach((event) => this.eventsBySequence.set(event.sequence, event))
                cursor = page.cursor
            } while (cursor)
            bufferedLiveEvents.forEach((event) => this.eventsBySequence.set(event.sequence, event))
            replayComplete = true
            this.renderCurrentState()
            this.stopLiveEventsIfSettled()
        } catch {
            if (replaySequence !== this.replaySequence) return
            this.unsubscribeFromLiveEvents?.()
            this.unsubscribeFromLiveEvents = null
            this.element.replaceChildren(html`<div className="capability-run-progress-status capability-run-step-error">Could not replay this Tool run.</div>`)
        }
    }

    render(run: CapabilityRun, events: CapabilityRunEvent[]): void {
        this.run = run
        this.eventsBySequence.clear()
        events.forEach((event) => this.eventsBySequence.set(event.sequence, event))
        this.renderCurrentState()
    }

    applyEvent(event: CapabilityRunEvent): void {
        if (this.run && this.run.runId !== event.runId) return
        this.run ??= createStreamedCapabilityRun(event)
        this.eventsBySequence.set(event.sequence, event)
        this.renderCurrentState()
        this.stopLiveEventsIfSettled()
    }

    getState(): CapabilityProgressState | null {
        return this.projectedState
    }

    private renderCurrentState(): void {
        if (!this.run) return
        const state = projectCapabilityRunEvents(this.run, [...this.eventsBySequence.values()])
        this.projectedState = state
        const steps: ProgressTimelineItem[] = state.steps.map((step) => ({
            id: step.stepId,
            title: step.title,
            status: step.status,
            summary: step.error ?? step.summary,
            ...(step.trace ? { detail: step.trace } : {}),
        }))
        this.timeline.setItems(steps)
        this.element.replaceChildren(html`
            <header className="capability-run-progress-header">
                <strong>Tool run</strong>
                <span>${state.status}</span>
            </header>
        `, this.timeline.element)
    }

    private stopLiveEventsIfSettled(): void {
        if (!this.projectedState || !isTerminalCapabilityRunStatus(this.projectedState.status)) return
        this.unsubscribeFromLiveEvents?.()
        this.unsubscribeFromLiveEvents = null
    }

    destroy(): void {
        this.replaySequence += 1
        this.unsubscribeFromLiveEvents?.()
        this.unsubscribeFromLiveEvents = null
        this.timeline.destroy()
        this.element.remove()
    }
}

export function createCapabilityRunProgress(
    client?: Pick<CapabilityCatalogClient, 'replay' | 'subscribeToRunEvents'>,
    previewRenderer?: PromptReferencePreviewRenderer,
): CapabilityRunProgressInstance {
    return new CapabilityRunProgress(client, previewRenderer)
}

function createStreamedCapabilityRun(event: CapabilityRunEvent): CapabilityRun {
    return {
        runId: event.runId,
        rootCapabilityId: '',
        resolvedManifests: [],
        workspaceId: '',
        origin: 'model',
        status: event.runStatus,
        currentStepIds: event.stepId && event.stepStatus === 'running' ? [event.stepId] : [],
        outputAssetIds: event.outputAssetIds ?? [],
        eventStreamName: '',
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
    }
}

function isTerminalCapabilityRunStatus(status: CapabilityRun['status']): boolean {
    return status === 'completed' || status === 'failed' || status === 'cancelled'
}
