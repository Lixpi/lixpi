'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

type MockEditorInstance = {
	options: Record<string, any>
	destroy: ReturnType<typeof vi.fn>
}

type MockEditorState = {
	instances: MockEditorInstance[]
}

const editorMockStateKey = '__readOnlyAiChatThreadRendererMockState__'
;(globalThis as any)[editorMockStateKey] = { instances: [] } as MockEditorState

vi.mock('$src/components/proseMirror/components/editor.ts', () => ({
	ProseMirrorEditor: class {
		options: Record<string, any>
		destroy: ReturnType<typeof vi.fn>

		constructor(options: Record<string, any>) {
			this.options = options
			this.destroy = vi.fn()
			const state = (globalThis as any)[editorMockStateKey] as MockEditorState
			state.instances.push(this)
		}
	},
}))

import { mountReadOnlyAiChatThreadProjection } from '$src/components/proseMirror/readOnlyAiChatThreadRenderer.ts'

const getMockEditorState = (): MockEditorState =>
	(globalThis as any)[editorMockStateKey] as MockEditorState

const makeContent = () => ({ type: 'doc', content: [] }) as const

const makeMount = (): HTMLElement => {
	const mount = document.createElement('div')
	mount.className = 'read-only-test-mount'
	return mount
}

describe('mountReadOnlyAiChatThreadProjection', () => {
	beforeEach(() => {
		getMockEditorState().instances.length = 0
	})

	it('mounts a projected read-only chat thread editor with host classes and options', () => {
		const mount = makeMount()
		const content = makeContent()

		const projection = mountReadOnlyAiChatThreadProjection({
			mount,
			content,
			threadId: 'thread-1',
			className: 'custom-thread-projection',
			traceDetailsOptions: { className: 'trace-projection' },
		})

		const host = mount.querySelector('.read-only-ai-chat-thread-projection') as HTMLElement | null
		expect(host).not.toBeNull()
		expect(host!.classList.contains('ai-chat-thread-node-editor')).toBe(true)
		expect(host!.classList.contains('read-only-ai-chat-thread-projection')).toBe(true)
		expect(host!.classList.contains('custom-thread-projection')).toBe(true)

		const [editorOptions] = getMockEditorState().instances
		expect(editorOptions).toBeDefined()
		expect(editorOptions.options.editorMountElement).toBe(host)
		expect(editorOptions.options.content).toBeInstanceOf(HTMLDivElement)
		expect(editorOptions.options.initialVal).toBe(content)
		expect(editorOptions.options.isDisabled).toBe(false)
		expect(editorOptions.options.readOnly).toBe(true)
		expect(editorOptions.options.documentType).toBe('assetProvenance')
		expect(editorOptions.options.threadId).toBe('thread-1')
		expect(editorOptions.options.aiChatThreadRenderContext).toEqual({
			readOnly: true,
			traceDetailsOptions: { className: 'trace-projection' },
		})

		projection.destroy()
		expect(editorOptions.destroy).toHaveBeenCalledTimes(1)
		expect(mount.children).toHaveLength(0)
	})

	it('does not include a custom host class when none is provided', () => {
		const mount = makeMount()

		mountReadOnlyAiChatThreadProjection({
			mount,
			content: makeContent(),
			threadId: 'thread-2',
		})

		const host = mount.querySelector('.read-only-ai-chat-thread-projection') as HTMLElement | null
		expect(host).not.toBeNull()
		expect(host!.className).toBe('ai-chat-thread-node-editor read-only-ai-chat-thread-projection')
	})
})
