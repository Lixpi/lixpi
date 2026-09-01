// @ts-nocheck
// Explicit workflow event node used by live chat history and read-only
// projections. Matrix streams persist lineage ids on aiReasoningSection;
// single-run streams materialize API lineage assignments as standalone events.
import {
    createAiLineageEventMarker,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiLineageEvents.ts'
import {
    aiLineageEventNodeSpec,
    aiLineageEventNodeType,
    normalizeAiLineageEventKind,
} from '@lixpi/prosemirror'

export {
    aiLineageEventNodeSpec,
    aiLineageEventNodeType,
}

export const aiLineageEventNodeView = (node) => {
    const buildMarker = () =>
        createAiLineageEventMarker({
            kind: normalizeAiLineageEventKind(node.attrs.kind),
            branchOriginNodeId: node.attrs.branchOriginNodeId || '',
            branchForkNodeId: node.attrs.branchForkNodeId || '',
            branchLineNodeId: node.attrs.branchLineNodeId || '',
            reasoningModelId: node.attrs.reasoningModelId || '',
        })

    let dom = buildMarker()

    return {
        dom,
        update: (updatedNode) => {
            if (updatedNode.type.name !== aiLineageEventNodeType) return false
            node = updatedNode
            const nextDom = buildMarker()
            dom.replaceWith(nextDom)
            dom = nextDom
            return true
        },
    }
}
