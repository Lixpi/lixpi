'use strict'

import { describe, it, expect, vi } from 'vitest'
import { NodeSelection } from 'prosemirror-state'
import { DOMSerializer } from 'prosemirror-model'
import {
	doc,
	p,
	response,
	thread,
	schema,
	createEditorState,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'
import {
	aiResponseMessageNodeSpec,
	aiResponseMessageNodeView,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiResponseMessageNode.ts'

// =============================================================================
// aiResponseMessage — id attribute
// =============================================================================

describe('aiResponseMessage — id attribute', () => {
	it('stores the id attribute from node creation', () => {
		const responseNode = response({ id: 'msg-abc-123' }, p('Hello from AI'))
		const state = createEditorState(doc(thread(responseNode)))

		let found = false
		state.doc.descendants((node) => {
			if (node.type.name === 'aiResponseMessage') {
				expect(node.attrs.id).toBe('msg-abc-123')
				found = true
			}
		})
		expect(found).toBe(true)
	})

	it('defaults to empty string when id is not provided', () => {
		const responseNode = response(p('Hello from AI'))
		const state = createEditorState(doc(thread(responseNode)))

		let found = false
		state.doc.descendants((node) => {
			if (node.type.name === 'aiResponseMessage') {
				expect(node.attrs.id).toBe('')
				found = true
			}
		})
		expect(found).toBe(true)
	})

	it('serializes id into the DOM output', () => {
		const responseNode = response({ id: 'msg-unique-42' }, p('Test content'))
		const state = createEditorState(doc(thread(responseNode)))

		let targetNode = null as any
		state.doc.descendants((node) => {
			if (node.type.name === 'aiResponseMessage') {
				targetNode = node
			}
		})

		expect(targetNode).not.toBeNull()

		// Use ProseMirror's toDOM spec to check the serialized attrs
		const domOutput = targetNode.type.spec.toDOM(targetNode)

		// toDOM returns ['div', { id: ..., ... }, 0]
		expect(domOutput[0]).toBe('div')
		expect(domOutput[1].id).toBe('msg-unique-42')
	})
})

// =============================================================================
// aiResponseMessage — toDOM spec validation
// =============================================================================

describe('aiResponseMessage — toDOM spec', () => {
	it('produces a div with ai-response-message class', () => {
		const responseNode = response({ id: 'msg-1', aiProvider: 'OpenAI' }, p('content'))
		const state = createEditorState(doc(thread(responseNode)))

		let targetNode = null as any
		state.doc.descendants((node) => {
			if (node.type.name === 'aiResponseMessage') {
				targetNode = node
			}
		})

		const domOutput = targetNode.type.spec.toDOM(targetNode)
		expect(domOutput[1].class).toBe('ai-response-message')
	})

	it('includes data-ai-provider attribute in serialized DOM', () => {
		const responseNode = response({ id: 'msg-1', aiProvider: 'Anthropic' }, p('content'))
		const state = createEditorState(doc(thread(responseNode)))

		let targetNode = null as any
		state.doc.descendants((node) => {
			if (node.type.name === 'aiResponseMessage') {
				targetNode = node
			}
		})

		const domOutput = targetNode.type.spec.toDOM(targetNode)
		expect(domOutput[1]['data-ai-provider']).toBe('Anthropic')
	})

	it('content placeholder is 0 for ProseMirror to render children', () => {
		const responseNode = response({ id: 'msg-1' }, p('content'))
		const state = createEditorState(doc(thread(responseNode)))

		let targetNode = null as any
		state.doc.descendants((node) => {
			if (node.type.name === 'aiResponseMessage') {
				targetNode = node
			}
		})

		const domOutput = targetNode.type.spec.toDOM(targetNode)
		expect(domOutput[2]).toBe(0)
	})
})

// =============================================================================
// aiResponseMessage — parseDOM spec validation
// =============================================================================

describe('aiResponseMessage — parseDOM spec', () => {
	it('parses from div.ai-response-message', () => {
		const parseRule = aiResponseMessageNodeSpec.parseDOM[0]
		expect(parseRule.tag).toBe('div.ai-response-message')
	})

	it('extracts id, style, and aiProvider from DOM attributes', () => {
		const parseRule = aiResponseMessageNodeSpec.parseDOM[0]

		const mockDom = {
			getAttribute: (attr: string) => {
				const attrs: Record<string, string> = {
					id: 'msg-parsed-123',
					style: 'color: red',
					'data-ai-provider': 'OpenAI',
				}
				return attrs[attr] ?? null
			},
		}

		const parsed = parseRule.getAttrs(mockDom)
		expect(parsed).toEqual({
			id: 'msg-parsed-123',
			style: 'color: red',
			aiProvider: 'OpenAI',
		})
	})
})

// =============================================================================
// aiResponseMessageNodeView — ignoreMutation
// =============================================================================

function createResponseNodeView(attrs: Record<string, unknown> = {}) {
	const node = schema.nodes.aiResponseMessage.create(
		{ id: 'test-msg-1', aiProvider: 'Anthropic', ...attrs },
		schema.nodes.paragraph.create(null, schema.text('Hello'))
	)

	const mockView = {
		state: { tr: { setNodeMarkup: vi.fn().mockReturnValue({ setNodeMarkup: vi.fn() }) } },
		dispatch: vi.fn(),
	}
	const getPos = vi.fn(() => 0)

	const nodeView = aiResponseMessageNodeView(node, mockView, getPos)
	return { nodeView, node, mockView, getPos }
}

describe('aiResponseMessageNodeView — ignoreMutation', () => {
	it('returns true for style attribute mutations on the wrapper', () => {
		const { nodeView } = createResponseNodeView()

		const mutation = {
			type: 'attributes',
			attributeName: 'style',
			target: nodeView.dom,
		} as unknown as MutationRecord

		expect(nodeView.ignoreMutation!(mutation)).toBe(true)
	})

	it('returns false for non-style attribute mutations', () => {
		const { nodeView } = createResponseNodeView()

		const mutation = {
			type: 'attributes',
			attributeName: 'class',
			target: nodeView.dom,
		} as unknown as MutationRecord

		expect(nodeView.ignoreMutation!(mutation)).toBe(false)
	})

	it('returns false for childList mutations', () => {
		const { nodeView } = createResponseNodeView()

		const mutation = {
			type: 'childList',
			attributeName: null,
			target: nodeView.dom,
		} as unknown as MutationRecord

		expect(nodeView.ignoreMutation!(mutation)).toBe(false)
	})

	it('returns false for characterData mutations', () => {
		const { nodeView } = createResponseNodeView()

		const mutation = {
			type: 'characterData',
			attributeName: null,
			target: nodeView.contentDOM!,
		} as unknown as MutationRecord

		expect(nodeView.ignoreMutation!(mutation)).toBe(false)
	})

	it('returns true for style mutations even on data-message-id attribute', () => {
		const { nodeView } = createResponseNodeView()

		// data-message-id mutation should NOT be ignored
		const dataMutation = {
			type: 'attributes',
			attributeName: 'data-message-id',
			target: nodeView.dom,
		} as unknown as MutationRecord
		expect(nodeView.ignoreMutation!(dataMutation)).toBe(false)

		// but style mutation SHOULD be ignored
		const styleMutation = {
			type: 'attributes',
			attributeName: 'style',
			target: nodeView.dom,
		} as unknown as MutationRecord
		expect(nodeView.ignoreMutation!(styleMutation)).toBe(true)
	})
})

// =============================================================================
// aiResponseMessageNodeView — marginBottom preserved across update()
// =============================================================================

describe('aiResponseMessageNodeView — marginBottom survives update()', () => {
	it('preserves externally-set marginBottom when update() is called', () => {
		const { nodeView } = createResponseNodeView()
		const dom = nodeView.dom as HTMLElement

		// Simulate applyAnchoredImageSpacing setting marginBottom
		dom.style.marginBottom = '120px'
		expect(dom.style.marginBottom).toBe('120px')

		// Simulate ProseMirror calling update() with a new node (e.g. new animation frame)
		const updatedNode = schema.nodes.aiResponseMessage.create(
			{ id: 'test-msg-1', aiProvider: 'Anthropic', currentFrame: 3 },
			schema.nodes.paragraph.create(null, schema.text('Hello'))
		)

		const result = nodeView.update!(updatedNode, [], null as any)

		expect(result).toBe(true)
		// marginBottom must survive the update — this is the entire point of ignoreMutation
		expect(dom.style.marginBottom).toBe('120px')
	})

	it('preserves marginBottom across multiple sequential updates', () => {
		const { nodeView } = createResponseNodeView()
		const dom = nodeView.dom as HTMLElement

		dom.style.marginBottom = '200px'

		// Simulate rapid animation frame updates (every 90ms during streaming)
		for (let frame = 0; frame < 8; frame++) {
			const updatedNode = schema.nodes.aiResponseMessage.create(
				{ id: 'test-msg-1', aiProvider: 'Anthropic', currentFrame: frame, isReceivingAnimation: false },
				schema.nodes.paragraph.create(null, schema.text('Hello'))
			)
			nodeView.update!(updatedNode, [], null as any)
		}

		expect(dom.style.marginBottom).toBe('200px')
	})
})

// =============================================================================
// aiResponseMessageNodeView — DOM structure
// =============================================================================

describe('aiResponseMessageNodeView — DOM structure', () => {
	it('creates wrapper with ai-response-message-wrapper class', () => {
		const { nodeView } = createResponseNodeView()
		const dom = nodeView.dom as HTMLElement

		expect(dom.className).toBe('ai-response-message-wrapper')
	})

	it('sets data-message-id attribute on wrapper', () => {
		const { nodeView } = createResponseNodeView({ id: 'msg-42' })
		const dom = nodeView.dom as HTMLElement

		expect(dom.getAttribute('data-message-id')).toBe('msg-42')
	})

	it('has contentDOM as ai-response-message-content element', () => {
		const { nodeView } = createResponseNodeView()
		const contentDOM = nodeView.contentDOM as HTMLElement

		expect(contentDOM.className).toBe('ai-response-message-content')
	})

	it('update() refreshes data-message-id when node id changes', () => {
		const { nodeView } = createResponseNodeView({ id: 'msg-old' })
		const dom = nodeView.dom as HTMLElement

		expect(dom.getAttribute('data-message-id')).toBe('msg-old')

		const updatedNode = schema.nodes.aiResponseMessage.create(
			{ id: 'msg-new', aiProvider: 'Anthropic' },
			schema.nodes.paragraph.create(null, schema.text('Updated'))
		)
		nodeView.update!(updatedNode, [], null as any)

		expect(dom.getAttribute('data-message-id')).toBe('msg-new')
	})

	it('update() returns false for a different node type', () => {
		const { nodeView } = createResponseNodeView()

		const wrongNode = schema.nodes.paragraph.create(null, schema.text('wrong'))
		const result = nodeView.update!(wrongNode, [], null as any)

		expect(result).toBe(false)
	})
})
