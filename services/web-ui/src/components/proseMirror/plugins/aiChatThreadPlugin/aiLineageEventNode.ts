// @ts-nocheck
// Explicit workflow event node used by live chat history and read-only
// projections. Matrix streams persist lineage ids on aiReasoningSection;
// single-run streams materialize API lineage assignments as standalone events.
import {
    createAiLineageEventMarker,
    getAiLineageEventLabel,
    type AiLineageEventKind,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiLineageEvents.ts'

export const aiLineageEventNodeType = 'aiLineageEvent'

function normalizeLineageEventKind(value: unknown): AiLineageEventKind {
    if (value === 'branch-origin' || value === 'branch-line') return value
    return 'branch-fork'
}

export const aiLineageEventNodeSpec = {
    attrs: {
        kind: { default: 'branch-fork' },
        branchOriginNodeId: { default: '' },
        branchForkNodeId: { default: '' },
        branchLineNodeId: { default: '' },
        reasoningModelId: { default: '' },
    },
    group: 'block',
    atom: true,
    selectable: false,
    draggable: false,
    parseDOM: [
        {
            tag: 'div.ai-lineage-event',
            getAttrs(dom) {
                return {
                    kind: normalizeLineageEventKind(dom.getAttribute('data-lineage-event-kind')),
                    branchOriginNodeId: dom.getAttribute('data-branch-origin-node-id') || '',
                    branchForkNodeId: dom.getAttribute('data-branch-fork-node-id') || '',
                    branchLineNodeId: dom.getAttribute('data-branch-line-node-id') || '',
                    reasoningModelId: dom.getAttribute('data-reasoning-model-id') || '',
                }
            },
        },
    ],
    toDOM(node) {
        const kind = normalizeLineageEventKind(node.attrs.kind)
        return [
            'div',
            {
                class: `ai-lineage-event ai-lineage-event-${kind}`,
                title: getAiLineageEventLabel(kind),
                'aria-label': getAiLineageEventLabel(kind),
                'data-lineage-event-kind': kind,
                'data-branch-origin-node-id': node.attrs.branchOriginNodeId,
                'data-branch-fork-node-id': node.attrs.branchForkNodeId,
                'data-branch-line-node-id': node.attrs.branchLineNodeId,
                'data-reasoning-model-id': node.attrs.reasoningModelId,
            },
        ]
    },
}

export const aiLineageEventNodeView = (node) => {
    const buildMarker = () => createAiLineageEventMarker({
        kind: normalizeLineageEventKind(node.attrs.kind),
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
