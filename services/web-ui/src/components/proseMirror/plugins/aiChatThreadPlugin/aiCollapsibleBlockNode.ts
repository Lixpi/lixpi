import {
    createImageGenerationTraceDetails,
    type ImageGenerationTraceDetailsAttrs,
    type ImageGenerationTraceDetailsOptions,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/imageGenerationTraceDetails.ts'
import {
    aiCollapsibleBlockNodeSpec,
    aiCollapsibleBlockNodeType,
} from '@lixpi/prosemirror'

export { cacheImageGenerationTrace } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/imageGenerationTraceDetails.ts'

export {
    aiCollapsibleBlockNodeSpec,
    aiCollapsibleBlockNodeType,
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
