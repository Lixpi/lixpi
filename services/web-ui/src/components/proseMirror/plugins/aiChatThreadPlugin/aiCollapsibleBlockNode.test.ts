'use strict'

import { describe, it, expect, vi } from 'vitest'
import {
    schema,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'
import {
    aiCollapsibleBlockNodeView,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiCollapsibleBlockNode.ts'

function createCollapsibleNodeView(attrs: Record<string, unknown> = {}) {
    const node = schema.nodes.aiCollapsibleBlock.create(
        { title: 'Image generation prompt', isOpen: false, isStreaming: false, ...attrs },
        schema.nodes.paragraph.create(null, schema.text('Prompt body')),
    )

    const transaction = {
        setNodeMarkup: vi.fn().mockReturnThis(),
    }

    const mockView = {
        state: {
            tr: transaction,
            doc: {
                nodeAt: vi.fn(() => node),
            },
        },
        dispatch: vi.fn(),
    }

    const getPos = vi.fn(() => 3)
    const nodeView = aiCollapsibleBlockNodeView(node, mockView, getPos)

    return { nodeView, mockView, transaction, getPos }
}

describe('aiCollapsibleBlockNodeView', () => {
    it('toggles open state and syncs it back to the node on summary click', () => {
        const { nodeView, mockView, transaction } = createCollapsibleNodeView()
        const summary = nodeView.dom.querySelector('summary') as HTMLElement

        summary.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
        summary.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

        expect((nodeView.dom as HTMLDetailsElement).open).toBe(true)
        expect(transaction.setNodeMarkup).toHaveBeenCalledWith(
            3,
            undefined,
            expect.objectContaining({ isOpen: true }),
        )
        expect(mockView.dispatch).toHaveBeenCalledWith(transaction)
    })

    it('stops summary mousedown from bubbling to ancestor DOM handlers', () => {
        const { nodeView } = createCollapsibleNodeView()
        const summary = nodeView.dom.querySelector('summary') as HTMLElement
        const parent = document.createElement('div')
        const ancestorMouseDownHandler = vi.fn()

        parent.addEventListener('mousedown', ancestorMouseDownHandler)
        parent.appendChild(nodeView.dom)

        summary.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

        expect(ancestorMouseDownHandler).not.toHaveBeenCalled()
    })

    it('ignores wrapper open attribute mutations from the manual toggle', () => {
        const { nodeView } = createCollapsibleNodeView()

        const mutation = {
            type: 'attributes',
            attributeName: 'open',
            target: nodeView.dom,
        } as unknown as MutationRecord

        expect(nodeView.ignoreMutation!(mutation)).toBe(true)
    })

    it('stopEvent captures summary interactions but not content interactions', () => {
        const { nodeView } = createCollapsibleNodeView()
        const summary = nodeView.dom.querySelector('summary') as HTMLElement
        const content = nodeView.contentDOM as HTMLElement

        const summaryEvent = { target: summary } as unknown as Event
        const contentEvent = { target: content } as unknown as Event

        expect(nodeView.stopEvent!(summaryEvent)).toBe(true)
        expect(nodeView.stopEvent!(contentEvent)).toBe(false)
    })

    it('update syncs the summary label, streaming class, and open state', () => {
        const { nodeView } = createCollapsibleNodeView()
        const updatedNode = schema.nodes.aiCollapsibleBlock.create(
            { title: 'Revised prompt', isOpen: true, isStreaming: true },
            schema.nodes.paragraph.create(null, schema.text('Updated prompt body')),
        )

        const result = nodeView.update!(updatedNode)
        const summary = nodeView.dom.querySelector('summary') as HTMLElement

        expect(result).toBe(true)
        expect(summary.textContent).toBe('Preparing image generation prompt')
        expect(nodeView.dom.classList.contains('is-streaming')).toBe(true)
        expect((nodeView.dom as HTMLDetailsElement).open).toBe(true)
    })

    it('update returns false for a different node type', () => {
        const { nodeView } = createCollapsibleNodeView()
        const wrongNode = schema.nodes.paragraph.create(null, schema.text('Nope'))

        expect(nodeView.update!(wrongNode)).toBe(false)
    })
})