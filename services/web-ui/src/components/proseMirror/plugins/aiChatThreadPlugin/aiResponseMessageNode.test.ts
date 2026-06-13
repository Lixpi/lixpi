'use strict'

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { NodeSelection } from 'prosemirror-state'
import { DOMSerializer } from 'prosemirror-model'
import { applyStyle } from '$src/utils/domTemplates.ts'
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

function loadScss(): string {
	return readFileSync(
		resolve(__dirname, 'ai-chat-thread.scss'),
		'utf-8'
	)
}

function loadSource(filename: string): string {
	return readFileSync(
		resolve(__dirname, filename),
		'utf-8'
	)
}

function loadAnimationsScss(): string {
	return readFileSync(
		resolve(__dirname, '../../../../sass/components/_animations.scss'),
		'utf-8'
	)
}

function expectSourceToContain(source: string, snippet: string, label = 'source excerpt'): void {
	expect(
		source.includes(snippet),
		`${label} should contain:\n${snippet}`
	).toBe(true)
}

function expectSourceNotToContain(source: string, snippet: string, label = 'source excerpt'): void {
	expect(
		source.includes(snippet),
		`${label} should not contain:\n${snippet}`
	).toBe(false)
}

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
			generationRequestId: '',
			reasoningRunId: '',
			mediaRunId: '',
			reasoningModelId: '',
			mediaModelId: '',
			mediaType: '',
			variantIndex: null,
		})
	})
})

// =============================================================================
// aiResponseMessageNodeView — ignoreMutation
// =============================================================================

function createResponseNodeView(attrs: Record<string, unknown> = {}, content: any = schema.nodes.paragraph.create(null, schema.text('Hello'))) {
	const node = schema.nodes.aiResponseMessage.create(
		{ id: 'test-msg-1', aiProvider: 'Anthropic', ...attrs },
		content
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

		// Simulate a canvas layout pass setting marginBottom.
		applyStyle(dom, { marginBottom: '120px' })
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

		applyStyle(dom, { marginBottom: '200px' })

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

	it('renders the response node without a provider avatar', () => {
		// Avatars (and their animation) were removed from response nodes; a single
		// response can hold several reasoning models, so a per-node avatar no longer
		// makes sense. Attribution lives in each generation collapsible header.
		const { nodeView } = createResponseNodeView({ aiProvider: 'Google' })
		const dom = nodeView.dom as HTMLElement
		const messageRow = dom.querySelector('.ai-response-message')
		const bubble = dom.querySelector('.ai-response-message-bubble')

		expect(messageRow).not.toBeNull()
		expect(bubble).not.toBeNull()
		expect(messageRow!.contains(bubble)).toBe(true)
		expect(dom.querySelector('.user-avatar')).toBeNull()
	})

	it('shows the ring loading indicator while an empty response is receiving', () => {
		const { nodeView } = createResponseNodeView({ isReceivingAnimation: true }, null)
		const dom = nodeView.dom as HTMLElement
		const bubble = dom.querySelector('.ai-response-message-bubble') as HTMLElement
		const loadingIndicator = dom.querySelector('.ai-response-loading-spinner') as HTMLElement

		expect(loadingIndicator).not.toBeNull()
		expect(bubble.classList.contains('is-waiting')).toBe(true)
		expect(loadingIndicator.classList.contains('is-active')).toBe(true)
		expect(dom.querySelector(`.${['ai-response', 'message', 'spinner'].join('-')}`)).toBeNull()
	})

	it('clears the loading indicator after content arrives', () => {
		const { nodeView } = createResponseNodeView({ isReceivingAnimation: true }, null)
		const dom = nodeView.dom as HTMLElement
		const bubble = dom.querySelector('.ai-response-message-bubble') as HTMLElement
		const loadingIndicator = dom.querySelector('.ai-response-loading-spinner') as HTMLElement
		const updatedNode = schema.nodes.aiResponseMessage.create(
			{ id: 'test-msg-1', aiProvider: 'Anthropic', isReceivingAnimation: false },
			schema.nodes.paragraph.create(null, schema.text('Ready'))
		)

		nodeView.update!(updatedNode, [], null as any)

		expect(bubble.classList.contains('is-waiting')).toBe(false)
		expect(loadingIndicator.classList.contains('is-active')).toBe(false)
	})

	it('keeps the provider avatar compact so the bubble can use full width', () => {
		const scss = loadScss()
		const avatarBlock = scss.match(/\.user-avatar \{[\s\S]*?\n    \}/)
		expect(avatarBlock).not.toBeNull()
		const messageBlock = scss.match(/\.ai-response-message \{[\s\S]*?\.ai-response-message-bubble \{[\s\S]*?\n        \}/)
		expect(messageBlock).not.toBeNull()

		expect(avatarBlock![0]).toContain('width: 20px')
		expect(avatarBlock![0]).toContain('height: 20px')
		expect(messageBlock![0]).toContain('display: block')
		expect(messageBlock![0]).toContain('width: 100%')
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

// =============================================================================
// aiResponseMessageNodeView — loading indicator source guard
// =============================================================================

describe('aiResponseMessageNodeView — loading indicator source guard', () => {
	it('uses the ring loading contract and removes the legacy dot loader contract', () => {
		const oldSpinnerClass = ['ai-response', 'message', 'spinner'].join('-')
		const oldSpinnerMixin = ['horizontal', 'Spinner', 'Animation'].join('')
		const shellSource = loadSource('aiChatMessageShells.ts')
		const responseNodeSource = loadSource('aiResponseMessageNode.ts')
		const threadScss = loadScss()
		const animationScss = loadAnimationsScss()

		expectSourceToContain(shellSource, 'ai-response-loading-spinner', 'response shell source')
		expectSourceToContain(threadScss, '.ai-response-loading-spinner', 'thread SCSS')
		expectSourceToContain(threadScss, 'animation: spin 0.8s linear infinite;', 'thread SCSS')
		expectSourceNotToContain(shellSource, oldSpinnerClass, 'response shell source')
		expectSourceNotToContain(responseNodeSource, oldSpinnerClass, 'response node source')
		expectSourceNotToContain(threadScss, oldSpinnerClass, 'thread SCSS')
		expectSourceNotToContain(threadScss, oldSpinnerMixin, 'thread SCSS')
		expectSourceNotToContain(animationScss, oldSpinnerMixin, 'shared animations SCSS')
	})
})
