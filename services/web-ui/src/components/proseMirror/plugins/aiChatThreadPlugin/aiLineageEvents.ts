import { branchForkfIcon, branchLineIcon, branchMidIcon } from '$src/svgIcons/index.ts'
import { html } from '$src/utils/domTemplates.ts'
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

function getAiLineageEventIcon(kind: AiLineageEventKind): string {
    if (kind === 'branch-origin') return branchMidIcon
    if (kind === 'branch-line') return branchLineIcon
    return branchForkfIcon
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
