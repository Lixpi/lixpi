import {
    createImageGenerationTraceDetails,
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
            tag: 'div.ai-generation-trace-block',
            getAttrs(dom: HTMLElement) {
                return parseTraceBlockAttrs(
                    dom,
                    dom.getAttribute('data-title') || 'Image generation prompt',
                )
            },
        },
    ],
    toDOM(node: any) {
        return [
            'div',
            {
                class: `ai-generation-trace-block${node.attrs.isStreaming ? ' is-streaming' : ''}`,
                'data-title': node.attrs.title,
                'data-generation-request-id': node.attrs.generationRequestId,
                'data-reasoning-run-id': node.attrs.reasoningRunId,
                'data-media-run-id': node.attrs.mediaRunId,
                'data-reasoning-model-id': node.attrs.reasoningModelId,
                'data-media-model-id': node.attrs.mediaModelId,
                'data-media-type': node.attrs.mediaType,
                'data-variant-index': node.attrs.variantIndex == null ? '' : String(node.attrs.variantIndex),
            },
            ['div', { class: 'ai-generation-trace-body' }, ['div', { class: 'ai-generation-trace-content' }, 0]],
        ]
    },
}

function parseVariantIndex(value: string | null): number | null {
    if (!value) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function parseTraceBlockAttrs(dom: HTMLElement, title: string) {
    return {
        title,
        isOpen: false,
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
}

export type AiCollapsibleBlockNodeViewOptions = {
    traceDetailsOptions?: ImageGenerationTraceDetailsOptions
}

export const aiCollapsibleBlockNodeView = (
    node: any,
    _view: any,
    _getPos: () => number | undefined,
    options: AiCollapsibleBlockNodeViewOptions = {},
) => {
    const traceDetails = createImageGenerationTraceDetails(options.traceDetailsOptions)
    const wrapper = traceDetails.dom
    const contentDom = traceDetails.contentDom

    const renderTrace = (currentNode: any) => {
        traceDetails.render({
            attrs: currentNode.attrs as ImageGenerationTraceDetailsAttrs,
            childCount: currentNode.childCount,
        })
    }

    renderTrace(node)

    return {
        dom: wrapper,
        contentDOM: contentDom,
        ignoreMutation(mutation: MutationRecord) {
            const target = mutation.target as Node
            return target !== contentDom && !contentDom.contains(target)
        },
        update(updatedNode: any) {
            if (updatedNode.type.name !== aiCollapsibleBlockNodeType) return false

            node = updatedNode
            renderTrace(updatedNode)

            if (updatedNode.attrs.isStreaming) {
                wrapper.classList.add('is-streaming')
            } else {
                wrapper.classList.remove('is-streaming')
            }

            return true
        },
    }
}
