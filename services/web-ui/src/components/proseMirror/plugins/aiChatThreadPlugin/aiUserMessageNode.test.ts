import {
    describe,
    it,
    expect,
    vi,
} from 'vitest'
import { applyStyle } from '@lixpi/ui-primitives/dom'
import { schema } from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'
import {
    aiUserMessageNodeSpec,
    aiUserMessageNodeView,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiUserMessageNode.ts'

// =============================================================================
// Helper: instantiate aiUserMessageNodeView with minimal mocks
// =============================================================================

function createUserMessageNodeView(attrs: Record<string, unknown> = {}, options: any = undefined) {
    const node = schema.nodes.aiUserMessage.create(
        { id: 'user-msg-test-1', createdAt: 1700000000000, ...attrs },
    )

    const mockView = {} as any
    const getPos = vi.fn(() => 0)

    const nodeView = aiUserMessageNodeView(node, mockView, getPos, options)
    return { nodeView, node, mockView, getPos }
}

function createImageCanvasNode(nodeId: string): any {
    return {
        type: 'image',
        nodeId,
        referenceId: nodeId,
        src: `/api/images/${nodeId}.png`,
        posterSrc: `/api/images/${nodeId}-poster.png`,
        dimensions: { width: 420, height: 560 },
        aspectRatio: 0.75,
    }
}

function createMockContextPreview(nodes: Record<string, any>): any {
    return {
        getNodeById: (id: string) => nodes[id],
        environment: {
            getDocuments: () => [],
            getThreads: () => [],
            document,
            tooltipHideDelayMs: 0,
            getArtifactIcon: () => '',
            extractDocumentText: () => '',
            initialRenditionUrl: () => '',
            resolveRenditionUrl: async () => '',
            onError: vi.fn(),
        },
    }
}

// =============================================================================
// aiUserMessageNodeView — ignoreMutation
// =============================================================================

describe('aiUserMessageNodeView — ignoreMutation', () => {
    it('returns true for style attribute mutations', () => {
        const { nodeView } = createUserMessageNodeView()

        const mutation = {
            type: 'attributes',
            attributeName: 'style',
            target: nodeView.dom,
        } as unknown as MutationRecord

        expect(nodeView.ignoreMutation!(mutation)).toBe(true)
    })

    it('returns false for non-style attribute mutations', () => {
        const { nodeView } = createUserMessageNodeView()

        const cases = ['class', 'data-id', 'data-created-at', 'id']
        for (const attributeName of cases) {
            const mutation = {
                type: 'attributes',
                attributeName,
                target: nodeView.dom,
            } as unknown as MutationRecord

            expect(nodeView.ignoreMutation!(mutation)).toBe(false)
        }
    })

    it('returns false for childList mutations', () => {
        const { nodeView } = createUserMessageNodeView()

        const mutation = {
            type: 'childList',
            attributeName: null,
            target: nodeView.contentDOM!,
        } as unknown as MutationRecord

        expect(nodeView.ignoreMutation!(mutation)).toBe(false)
    })

    it('returns false for characterData mutations', () => {
        const { nodeView } = createUserMessageNodeView()

        const mutation = {
            type: 'characterData',
            attributeName: null,
            target: nodeView.contentDOM!,
        } as unknown as MutationRecord

        expect(nodeView.ignoreMutation!(mutation)).toBe(false)
    })

    it('discriminates between style and other attributes on same target', () => {
        const { nodeView } = createUserMessageNodeView()

        const styleMutation = {
            type: 'attributes',
            attributeName: 'style',
            target: nodeView.dom,
        } as unknown as MutationRecord

        const classMutation = {
            type: 'attributes',
            attributeName: 'class',
            target: nodeView.dom,
        } as unknown as MutationRecord

        expect(nodeView.ignoreMutation!(styleMutation)).toBe(true)
        expect(nodeView.ignoreMutation!(classMutation)).toBe(false)
    })
})

// =============================================================================
// aiUserMessageNodeView — marginBottom survives update()
// =============================================================================

describe('aiUserMessageNodeView — marginBottom survives update()', () => {
    it('preserves externally-set marginBottom after a single update()', () => {
        const { nodeView } = createUserMessageNodeView()
        const dom = nodeView.dom as HTMLElement

        applyStyle(dom, { marginBottom: '150px' })
        expect(dom.style.marginBottom).toBe('150px')

        const updatedNode = schema.nodes.aiUserMessage.create(
            { id: 'user-msg-test-1', createdAt: 1700000000001 },
        )

        const result = nodeView.update!(updatedNode, [])
        expect(result).toBe(true)
        expect(dom.style.marginBottom).toBe('150px')
    })

    it('preserves marginBottom across multiple sequential updates', () => {
        const { nodeView } = createUserMessageNodeView()
        const dom = nodeView.dom as HTMLElement

        applyStyle(dom, { marginBottom: '220px' })

        for (let i = 0; i < 8; i++) {
            const updatedNode = schema.nodes.aiUserMessage.create(
                { id: 'user-msg-test-1', createdAt: 1700000000000 + i },
            )
            nodeView.update!(updatedNode, [])
        }

        expect(dom.style.marginBottom).toBe('220px')
    })
})

// =============================================================================
// aiUserMessageNodeView — DOM structure
// =============================================================================

describe('aiUserMessageNodeView — DOM structure', () => {
    it('creates wrapper with ai-user-message-wrapper class', () => {
        const { nodeView } = createUserMessageNodeView()
        const dom = nodeView.dom as HTMLElement

        expect(dom.className).toBe('ai-user-message-wrapper')
    })

    it('has contentDOM with ai-user-message-content class', () => {
        const { nodeView } = createUserMessageNodeView()
        const contentDOM = nodeView.contentDOM as HTMLElement

        expect(contentDOM.className).toBe('ai-user-message-content')
    })

    it('contentDOM is a descendant of dom', () => {
        const { nodeView } = createUserMessageNodeView()

        expect(nodeView.dom.contains(nodeView.contentDOM!)).toBe(true)
    })

    it('wrapper contains ai-user-message intermediary element', () => {
        const { nodeView } = createUserMessageNodeView()
        const dom = nodeView.dom as HTMLElement
        const aiUserMsg = dom.querySelector('.ai-user-message')

        expect(aiUserMsg).not.toBeNull()
        expect(aiUserMsg!.contains(nodeView.contentDOM!)).toBe(true)
    })
})

// =============================================================================
// aiUserMessageNodeView — reference previews placement
// =============================================================================

describe('aiUserMessageNodeView — reference previews placement', () => {
    it('renders reference preview tiles outside the message bubble', () => {
        const contextPreview = createMockContextPreview({
            'img-1': createImageCanvasNode('img-1'),
        })

        const { nodeView } = createUserMessageNodeView(
            { referenceNodeIds: ['img-1'] },
            { contextPreview },
        )

        const dom = nodeView.dom as HTMLElement
        const previewsEl = dom.querySelector('.ai-user-message-reference-previews') as HTMLElement
        const bubbleEl = dom.querySelector('.ai-user-message') as HTMLElement

        expect(previewsEl.hidden).toBe(false)
        expect(previewsEl.childElementCount).toBe(1)
        // Tiles live outside the bubble, directly under the wrapper.
        expect(bubbleEl.contains(previewsEl)).toBe(false)
        expect(previewsEl.parentElement).toBe(dom)
    })

    it('positions the previews above the message bubble in the wrapper', () => {
        const contextPreview = createMockContextPreview({
            'img-1': createImageCanvasNode('img-1'),
        })

        const { nodeView } = createUserMessageNodeView(
            { referenceNodeIds: ['img-1'] },
            { contextPreview },
        )

        const dom = nodeView.dom as HTMLElement
        const previewsEl = dom.querySelector('.ai-user-message-reference-previews') as HTMLElement
        const bubbleEl = dom.querySelector('.ai-user-message') as HTMLElement
        const children = Array.from(dom.children)

        expect(children.indexOf(previewsEl)).toBeLessThan(children.indexOf(bubbleEl))
    })

    it('keeps the previews container hidden when there are no reference nodes', () => {
        const contextPreview = createMockContextPreview({})

        const { nodeView } = createUserMessageNodeView({}, { contextPreview })

        const dom = nodeView.dom as HTMLElement
        const previewsEl = dom.querySelector('.ai-user-message-reference-previews') as HTMLElement

        expect(previewsEl.hidden).toBe(true)
        expect(previewsEl.childElementCount).toBe(0)
    })

    it('ignoreMutation returns true for mutations inside the previews container', () => {
        const contextPreview = createMockContextPreview({
            'img-1': createImageCanvasNode('img-1'),
        })

        const { nodeView } = createUserMessageNodeView(
            { referenceNodeIds: ['img-1'] },
            { contextPreview },
        )

        const dom = nodeView.dom as HTMLElement
        const previewsEl = dom.querySelector('.ai-user-message-reference-previews') as HTMLElement

        const mutation = {
            type: 'childList',
            attributeName: null,
            target: previewsEl.firstChild ?? previewsEl,
        } as unknown as MutationRecord

        expect(nodeView.ignoreMutation!(mutation)).toBe(true)
    })
})

// =============================================================================
// aiUserMessageNodeView — update()
// =============================================================================

describe('aiUserMessageNodeView — update()', () => {
    it('returns true for same node type', () => {
        const { nodeView } = createUserMessageNodeView()

        const updatedNode = schema.nodes.aiUserMessage.create(
            { id: 'user-msg-test-2', createdAt: 1700000000002 },
        )
        const result = nodeView.update!(updatedNode, [])

        expect(result).toBe(true)
    })

    it('returns false for a different node type', () => {
        const { nodeView } = createUserMessageNodeView()

        const wrongNode = schema.nodes.paragraph.create(null, schema.text('wrong'))
        const result = nodeView.update!(wrongNode, [])

        expect(result).toBe(false)
    })
})

// =============================================================================
// aiUserMessageNodeSpec — schema validation
// =============================================================================

describe('aiUserMessageNodeSpec — schema', () => {
    it('parseDOM targets div.ai-user-message', () => {
        const parseRule = aiUserMessageNodeSpec.parseDOM[0]
        expect(parseRule.tag).toBe('div.ai-user-message')
    })

    it('extracts id and createdAt from DOM attributes', () => {
        const parseRule = aiUserMessageNodeSpec.parseDOM[0]

        const mockDom = {
            getAttribute: (attr: string) => {
                const attrs: Record<string, string> = {
                    'data-id': 'parsed-user-msg-1',
                    'data-created-at': '1700000000999',
                }
                return attrs[attr] ?? null
            },
        }

        const parsed = parseRule.getAttrs(mockDom)
        expect(parsed.id).toBe('parsed-user-msg-1')
        expect(parsed.createdAt).toBe(1700000000999)
    })

    it('toDOM produces correct element structure', () => {
        const node = schema.nodes.aiUserMessage.create({
            id: 'dom-user-msg-1',
            createdAt: 1700000000500,
        })

        const domOutput = node.type.spec.toDOM(node)
        expect(domOutput[0]).toBe('div')
        expect(domOutput[1].class).toBe('ai-user-message')
        expect(domOutput[1]['data-id']).toBe('dom-user-msg-1')
        expect(domOutput[1]['data-created-at']).toBe('1700000000500')
        expect(domOutput[2]).toBe(0)
    })
})
