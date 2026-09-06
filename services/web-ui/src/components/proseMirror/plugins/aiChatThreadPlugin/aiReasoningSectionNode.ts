// @ts-nocheck
// A single reasoning model's slice of a multi-model response. One user prompt
// produces ONE aiResponseMessage; inside it, each selected reasoning model gets
// its own aiReasoningSection holding that model's reply text, its image/video
// generation trace, and its generated media — kept separate so the
// concurrently-streaming models never interleave their content.
import { html } from '@lixpi/ui-primitives/dom'
import {
    aiReasoningSectionNodeSpec,
    aiReasoningSectionNodeType,
    getReasoningSectionLineageEvents,
    normalizeAiLineageProjectionScope,
} from '@lixpi/prosemirror'
import { createAiLineageEventMarker } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiLineageEvents.ts'

export {
    aiReasoningSectionNodeSpec,
    aiReasoningSectionNodeType,
}

export const aiReasoningSectionNodeView = node => {
    const dom = html`
        <div
            className="ai-reasoning-section"
            data=${{
                generationRequestId: node.attrs.generationRequestId || '',
                reasoningRunId: node.attrs.reasoningRunId || '',
                reasoningModelId: node.attrs.reasoningModelId || '',
                reasoningIndex: node.attrs.reasoningIndex == null ? '' : String(node.attrs.reasoningIndex),
                branchOriginNodeId: node.attrs.branchOriginNodeId || '',
                branchForkNodeId: node.attrs.branchForkNodeId || '',
                branchLineNodeId: node.attrs.branchLineNodeId || '',
                lineageProjectionScope: node.attrs.lineageProjectionScope || 'conversation',
            }}
        >
            <div className="ai-reasoning-section-lineage-markers"></div>
            <div className="ai-reasoning-section-content"></div>
            <div
                className="ai-reasoning-section-spinner"
                aria-hidden="true"
            ></div>
        </div>
    ` as HTMLElement

    const lineageMarkers = dom.querySelector('.ai-reasoning-section-lineage-markers') as HTMLElement
    const contentDOM = dom.querySelector('.ai-reasoning-section-content') as HTMLElement
    const spinner = dom.querySelector('.ai-reasoning-section-spinner') as HTMLElement

    const syncState = current => {
        const isWaiting = current.childCount === 0 && current.attrs.isReceivingAnimation
        const branchOriginNodeId = current.attrs.branchOriginNodeId || ''
        const branchForkNodeId = current.attrs.branchForkNodeId || ''
        const branchLineNodeId = current.attrs.branchLineNodeId || ''
        const reasoningModelId = current.attrs.reasoningModelId || ''
        const lineageProjectionScope = normalizeAiLineageProjectionScope(current.attrs.lineageProjectionScope)
        const lineageEvents = getReasoningSectionLineageEvents(current.attrs, lineageProjectionScope)
        dom.classList.toggle('is-empty', isWaiting)
        dom.classList.toggle(
            'has-branch-origin',
            lineageEvents.some(event => event.kind === 'branch-origin'),
        )
        dom.classList.toggle(
            'has-branch-fork',
            lineageEvents.some(event => event.kind === 'branch-fork'),
        )
        dom.classList.toggle(
            'has-branch-line',
            lineageEvents.some(event => event.kind === 'branch-line'),
        )
        dom.dataset.branchOriginNodeId = branchOriginNodeId
        dom.dataset.branchForkNodeId = branchForkNodeId
        dom.dataset.branchLineNodeId = branchLineNodeId
        dom.dataset.lineageProjectionScope = lineageProjectionScope
        // Attribute the reasoning model on each marker so the "Branch continued" row
        // shows which reasoning model drove the branch (matrix streams carry lineage
        // on the section; single-run streams use standalone aiLineageEvent nodes).
        lineageMarkers.replaceChildren(
            ...lineageEvents.map(
                event => createAiLineageEventMarker({
                    ...event,
                    reasoningModelId,
                }),
            ),
        )
        lineageMarkers.hidden = lineageEvents.length === 0
        spinner.classList.toggle('is-active', isWaiting)
    }

    syncState(node)

    return {
        dom,
        contentDOM,
        update: updatedNode => {
            if (updatedNode.type.name !== aiReasoningSectionNodeType)
                return false

            node = updatedNode
            dom.dataset.generationRequestId = node.attrs.generationRequestId || ''
            dom.dataset.reasoningRunId = node.attrs.reasoningRunId || ''
            dom.dataset.reasoningModelId = node.attrs.reasoningModelId || ''
            dom.dataset.reasoningIndex = node.attrs.reasoningIndex == null ? '' : String(node.attrs.reasoningIndex)
            dom.dataset.branchOriginNodeId = node.attrs.branchOriginNodeId || ''
            dom.dataset.branchForkNodeId = node.attrs.branchForkNodeId || ''
            dom.dataset.branchLineNodeId = node.attrs.branchLineNodeId || ''
            dom.dataset.lineageProjectionScope = node.attrs.lineageProjectionScope || 'conversation'
            syncState(node)

            return true
        },
    }
}
