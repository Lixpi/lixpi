'use strict'

import { describe, it, expect, vi } from 'vitest'
import {
    doc,
    p,
    thread,
    response,
    schema,
    createEditorState,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'
import {
    aiChatThreadNodeSpec,
    aiChatThreadNodeView,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadNode.ts'

// =============================================================================
// Helper: instantiate aiChatThreadNodeView with minimal mocks
// =============================================================================

function createThreadNodeView(attrs: Record<string, unknown> = {}) {
    const node = schema.nodes.aiChatThread.create(
        { threadId: 'thread-test-1', status: 'active', ...attrs }
    )

    const mockView = {
        state: {
            doc: doc(thread(p('hello'))),
            tr: { setNodeMarkup: vi.fn().mockReturnThis(), setSelection: vi.fn().mockReturnThis() },
        },
        dispatch: vi.fn(),
        focus: vi.fn(),
    }
    const getPos = vi.fn(() => 0)

    const nodeView = aiChatThreadNodeView(node, mockView, getPos)
    return { nodeView, node, mockView, getPos }
}

// =============================================================================
// aiChatThreadNodeView — ignoreMutation
// =============================================================================

describe('aiChatThreadNodeView — ignoreMutation', () => {
    it('returns true for style attribute mutations', () => {
        const { nodeView } = createThreadNodeView()

        const mutation = {
            type: 'attributes',
            attributeName: 'style',
            target: nodeView.dom,
        } as unknown as MutationRecord

        expect(nodeView.ignoreMutation!(mutation)).toBe(true)
    })

    it('returns false for non-style attribute mutations', () => {
        const { nodeView } = createThreadNodeView()

        const cases = ['class', 'data-thread-id', 'data-status', 'id']
        for (const attributeName of cases) {
            const mutation = {
                type: 'attributes',
                attributeName,
                target: nodeView.dom,
            } as unknown as MutationRecord

            expect(nodeView.ignoreMutation!(mutation)).toBe(false)
        }
    })

    it('returns false for childList mutations (ProseMirror manages content)', () => {
        const { nodeView } = createThreadNodeView()

        const mutation = {
            type: 'childList',
            attributeName: null,
            target: nodeView.contentDOM!,
        } as unknown as MutationRecord

        expect(nodeView.ignoreMutation!(mutation)).toBe(false)
    })

    it('returns false for characterData mutations', () => {
        const { nodeView } = createThreadNodeView()

        const mutation = {
            type: 'characterData',
            attributeName: null,
            target: nodeView.contentDOM!,
        } as unknown as MutationRecord

        expect(nodeView.ignoreMutation!(mutation)).toBe(false)
    })
})

// =============================================================================
// aiChatThreadNodeView — height preserved across update()
// =============================================================================

describe('aiChatThreadNodeView — height survives update()', () => {
    it('preserves externally-set height when update() is called', () => {
        const { nodeView } = createThreadNodeView()
        const dom = nodeView.dom as HTMLElement

        // Simulate applyAnchoredImageSpacing growing the thread height
        dom.style.height = '800px'
        expect(dom.style.height).toBe('800px')

        // Simulate ProseMirror calling update() with updated attributes
        const updatedNode = schema.nodes.aiChatThread.create(
            { threadId: 'thread-test-1', status: 'completed' }
        )

        const result = nodeView.update!(updatedNode, [])
        expect(result).toBe(true)

        // Height must survive the update
        expect(dom.style.height).toBe('800px')
    })

    it('preserves height across multiple sequential updates', () => {
        const { nodeView } = createThreadNodeView()
        const dom = nodeView.dom as HTMLElement

        dom.style.height = '1200px'

        // Simulate multiple updates during streaming
        const statuses = ['active', 'active', 'completed'] as const
        for (const status of statuses) {
            const updatedNode = schema.nodes.aiChatThread.create(
                { threadId: 'thread-test-1', status }
            )
            nodeView.update!(updatedNode, [])
        }

        expect(dom.style.height).toBe('1200px')
    })
})

// =============================================================================
// aiChatThreadNodeView — DOM structure
// =============================================================================

describe('aiChatThreadNodeView — DOM structure', () => {
    it('creates wrapper with ai-chat-thread-wrapper class', () => {
        const { nodeView } = createThreadNodeView()
        const dom = nodeView.dom as HTMLElement

        expect(dom.className).toBe('ai-chat-thread-wrapper')
    })

    it('sets data-thread-id attribute on wrapper', () => {
        const { nodeView } = createThreadNodeView({ threadId: 'thread-xyz' })
        const dom = nodeView.dom as HTMLElement

        expect(dom.getAttribute('data-thread-id')).toBe('thread-xyz')
    })

    it('sets data-status attribute on wrapper', () => {
        const { nodeView } = createThreadNodeView({ status: 'paused' })
        const dom = nodeView.dom as HTMLElement

        expect(dom.getAttribute('data-status')).toBe('paused')
    })

    it('has contentDOM as ai-chat-thread-content element', () => {
        const { nodeView } = createThreadNodeView()
        const contentDOM = nodeView.contentDOM as HTMLElement

        expect(contentDOM.className).toBe('ai-chat-thread-content')
    })

    it('contentDOM is a child of dom', () => {
        const { nodeView } = createThreadNodeView()

        expect(nodeView.dom.contains(nodeView.contentDOM!)).toBe(true)
    })
})

// =============================================================================
// aiChatThreadNodeView — update()
// =============================================================================

describe('aiChatThreadNodeView — update()', () => {
    it('updates data-thread-id when attribute changes', () => {
        const { nodeView } = createThreadNodeView({ threadId: 'old-thread' })
        const dom = nodeView.dom as HTMLElement

        const updatedNode = schema.nodes.aiChatThread.create(
            { threadId: 'new-thread', status: 'active' }
        )
        nodeView.update!(updatedNode, [])

        expect(dom.getAttribute('data-thread-id')).toBe('new-thread')
    })

    it('updates data-status when attribute changes', () => {
        const { nodeView } = createThreadNodeView({ status: 'active' })
        const dom = nodeView.dom as HTMLElement

        const updatedNode = schema.nodes.aiChatThread.create(
            { threadId: 'thread-test-1', status: 'completed' }
        )
        nodeView.update!(updatedNode, [])

        expect(dom.getAttribute('data-status')).toBe('completed')
    })

    it('returns false for a different node type', () => {
        const { nodeView } = createThreadNodeView()

        const wrongNode = schema.nodes.paragraph.create(null, schema.text('wrong'))
        const result = nodeView.update!(wrongNode, [])

        expect(result).toBe(false)
    })

    it('returns true for same node type', () => {
        const { nodeView } = createThreadNodeView()

        const updatedNode = schema.nodes.aiChatThread.create(
            { threadId: 'thread-test-1', status: 'active' }
        )
        const result = nodeView.update!(updatedNode, [])

        expect(result).toBe(true)
    })
})

// =============================================================================
// aiChatThreadNodeSpec — schema validation
// =============================================================================

describe('aiChatThreadNodeSpec — schema', () => {
    it('parseDOM targets div.ai-chat-thread-wrapper', () => {
        const parseRule = aiChatThreadNodeSpec.parseDOM[0]
        expect(parseRule.tag).toBe('div.ai-chat-thread-wrapper')
    })

    it('extracts threadId and status from DOM attributes', () => {
        const parseRule = aiChatThreadNodeSpec.parseDOM[0]

        const mockDom = {
            getAttribute: (attr: string) => {
                const attrs: Record<string, string> = {
                    'data-thread-id': 'thread-parsed-1',
                    'data-status': 'paused',
                    'data-ai-model': 'claude-3-5-sonnet',
                    'data-image-generation-enabled': 'true',
                    'data-image-generation-size': '1536x1024',
                    'data-previous-response-id': 'resp-prev',
                }
                return attrs[attr] ?? null
            },
        }

        const parsed = parseRule.getAttrs(mockDom)
        expect(parsed.threadId).toBe('thread-parsed-1')
        expect(parsed.status).toBe('paused')
        expect(parsed.aiModel).toBe('claude-3-5-sonnet')
        expect(parsed.imageGenerationEnabled).toBe(true)
        expect(parsed.imageGenerationSize).toBe('1536x1024')
        expect(parsed.previousResponseId).toBe('resp-prev')
    })

    it('toDOM produces correct element structure', () => {
        const node = schema.nodes.aiChatThread.create({
            threadId: 'thread-dom-1',
            status: 'active',
        })

        const domOutput = node.type.spec.toDOM(node)
        expect(domOutput[0]).toBe('div')
        expect(domOutput[1].class).toBe('ai-chat-thread-wrapper')
        expect(domOutput[1]['data-thread-id']).toBe('thread-dom-1')
        expect(domOutput[1]['data-status']).toBe('active')
        expect(domOutput[2]).toBe(0)
    })
})
