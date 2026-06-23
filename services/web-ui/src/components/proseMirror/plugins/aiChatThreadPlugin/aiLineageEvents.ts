import { branchForkfIcon, branchLineIcon, branchMidIcon } from '$src/svgIcons/index.ts'
import { html } from '$src/utils/domTemplates.ts'

export type AiLineageEventKind = 'branch-origin' | 'branch-fork' | 'branch-line'

export type AiLineageProjectionScope =
    | 'conversation'
    | 'branch-origin'
    | 'branch-fork'
    | 'media-run'

export type AiLineageEventDescriptor = {
    kind: AiLineageEventKind
    branchOriginNodeId?: string
    branchForkNodeId?: string
    branchLineNodeId?: string
    // The reasoning model that drove this branch. When present, its badge renders
    // right after the event label so the lineage row names the model used.
    reasoningModelId?: string
}

export type AiLineageEventSourceAttrs = {
    branchOriginNodeId?: unknown
    branchForkNodeId?: unknown
    branchLineNodeId?: unknown
    reasoningIndex?: unknown
}

const lineageLabels: Record<AiLineageEventKind, string> = {
    'branch-origin': 'Branch started',
    'branch-fork': 'Branch fork created',
    'branch-line': 'Branch continued',
}

export function getAiLineageEventLabel(kind: AiLineageEventKind): string {
    return lineageLabels[kind] ?? ''
}

function getAiLineageEventIcon(kind: AiLineageEventKind): string {
    if (kind === 'branch-origin') return branchMidIcon
    if (kind === 'branch-line') return branchLineIcon
    return branchForkfIcon
}

function parseReasoningIndex(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function isFirstReasoningSection(attrs: Record<string, any>): boolean {
    const reasoningIndex = parseReasoningIndex(attrs.reasoningIndex)
    return reasoningIndex === null || reasoningIndex === 0
}

export function normalizeAiLineageProjectionScope(value: unknown): AiLineageProjectionScope {
    if (value === 'conversation' || value === 'branch-origin' || value === 'branch-fork' || value === 'media-run') return value
    return 'conversation'
}

export function getAiLineageEventsForProjection(
    attrs: AiLineageEventSourceAttrs,
    projectionScope: AiLineageProjectionScope = 'conversation',
): AiLineageEventDescriptor[] {
    const branchOriginNodeId = String(attrs.branchOriginNodeId ?? '')
    const branchForkNodeId = String(attrs.branchForkNodeId ?? '')
    const branchLineNodeId = String(attrs.branchLineNodeId ?? '')
    const events: AiLineageEventDescriptor[] = []

    if ((projectionScope === 'conversation' || projectionScope === 'branch-origin')
        && branchOriginNodeId
        && (projectionScope === 'branch-origin' || isFirstReasoningSection(attrs))) {
        events.push({ kind: 'branch-origin', branchOriginNodeId })
    }

    if ((projectionScope === 'conversation' || projectionScope === 'branch-fork' || projectionScope === 'media-run')
        && branchForkNodeId) {
        events.push({ kind: 'branch-fork', branchForkNodeId })
    }

    if ((projectionScope === 'conversation' || projectionScope === 'media-run')
        && branchLineNodeId) {
        events.push({ kind: 'branch-line', branchLineNodeId })
    }

    return events
}

export function getReasoningSectionLineageEvents(
    attrs: AiLineageEventSourceAttrs,
    projectionScope: AiLineageProjectionScope = 'conversation',
): AiLineageEventDescriptor[] {
    return getAiLineageEventsForProjection(attrs, projectionScope)
}

export function createAiLineageEventMarker(event: AiLineageEventDescriptor): HTMLElement {
    const label = getAiLineageEventLabel(event.kind)
    const icon = getAiLineageEventIcon(event.kind)
    return html`
        <div
            className=${`ai-lineage-event ai-lineage-event-${event.kind}`}
            title=${label}
            aria-label=${label}
            data=${{
                lineageEventKind: event.kind,
                branchOriginNodeId: event.branchOriginNodeId ?? '',
                branchForkNodeId: event.branchForkNodeId ?? '',
                branchLineNodeId: event.branchLineNodeId ?? '',
            }}
        >
            <span className="ai-lineage-event-icon" innerHTML=${icon}></span>
            <span className="ai-lineage-event-label">${label}</span>
        </div>
    ` as HTMLElement
}
