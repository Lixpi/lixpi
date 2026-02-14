'use strict'

import { describe, it, expect } from 'vitest'
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
import { aiResponseMessageNodeSpec } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiResponseMessageNode.ts'

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
