import {
    branchForkfIcon,
    branchLineIcon,
    branchMidIcon,
} from '@lixpi/ui-kit/svg'
import { html } from '@lixpi/ui-primitives/dom'
import {
    getAiLineageEventLabel,
    getAiLineageEventsForProjection,
    getReasoningSectionLineageEvents,
    normalizeAiLineageProjectionScope,
    type AiLineageEventDescriptor,
    type AiLineageEventKind,
    type AiLineageEventSourceAttrs,
    type AiLineageProjectionScope,
} from '@lixpi/prosemirror'

export {
    getAiLineageEventLabel,
    getAiLineageEventsForProjection,
    getReasoningSectionLineageEvents,
    normalizeAiLineageProjectionScope,
    type AiLineageEventDescriptor,
    type AiLineageEventKind,
    type AiLineageEventSourceAttrs,
    type AiLineageProjectionScope,
}

const getAiLineageEventIcon = (kind: AiLineageEventKind): string => {
    if (kind === 'branch-origin')
        return branchMidIcon

    if (kind === 'branch-line')
        return branchLineIcon

    return branchForkfIcon
}

export const createAiLineageEventMarker = (event: AiLineageEventDescriptor): HTMLElement => {
    const label = getAiLineageEventLabel(event.kind)
    const icon = getAiLineageEventIcon(event.kind)

    return html`
        <div
            className=${`ai-lineage-event ai-lineage-event-${event.kind}`}
            aria-label=${label}
            data=${{
                helpTooltip: 'aria-label',
                lineageEventKind: event.kind,
                branchOriginNodeId: event.branchOriginNodeId ?? '',
                branchForkNodeId: event.branchForkNodeId ?? '',
                branchLineNodeId: event.branchLineNodeId ?? '',
            }}
        >
            <span
                className="ai-lineage-event-icon"
                innerHTML=${icon}
            ></span>
            <span className="ai-lineage-event-label">${label}</span>
        </div>
    ` as HTMLElement
}
