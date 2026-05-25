'use strict'

import type { CanvasFeatureExtractionState, StageTraceEvent } from '@lixpi/constants'

// Pure, DOM-free reducer that folds the backend's StageTraceEvent stream into the
// four user-facing phases the extraction tab renders. Kept separate from the DOM
// rendering in extractionTab.ts so it can be unit-tested in isolation.
//
// The backend runs a fixed 6-stage graph (router → extractors ‖ crops → synthesis
// → samples → persist). Those stages map onto four phases; `terminal` is the stage
// whose 'ok' marks a phase complete. Stages 2 and 5 are parallel fan-outs whose
// children (extractor:<axis>, sample:<idx>) become the phase's substeps.

export type SubstepStatus = StageTraceEvent['status']
export type PhaseStatus = 'pending' | 'active' | 'done' | 'error'

export type SubstepView = {
    stage: string
    label: string
    model?: string
    durationMs: number
    status: SubstepStatus
    summary?: string
    promptPreview?: string
    errorMessage?: string
    // Live streamed model output (thinking tokens) for this stage, if any.
    liveOutput?: string
}

export type PhaseView = {
    key: string
    label: string
    status: PhaseStatus
    durationMs?: number
    meta?: string
    substeps: SubstepView[]
}

type ExtractionPhaseConfig = { key: string; label: string; terminal: string }

export const EXTRACTION_PHASES: ExtractionPhaseConfig[] = [
    { key: 'analyze', label: 'Analyze input', terminal: 'router' },
    { key: 'extract', label: 'Extract feature', terminal: 'synthesis' },
    { key: 'generate', label: 'Generate samples', terminal: 'samples' },
    { key: 'save', label: 'Save to library', terminal: 'persist' },
]

// Maps a backend stage name to the phase it belongs to and how it is rendered.
// `container` events are the outer fan-out spans ('extractors', 'samples') — their
// children are the real substeps, so the container only contributes a phase summary.
type StageClassification = { phaseKey: string; kind: 'substep' | 'container'; label: string }

export function classifyStage(stage: string): StageClassification {
    if (stage === 'router') return { phaseKey: 'analyze', kind: 'substep', label: 'Scene assessment & router' }
    if (stage.startsWith('extractor:')) return { phaseKey: 'extract', kind: 'substep', label: `${stage.slice('extractor:'.length)} extractor` }
    if (stage === 'extractors') return { phaseKey: 'extract', kind: 'container', label: 'Parallel extractors' }
    if (stage === 'crops') return { phaseKey: 'extract', kind: 'substep', label: 'Source crop materialization' }
    if (stage === 'synthesis') return { phaseKey: 'extract', kind: 'substep', label: 'Dominance-weighted synthesis' }
    if (stage.startsWith('sample:')) return { phaseKey: 'generate', kind: 'substep', label: `Sample ${stage.slice('sample:'.length)}` }
    if (stage === 'samples') return { phaseKey: 'generate', kind: 'container', label: 'Sample generation' }
    if (stage === 'persist') return { phaseKey: 'save', kind: 'substep', label: 'Persist & publish' }
    // Unknown stage — surface it under Extract rather than dropping it. Nothing is silenced.
    return { phaseKey: 'extract', kind: 'substep', label: stage }
}

export function formatStageDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60_000).toFixed(1)}min`
}

function buildSubstepView(event: StageTraceEvent): SubstepView {
    const classification = classifyStage(event.stage)
    let label = classification.label
    // Enrich sample substeps with their kind ('palette-board', 'applied-medium-probe', …).
    if (event.stage.startsWith('sample:')) {
        const kind = /kind=([\w-]+)/.exec(event.inputSummary ?? '')?.[1]
        if (kind) label = `${label} · ${kind}`
    }
    return {
        stage: event.stage,
        label,
        model: event.modelName || undefined,
        durationMs: event.durationMs,
        status: event.status,
        summary: event.outputSummary || event.inputSummary || undefined,
        promptPreview: event.promptPreview || undefined,
        errorMessage: event.errorMessage || undefined,
    }
}

// Folds the trace-event stream into the four-phase view model. `isLive` enables
// anticipatory "active" state (so a not-yet-started phase can spin while streaming)
// and is false when replaying persisted state on reload (no perpetual spinners).
export function computeExtractionTimelineModel(
    traceEvents: StageTraceEvent[],
    currentStatus: CanvasFeatureExtractionState['status'],
    isLive: boolean,
    stageReasoning: Record<string, string> = {},
): PhaseView[] {
    const buckets = new Map<string, { substeps: Map<string, StageTraceEvent>; container?: StageTraceEvent }>()
    for (const phase of EXTRACTION_PHASES) buckets.set(phase.key, { substeps: new Map() })

    for (const event of traceEvents) {
        const classification = classifyStage(event.stage)
        const bucket = buckets.get(classification.phaseKey)!
        // Upsert by stage so a 'running' marker is replaced by its terminal event.
        if (classification.kind === 'container') bucket.container = event
        else bucket.substeps.set(event.stage, event)
    }

    const failed = currentStatus === 'failed'
    const completed = currentStatus === 'completed'
    let blocked = false
    let previousDone = true
    const phases: PhaseView[] = []

    for (const phase of EXTRACTION_PHASES) {
        const bucket = buckets.get(phase.key)!
        const events = [...bucket.substeps.values()]
        if (bucket.container) events.push(bucket.container)

        const terminalEvent = bucket.container?.stage === phase.terminal
            ? bucket.container
            : bucket.substeps.get(phase.terminal)
        const hasError = events.some((event) => event.status === 'error')
        const hasRunning = events.some((event) => event.status === 'running')
        const present = events.length > 0
        const terminalOk = terminalEvent?.status === 'ok'

        let status: PhaseStatus
        if (hasError) {
            status = 'error'
            blocked = true
        } else if (completed) {
            // A completed run finished the whole pipeline; show every phase done even
            // if an older persisted run is missing some terminal trace events.
            status = 'done'
        } else if (terminalOk) {
            status = 'done'
        } else if (blocked) {
            status = 'pending'
        } else if (present) {
            status = (hasRunning || isLive) ? 'active' : 'pending'
        } else if (previousDone && isLive && !failed && !completed) {
            status = 'active'
        } else {
            status = 'pending'
        }

        const substeps = [...bucket.substeps.values()]
            .sort((a, b) => a.startedAt - b.startedAt)
            .map((substepEvent) => ({
                ...buildSubstepView(substepEvent),
                liveOutput: stageReasoning[substepEvent.stage] || undefined,
            }))

        const finished = events.filter((event) => event.finishedAt > 0)
        const durationMs = status === 'done' && finished.length > 0
            ? Math.max(...finished.map((event) => event.finishedAt)) - Math.min(...finished.map((event) => event.startedAt))
            : undefined

        phases.push({
            key: phase.key,
            label: phase.label,
            status,
            durationMs,
            meta: bucket.container?.outputSummary || undefined,
            substeps,
        })
        previousDone = status === 'done'
    }

    return phases
}
