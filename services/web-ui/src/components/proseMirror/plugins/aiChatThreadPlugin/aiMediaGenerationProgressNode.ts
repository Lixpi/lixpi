import type { MediaGenerationProgressState } from '@lixpi/constants'
import {
    aiMediaGenerationProgressNodeSpec,
    aiMediaGenerationProgressNodeType,
} from '@lixpi/prosemirror'
import type { Node as ProseMirrorNode } from 'prosemirror-model'

import { html } from '$src/utils/domTemplates.ts'

export {
    aiMediaGenerationProgressNodeSpec,
    aiMediaGenerationProgressNodeType,
}

export type AiMediaGenerationProgressRenderResult = {
    element: HTMLElement
    destroy: () => void
}

export type AiMediaGenerationProgressRenderer = (options: {
    id: string
    state: MediaGenerationProgressState
    showSummaryWhenCollapsedItemIds: readonly string[]
}) => AiMediaGenerationProgressRenderResult

export function aiMediaGenerationProgressNodeView(
    node: ProseMirrorNode,
    render?: AiMediaGenerationProgressRenderer,
) {
    const state = node.attrs.state as MediaGenerationProgressState | null
    const id = String(node.attrs.id ?? '')
    const showSummaryWhenCollapsedItemIds = Array.isArray(node.attrs.showSummaryWhenCollapsedItemIds)
        ? node.attrs.showSummaryWhenCollapsedItemIds.filter((value: unknown): value is string => typeof value === 'string')
        : []
    const rendered = state && render
        ? render({ id, state, showSummaryWhenCollapsedItemIds })
        : null
    const dom = rendered?.element ?? html`
        <div
            className="ai-media-generation-progress"
            data=${{ mediaGenerationProgressId: id }}
        ></div>
    ` as HTMLElement
    dom.classList.add('ai-media-generation-progress')
    dom.dataset.mediaGenerationProgressId = id

    return {
        dom,
        destroy: () => rendered?.destroy(),
    }
}
