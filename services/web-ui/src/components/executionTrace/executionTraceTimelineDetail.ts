import {
    type ProgressTimelineDetailRender,
} from '@lixpi/ui-kit/components/progress-timeline'

import {
    type PromptReferencePreviewRenderer,
} from '@lixpi/canvas-components-lixpi-specific/frontend/context'

import {
    createExecutionTraceDetail,
    getExecutionTraceKey,
    isRenderableExecutionTrace,
} from './executionTraceDetails.ts'

export type ExecutionTraceTimelineDetailOptions = {
    previewRenderer?: PromptReferencePreviewRenderer
    inlinePopover?: boolean
    preferredPlacement?: 'top' | 'bottom' | 'left' | 'right'
}

export type ExecutionTraceTimelineDetailAdapter = {
    renderItemDetail: (detail: unknown) => ProgressTimelineDetailRender | null
    getItemDetailKey: (detail: unknown) => string
}

// Adapts an ExecutionTrace carried on a progress item into the timeline's
// domain-free detail hooks, so every timeline host — canvas branch markers,
// media nodes, and replayed provenance alike — renders traces identically.
export function createExecutionTraceTimelineDetailAdapter(
    options: ExecutionTraceTimelineDetailOptions = {},
): ExecutionTraceTimelineDetailAdapter {
    return {
        renderItemDetail: (detail) => {
            if (!isRenderableExecutionTrace(detail)) return null
            const instance = createExecutionTraceDetail({ trace: detail, ...options })
            return { element: instance.element, destroy: () => instance.destroy() }
        },
        getItemDetailKey: (detail) => (
            isRenderableExecutionTrace(detail) ? getExecutionTraceKey(detail) : ''
        ),
    }
}
