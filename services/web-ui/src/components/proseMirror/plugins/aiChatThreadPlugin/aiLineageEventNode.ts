// @ts-nocheck
// Explicit workflow event node used by read-only projections and future
// canvas-native chat assembly. Live stream sections still persist lineage ids
// on aiReasoningSection; projections can materialize those ids as standalone
// event blocks without inheriting unrelated ancestor events.
import {
    createAiLineageEventMarker,
    getAiLineageEventLabel,
    type AiLineageEventKind,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiLineageEvents.ts'

export const aiLineageEventNodeType = 'aiLineageEvent'

function normalizeLineageEventKind(value: unknown): AiLineageEventKind {
    return value === 'branch-origin' ? 'branch-origin' : 'branch-fork'
}

export const aiLineageEventNodeSpec = {
    attrs: {
        kind: { default: 'branch-fork' },
        branchOriginNodeId: { default: '' },
        branchForkNodeId: { default: '' },
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
            },
        ]
    },
}

export const aiLineageEventNodeView = (node) => {
    let dom = createAiLineageEventMarker({
        kind: normalizeLineageEventKind(node.attrs.kind),
        branchOriginNodeId: node.attrs.branchOriginNodeId || '',
        branchForkNodeId: node.attrs.branchForkNodeId || '',
    })

    return {
        dom,
        update: (updatedNode) => {
            if (updatedNode.type.name !== aiLineageEventNodeType) return false
            node = updatedNode
            const nextDom = createAiLineageEventMarker({
                kind: normalizeLineageEventKind(node.attrs.kind),
                branchOriginNodeId: node.attrs.branchOriginNodeId || '',
                branchForkNodeId: node.attrs.branchForkNodeId || '',
            })
            dom.replaceWith(nextDom)
            dom = nextDom
            return true
        },
    }
}
