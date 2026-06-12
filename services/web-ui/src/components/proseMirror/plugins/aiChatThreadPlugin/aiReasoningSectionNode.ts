// @ts-nocheck
// A single reasoning model's slice of a multi-model response. One user prompt
// produces ONE aiResponseMessage; inside it, each selected reasoning model gets
// its own aiReasoningSection holding that model's reply text, its image/video
// generation collapsible, and its generated media — kept separate so the
// concurrently-streaming models never interleave their content.
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
    const dom = document.createElement('div')
    dom.className = 'ai-reasoning-section'
    dom.setAttribute('data-reasoning-run-id', node.attrs.reasoningRunId || '')

    const contentDOM = document.createElement('div')
    contentDOM.className = 'ai-reasoning-section-content'
    dom.appendChild(contentDOM)

    const spinner = document.createElement('div')
    spinner.className = 'ai-reasoning-section-spinner'
    spinner.setAttribute('aria-hidden', 'true')
    dom.appendChild(spinner)

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
            dom.setAttribute('data-reasoning-run-id', node.attrs.reasoningRunId || '')
            syncState(node)
            return true
        },
    }
}
