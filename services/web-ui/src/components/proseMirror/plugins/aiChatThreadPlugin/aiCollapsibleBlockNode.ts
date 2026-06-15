import {
    createImageGenerationTraceDetails,
    getImageGenerationSummaryTitle,
    type ImageGenerationTraceDetailsAttrs,
    type ImageGenerationTraceDetailsOptions,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/imageGenerationTraceDetails.ts'

export { cacheImageGenerationTrace } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/imageGenerationTraceDetails.ts'

export const aiCollapsibleBlockNodeType = 'aiCollapsibleBlock'

export const aiCollapsibleBlockNodeSpec = {
    attrs: {
        title: { default: 'Image generation prompt' },
        isOpen: { default: false },
        isStreaming: { default: true },
        imageGenerationTrace: { default: null },
        imageGenerationTraceId: { default: null },
        videoGenerationTrace: { default: null },
        generationRequestId: { default: '' },
        reasoningRunId: { default: '' },
        mediaRunId: { default: '' },
        reasoningModelId: { default: '' },
        mediaModelId: { default: '' },
        mediaType: { default: '' },
        variantIndex: { default: null },
    },
    content: '(paragraph | block)*',
    group: 'block',
    draggable: false,
    parseDOM: [
        {
            tag: 'details.ai-collapsible-block',
            getAttrs(dom: HTMLDetailsElement) {
                const summary = dom.querySelector('summary')
                return {
                    title: summary?.textContent || 'Image generation prompt',
                    isOpen: dom.open,
                    isStreaming: false,
                    imageGenerationTrace: null,
                    imageGenerationTraceId: null,
                    videoGenerationTrace: null,
                    generationRequestId: dom.getAttribute('data-generation-request-id') || '',
                    reasoningRunId: dom.getAttribute('data-reasoning-run-id') || '',
                    mediaRunId: dom.getAttribute('data-media-run-id') || '',
                    reasoningModelId: dom.getAttribute('data-reasoning-model-id') || '',
                    mediaModelId: dom.getAttribute('data-media-model-id') || '',
                    mediaType: dom.getAttribute('data-media-type') || '',
                    variantIndex: parseVariantIndex(dom.getAttribute('data-variant-index')),
                }
            },
        },
    ],
    toDOM(node: any) {
        return [
            'details',
            {
                class: `ai-collapsible-block${node.attrs.isStreaming ? ' is-streaming' : ''}`,
                ...(node.attrs.isOpen ? { open: 'true' } : {}),
                'data-generation-request-id': node.attrs.generationRequestId,
                'data-reasoning-run-id': node.attrs.reasoningRunId,
                'data-media-run-id': node.attrs.mediaRunId,
                'data-reasoning-model-id': node.attrs.reasoningModelId,
                'data-media-model-id': node.attrs.mediaModelId,
                'data-media-type': node.attrs.mediaType,
                'data-variant-index': node.attrs.variantIndex == null ? '' : String(node.attrs.variantIndex),
            },
            ['summary', {}, getSummaryTitle(node.attrs)],
            ['div', { class: 'ai-collapsible-block-body' }, ['div', { class: 'ai-collapsible-block-content' }, 0]],
        ]
    },
}

function parseVariantIndex(value: string | null): number | null {
    if (!value) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

const getSummaryTitle = (attrs: ImageGenerationTraceDetailsAttrs): string => {
    return getImageGenerationSummaryTitle(attrs)
}

export type AiCollapsibleBlockNodeViewOptions = {
    traceDetailsOptions?: ImageGenerationTraceDetailsOptions
}

export const aiCollapsibleBlockNodeView = (
    node: any,
    view: any,
    getPos: () => number | undefined,
    options: AiCollapsibleBlockNodeViewOptions = {},
) => {
    const traceDetails = createImageGenerationTraceDetails(options.traceDetailsOptions)
    const wrapper = traceDetails.dom
    const summary = traceDetails.summary
    const contentDom = traceDetails.contentDom

    const handleSummaryMouseDown = (event: MouseEvent) => {
        // Prevent the parent thread's mousedown focus handler from stealing the interaction.
        event.preventDefault()
        event.stopPropagation()
    }

    const handleSummaryClick = (event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()

        const pos = getPos()
        if (pos === undefined) return

        const newOpen = !wrapper.open
        wrapper.open = newOpen
        if (newOpen) renderTrace(node)

        if (!view.editable) return

        const tr = view.state.tr.setNodeMarkup(pos, undefined, {
            ...view.state.doc.nodeAt(pos)?.attrs,
            isOpen: newOpen,
        })
        view.dispatch(tr)
    }

    const renderTrace = (currentNode: any) => {
        traceDetails.render({
            attrs: currentNode.attrs as ImageGenerationTraceDetailsAttrs,
            childCount: currentNode.childCount,
        })
    }

    if (node.attrs.isOpen) {
        wrapper.open = true
    }

    renderTrace(node)

    summary.addEventListener('mousedown', handleSummaryMouseDown)
    summary.addEventListener('click', handleSummaryClick)

    return {
        dom: wrapper,
        contentDOM: contentDom,
        stopEvent(event: Event) {
            return event.target === summary || summary.contains(event.target as Node)
        },
        ignoreMutation(mutation: MutationRecord) {
            if (mutation.type === 'attributes'
                && mutation.attributeName === 'open'
                && mutation.target === wrapper) return true

            const target = mutation.target as Node
            return target !== contentDom && !contentDom.contains(target)
        },
        update(updatedNode: any) {
            if (updatedNode.type.name !== aiCollapsibleBlockNodeType) return false

            node = updatedNode
            wrapper.open = !!updatedNode.attrs.isOpen
            renderTrace(updatedNode)

            if (updatedNode.attrs.isStreaming) {
                wrapper.classList.add('is-streaming')
            } else {
                wrapper.classList.remove('is-streaming')
            }

            return true
        },
        destroy() {
            summary.removeEventListener('mousedown', handleSummaryMouseDown)
            summary.removeEventListener('click', handleSummaryClick)
        },
    }
}
