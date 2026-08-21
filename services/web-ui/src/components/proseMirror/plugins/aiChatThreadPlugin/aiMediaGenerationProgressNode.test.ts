import { describe, expect, it, vi } from 'vitest'

import { createProseMirrorSchema, DOCUMENT_TYPE } from '@lixpi/prosemirror'

import { aiMediaGenerationProgressNodeView } from './aiMediaGenerationProgressNode.ts'

describe('aiMediaGenerationProgressNodeView', () => {
    it('renders and destroys the shared pipeline component from structured node state', () => {
        const schema = createProseMirrorSchema(DOCUMENT_TYPE.ASSET_PROVENANCE)
        const state = {
            generationRequestId: 'request-1',
            status: 'completed' as const,
            message: 'Done.',
            progress: {
                phase: 'composing' as const,
                completedSteps: 1,
                totalSteps: 1,
                message: 'Done.',
            },
            updatedAt: 1,
        }
        const node = schema.nodes.aiMediaGenerationProgress.create({
            id: 'request-1:media-1',
            state,
            showSummaryWhenCollapsedItemIds: ['lineage:understand-request'],
        })
        const element = document.createElement('section')
        const destroy = vi.fn()
        const render = vi.fn(() => ({ element, destroy }))

        const nodeView = aiMediaGenerationProgressNodeView(node, render)

        expect(render).toHaveBeenCalledWith({
            id: 'request-1:media-1',
            state,
            showSummaryWhenCollapsedItemIds: ['lineage:understand-request'],
        })
        expect(nodeView.dom).toBe(element)
        expect(element.classList.contains('ai-media-generation-progress')).toBe(true)
        nodeView.destroy()
        expect(destroy).toHaveBeenCalledTimes(1)
    })
})
