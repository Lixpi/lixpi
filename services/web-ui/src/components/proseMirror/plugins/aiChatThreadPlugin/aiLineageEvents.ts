import { branchForkfIcon, branchMidIcon } from '$src/svgIcons/index.ts'
import { html } from '$src/utils/domTemplates.ts'

export type AiLineageEventKind = 'branch-origin' | 'branch-fork'

export type AiLineageProjectionScope =
    | 'conversation'
    | 'branch-origin'
    | 'branch-fork'
    | 'media-run'

export type AiLineageEventDescriptor = {
    kind: AiLineageEventKind
    branchOriginNodeId?: string
    branchForkNodeId?: string
}

export type AiLineageEventSourceAttrs = {
    branchOriginNodeId?: unknown
    branchForkNodeId?: unknown
    reasoningIndex?: unknown
}

const lineageLabels: Record<AiLineageEventKind, string> = {
    'branch-origin': 'Branch started',
    'branch-fork': 'Branch fork created',
}

export function getAiLineageEventLabel(kind: AiLineageEventKind): string {
    return lineageLabels[kind] ?? ''
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
    const icon = event.kind === 'branch-origin' ? branchMidIcon : branchForkfIcon
    return html`
        <div
            className=${`ai-lineage-event ai-lineage-event-${event.kind}`}
            title=${label}
            aria-label=${label}
            data=${{
                lineageEventKind: event.kind,
                branchOriginNodeId: event.branchOriginNodeId ?? '',
                branchForkNodeId: event.branchForkNodeId ?? '',
            }}
        >
            <span className="ai-lineage-event-icon" innerHTML=${icon}></span>
            <span className="ai-lineage-event-label">${label}</span>
        </div>
    ` as HTMLElement
}
