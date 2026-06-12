// @ts-nocheck
// A single reasoning model's slice of a multi-model response. One user prompt
// produces ONE aiResponseMessage; inside it, each selected reasoning model gets
// its own aiReasoningSection holding that model's reply text, its image/video
// generation collapsible, and its generated media — kept separate so the
// concurrently-streaming models never interleave their content.
import { html } from '$src/utils/domTemplates.ts'

export const aiReasoningSectionNodeType = 'aiReasoningSection'

export const aiReasoningSectionNodeSpec = {
    attrs: {
        generationRequestId: { default: '' },
        reasoningRunId: { default: '' },
        reasoningModelId: { default: '' },
        reasoningIndex: { default: null },
        isReceivingAnimation: { default: false },
    },
    content: '(paragraph | block)*',
    group: 'block',
    draggable: false,
    parseDOM: [
        {
            tag: 'div.ai-reasoning-section',
            getAttrs(dom) {
                return {
                    generationRequestId: dom.getAttribute('data-generation-request-id') || '',
                    reasoningRunId: dom.getAttribute('data-reasoning-run-id') || '',
                    reasoningModelId: dom.getAttribute('data-reasoning-model-id') || '',
                    reasoningIndex: parseReasoningIndex(dom.getAttribute('data-reasoning-index')),
                    isReceivingAnimation: false,
                }
            },
        },
    ],
    toDOM(node) {
        return [
            'div',
            {
                class: 'ai-reasoning-section',
                'data-generation-request-id': node.attrs.generationRequestId,
                'data-reasoning-run-id': node.attrs.reasoningRunId,
                'data-reasoning-model-id': node.attrs.reasoningModelId,
                'data-reasoning-index': node.attrs.reasoningIndex == null ? '' : String(node.attrs.reasoningIndex),
            },
            0,
        ]
    },
}

function parseReasoningIndex(value) {
    if (!value) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

export const aiReasoningSectionNodeView = (node) => {
    const dom = html`
        <div
            className="ai-reasoning-section"
            data=${{
                generationRequestId: node.attrs.generationRequestId || '',
                reasoningRunId: node.attrs.reasoningRunId || '',
                reasoningModelId: node.attrs.reasoningModelId || '',
                reasoningIndex: node.attrs.reasoningIndex == null ? '' : String(node.attrs.reasoningIndex),
            }}
        >
            <div className="ai-reasoning-section-content"></div>
            <div className="ai-reasoning-section-spinner" aria-hidden="true"></div>
        </div>
    ` as HTMLElement

    const contentDOM = dom.querySelector('.ai-reasoning-section-content') as HTMLElement
    const spinner = dom.querySelector('.ai-reasoning-section-spinner') as HTMLElement

    const syncState = (current) => {
        const isWaiting = current.childCount === 0 && current.attrs.isReceivingAnimation
        dom.classList.toggle('is-empty', isWaiting)
        spinner.classList.toggle('is-active', isWaiting)
    }

    syncState(node)

    return {
        dom,
        contentDOM,
        update: (updatedNode) => {
            if (updatedNode.type.name !== aiReasoningSectionNodeType) return false
            node = updatedNode
            dom.dataset.generationRequestId = node.attrs.generationRequestId || ''
            dom.dataset.reasoningRunId = node.attrs.reasoningRunId || ''
            dom.dataset.reasoningModelId = node.attrs.reasoningModelId || ''
            dom.dataset.reasoningIndex = node.attrs.reasoningIndex == null ? '' : String(node.attrs.reasoningIndex)
            syncState(node)
            return true
        },
    }
}
