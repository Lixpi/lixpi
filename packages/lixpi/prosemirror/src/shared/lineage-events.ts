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

export const normalizeAiLineageEventKind = (value: unknown): AiLineageEventKind => {
    if (
        value === 'branch-origin'
        || value === 'branch-line'
    )
        return value

    return 'branch-fork'
}

export const getAiLineageEventLabel = (kind: AiLineageEventKind): string => lineageLabels[kind] ?? ''

const parseReasoningIndex = (value: unknown): number | null => {
    if (
        value === null
        || value === undefined
        || value === ''
    )
        return null

    const parsed = Number(value)

    return Number.isFinite(parsed) ? parsed : null
}

const isFirstReasoningSection = (attrs: AiLineageEventSourceAttrs): boolean => {
    const reasoningIndex = parseReasoningIndex(attrs.reasoningIndex)

    return reasoningIndex === null || reasoningIndex === 0
}

export const normalizeAiLineageProjectionScope = (value: unknown): AiLineageProjectionScope => {
    if (
        value === 'conversation'
        || value === 'branch-origin'
        || value === 'branch-fork'
        || value === 'media-run'
    )
        return value

    return 'conversation'
}

export const getAiLineageEventsForProjection = (
    attrs: AiLineageEventSourceAttrs,
    projectionScope: AiLineageProjectionScope = 'conversation',
): AiLineageEventDescriptor[] => {
    const branchOriginNodeId = String(attrs.branchOriginNodeId ?? '')
    const branchForkNodeId = String(attrs.branchForkNodeId ?? '')
    const branchLineNodeId = String(attrs.branchLineNodeId ?? '')
    const events: AiLineageEventDescriptor[] = []

    if (
        (projectionScope === 'conversation' || projectionScope === 'branch-origin')
        && branchOriginNodeId
        && (projectionScope === 'branch-origin' || isFirstReasoningSection(attrs))
    )
        events.push({
            kind: 'branch-origin',
            branchOriginNodeId,
        })

    if (
        (projectionScope === 'conversation' || projectionScope === 'branch-fork' || projectionScope === 'media-run')
        && branchForkNodeId
    )
        events.push({
            kind: 'branch-fork',
            branchForkNodeId,
        })

    if (
        (projectionScope === 'conversation' || projectionScope === 'media-run')
        && branchLineNodeId
    )
        events.push({
            kind: 'branch-line',
            branchLineNodeId,
        })

    return events
}

export const getReasoningSectionLineageEvents = (
    attrs: AiLineageEventSourceAttrs,
    projectionScope: AiLineageProjectionScope = 'conversation',
): AiLineageEventDescriptor[] => getAiLineageEventsForProjection(attrs, projectionScope)
