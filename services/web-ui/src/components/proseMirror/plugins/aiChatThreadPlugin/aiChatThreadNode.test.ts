'use strict'

import { describe, it, expect, vi } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { applyStyle } from '$src/utils/domTemplates.ts'
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
import { createAiChatThreadPlugin } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPlugin.ts'
import { AI_CHAT_THREAD_PLUGIN_KEY } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPluginConstants.ts'
import { statePlugin } from '$src/components/proseMirror/plugins/statePlugin.js'
import SegmentsReceiver from '$src/services/segmentsReceiver-service.ts'
import type { ImageGenerationTrace } from '@lixpi/constants'

function createImageGenerationTrace(overrides: Partial<ImageGenerationTrace> = {}): ImageGenerationTrace {
    return {
        traceVersion: 'image-generation-trace-v1',
        chatModelProvider: 'Anthropic',
        chatModelId: 'claude-sonnet-4-6',
        imageModelProvider: 'Google',
        imageModelId: 'gemini-2.5-flash-image',
        imageSize: '1:1',
        toolPrompt: 'Paint the same man in orange monochrome.',
        finalPrompt: 'Paint the same man in orange monochrome.',
        promptWasChanged: false,
        referenceImages: [
            {
                id: 'branch:person-generated',
                source: 'branch-candidate',
                imageUrl: 'nats-obj://workspace-workspace-1-files/person-file',
                label: 'painted portrait of the man',
                role: 'target',
                nodeId: 'person-generated',
                fileId: 'person-file',
                workspaceId: 'workspace-1',
                branchId: 'branch-person',
                reason: 'selected generated portrait branch',
            },
        ],
        excludedReferences: [
            {
                nodeId: 'goat-generated',
                label: 'painted goat',
                role: 'excluded',
                reason: 'different subject branch',
                branchId: 'branch-goat',
            },
        ],
        resolver: {
            resolverKind: 'structured-vlm',
            resolverVersion: 'image-branch-vlm-v1',
            resolverModelProvider: 'Anthropic',
            resolverModelId: 'claude-sonnet-4-6',
            mode: 'edit-active-branch',
            operationKind: 'style_transfer',
            confidence: 0.95,
            rationale: 'Continue the generated portrait branch.',
            targetImageNodeId: 'person-generated',
            parentImageNodeId: 'person-generated',
            branchId: 'branch-person',
        },
        ...overrides,
    }
}

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

        // Simulate a canvas layout pass growing the thread height.
    applyStyle(dom, { height: '800px' })
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

        applyStyle(dom, { height: '1200px' })

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

// =============================================================================
// aiChatThreadPlugin — onReceivingStateChange callback
// =============================================================================

describe('aiChatThreadPlugin — onReceivingStateChange callback', () => {
    function createPluginWithCallback(onReceivingStateChange: (threadId: string, receiving: boolean) => void) {
        return createAiChatThreadPlugin({
            sendAiRequestHandler: vi.fn(),
            stopAiRequestHandler: vi.fn(),
            placeholders: { titlePlaceholder: 'Title', paragraphPlaceholder: 'Type here…' },
            onReceivingStateChange,
        })
    }

    function createStateWithPlugin(plugin: ReturnType<typeof createPluginWithCallback>) {
        return EditorState.create({
            doc: doc(thread({ threadId: 'thread-1' }, p('hello'))),
            schema,
            plugins: [plugin],
        })
    }

    it('calls onReceivingStateChange when setReceiving meta is dispatched with receiving=true', () => {
        const callback = vi.fn()
        const plugin = createPluginWithCallback(callback)
        const state = createStateWithPlugin(plugin)

        const tr = state.tr.setMeta('setReceiving', { threadId: 'thread-1', receiving: true })
        state.apply(tr)

        expect(callback).toHaveBeenCalledTimes(1)
        expect(callback).toHaveBeenCalledWith('thread-1', true)
    })

    it('calls onReceivingStateChange when setReceiving meta is dispatched with receiving=false', () => {
        const callback = vi.fn()
        const plugin = createPluginWithCallback(callback)
        const state = createStateWithPlugin(plugin)

        // First set receiving=true
        const tr1 = state.tr.setMeta('setReceiving', { threadId: 'thread-1', receiving: true })
        const state2 = state.apply(tr1)

        // Then set receiving=false
        const tr2 = state2.tr.setMeta('setReceiving', { threadId: 'thread-1', receiving: false })
        state2.apply(tr2)

        expect(callback).toHaveBeenCalledTimes(2)
        expect(callback).toHaveBeenCalledWith('thread-1', false)
    })

    it('does not call onReceivingStateChange for transactions without setReceiving meta', () => {
        const callback = vi.fn()
        const plugin = createPluginWithCallback(callback)
        const state = createStateWithPlugin(plugin)

        // Dispatch a regular transaction (insertText)
        const tr = state.tr.insertText('x', 2)
        state.apply(tr)

        expect(callback).not.toHaveBeenCalled()
    })

    it('does not throw when onReceivingStateChange is not provided', () => {
        const plugin = createAiChatThreadPlugin({
            sendAiRequestHandler: vi.fn(),
            stopAiRequestHandler: vi.fn(),
            placeholders: { titlePlaceholder: 'Title', paragraphPlaceholder: 'Type here…' },
        })
        const state = EditorState.create({
            doc: doc(thread({ threadId: 'thread-1' }, p('hello'))),
            schema,
            plugins: [plugin],
        })

        const tr = state.tr.setMeta('setReceiving', { threadId: 'thread-1', receiving: true })
        expect(() => state.apply(tr)).not.toThrow()
    })

    it('updates plugin state receivingThreadIds when setReceiving meta is dispatched', () => {
        const callback = vi.fn()
        const plugin = createPluginWithCallback(callback)
        const state = createStateWithPlugin(plugin)

        const tr = state.tr.setMeta('setReceiving', { threadId: 'thread-1', receiving: true })
        const newState = state.apply(tr)

        const pluginState = AI_CHAT_THREAD_PLUGIN_KEY.getState(newState)
        expect(pluginState.receivingThreadIds.has('thread-1')).toBe(true)
    })
})

// =============================================================================
// aiChatThreadPlugin — image generation trace
// =============================================================================

describe('aiChatThreadPlugin — image generation trace', () => {
    function createView(children: any[] = [p('Generating image')]) {
        const plugin = createAiChatThreadPlugin({
            sendAiRequestHandler: vi.fn(),
            stopAiRequestHandler: vi.fn(),
            placeholders: { titlePlaceholder: 'Title', paragraphPlaceholder: 'Type here…' },
        })
        const mount = document.createElement('div')
        document.body.appendChild(mount)
        const view = new EditorView(mount, {
            state: EditorState.create({
                doc: doc(
                    thread(
                        { threadId: 'thread-1' },
                        response(
                            { id: 'resp-1', isReceivingAnimation: true, aiProvider: 'Anthropic' },
                            ...children
                        )
                    )
                ),
                schema,
                plugins: [plugin],
            }),
        })

        return { view, mount }
    }

    function getCollapsibleNodes(view: EditorView): any[] {
        const collapsibleNodes: any[] = []
        view.state.doc.descendants((node: any) => {
            if (node.type.name === 'aiCollapsibleBlock') collapsibleNodes.push(node)
        })
        return collapsibleNodes
    }

    it('inserts a persisted image-generation trace block into the active response', () => {
        const { view, mount } = createView()
        const trace = createImageGenerationTrace()

        SegmentsReceiver.receiveSegment({
            type: 'image_generation_trace',
            aiChatThreadId: 'thread-1',
            imageGenerationTrace: trace,
        })

        const collapsibleNodes = getCollapsibleNodes(view)
        expect(collapsibleNodes).toHaveLength(1)
        expect(collapsibleNodes[0].attrs).toMatchObject({
            title: 'Image generation details',
            isOpen: false,
            isStreaming: false,
            imageGenerationTrace: trace,
            imageGenerationTraceId: null,
        })

        view.destroy()
        mount.remove()
    })

    it('updates an existing prompt details block instead of inserting a duplicate', () => {
        const existingBlock = schema.nodes.aiCollapsibleBlock.create(
            { title: 'Image generation prompt', isOpen: true, isStreaming: true },
            schema.nodes.paragraph.create(null, schema.text('Original tool prompt'))
        )
        const { view, mount } = createView([p('Generating image'), existingBlock])
        const trace = createImageGenerationTrace({
            finalPrompt: 'Final trace prompt',
            promptWasChanged: true,
        })

        SegmentsReceiver.receiveSegment({
            type: 'image_generation_trace',
            aiChatThreadId: 'thread-1',
            imageGenerationTrace: trace,
        })

        const collapsibleNodes = getCollapsibleNodes(view)
        expect(collapsibleNodes).toHaveLength(1)
        expect(collapsibleNodes[0].attrs).toMatchObject({
            title: 'Image generation details',
            isOpen: false,
            isStreaming: false,
            imageGenerationTrace: trace,
        })
        expect(collapsibleNodes[0].textContent).toBe('Original tool prompt')

        view.destroy()
        mount.remove()
    })
})

// =============================================================================
// aiChatThreadPlugin — generated image completion
// =============================================================================

describe('aiChatThreadPlugin — generated image completion', () => {
    function createView(
        onImageCompleteToCanvas = vi.fn(),
        onImagePartialToCanvas = vi.fn(),
        additionalPlugins: any[] = []
    ) {
        const plugin = createAiChatThreadPlugin({
            sendAiRequestHandler: vi.fn(),
            stopAiRequestHandler: vi.fn(),
            placeholders: { titlePlaceholder: 'Title', paragraphPlaceholder: 'Type here…' },
            imageCallbacks: { onImageCompleteToCanvas, onImagePartialToCanvas },
        })

        const mount = document.createElement('div')
        document.body.appendChild(mount)

        const view = new EditorView(mount, {
            state: EditorState.create({
                doc: doc(
                    thread(
                        { threadId: 'thread-1' },
                        response(
                            { id: 'resp-1', isReceivingAnimation: true, isInitialRenderAnimation: true, aiProvider: 'OpenAI' },
                            p('Generating image')
                        )
                    )
                ),
                schema,
                plugins: [...additionalPlugins, plugin],
            }),
        })

        return { view, mount, onImageCompleteToCanvas, onImagePartialToCanvas }
    }

    function getGeneratedImageNodes(view: EditorView): any[] {
        const imageNodes: any[] = []
        view.state.doc.descendants((node: any) => {
            if (node.type.name === 'aiGeneratedImage') {
                imageNodes.push(node)
            }
        })
        return imageNodes
    }

    it('inserts a placeholder image reference into the active AI response on partial events', () => {
        const onImagePartialToCanvas = vi.fn()
        const { view, mount } = createView(vi.fn(), onImagePartialToCanvas)

        SegmentsReceiver.receiveSegment({
            type: 'image_partial',
            aiChatThreadId: 'thread-1',
            imageUrl: '',
            fileId: '',
            workspaceId: 'workspace-1',
            partialIndex: 0,
            aiProvider: 'OpenAI',
        })

        const imageNodes = getGeneratedImageNodes(view)

        expect(imageNodes).toHaveLength(1)
        expect(imageNodes[0].attrs).toMatchObject({
            imageData: '',
            fileId: '',
            workspaceId: 'workspace-1',
            aiModel: 'OpenAI',
            isPartial: true,
            partialIndex: 0,
            width: '112px',
            alignment: 'right',
            textWrap: 'none',
        })
        expect(onImagePartialToCanvas).toHaveBeenCalledWith(expect.objectContaining({
            threadId: 'thread-1',
            imageUrl: '',
            partialIndex: 0,
        }))

        view.destroy()
        mount.remove()
    })

    it('updates one chat placeholder across progressive image indices', () => {
        const { view, mount } = createView()

        SegmentsReceiver.receiveSegment({
            type: 'image_partial',
            aiChatThreadId: 'thread-1',
            imageUrl: '',
            fileId: '',
            workspaceId: 'workspace-1',
            partialIndex: 0,
            aiProvider: 'OpenAI',
        })
        SegmentsReceiver.receiveSegment({
            type: 'image_partial',
            aiChatThreadId: 'thread-1',
            imageUrl: '/api/images/workspace-1/file-partial',
            fileId: 'file-partial',
            workspaceId: 'workspace-1',
            partialIndex: 2,
            aiProvider: 'OpenAI',
        })

        const imageNodes = getGeneratedImageNodes(view)

        expect(imageNodes).toHaveLength(1)
        expect(imageNodes[0].attrs).toMatchObject({
            imageData: '/api/images/workspace-1/file-partial',
            fileId: 'file-partial',
            isPartial: true,
            partialIndex: 2,
            alignment: 'right',
        })

        view.destroy()
        mount.remove()
    })

    it('persists image trace details after progressive previews complete', () => {
        const onPersist = vi.fn()
        const { view, mount } = createView(vi.fn(), vi.fn(), [
            statePlugin({}, onPersist, vi.fn()),
        ])
        const trace = createImageGenerationTrace()

        SegmentsReceiver.receiveSegment({
            type: 'image_generation_trace',
            aiChatThreadId: 'thread-1',
            imageGenerationTrace: trace,
        })

        for (const partialIndex of [0, 1, 2]) {
            SegmentsReceiver.receiveSegment({
                type: 'image_partial',
                aiChatThreadId: 'thread-1',
                imageUrl: `/api/images/workspace-1/file-partial-${partialIndex}`,
                fileId: `file-partial-${partialIndex}`,
                workspaceId: 'workspace-1',
                partialIndex,
                aiProvider: 'OpenAI',
            })
        }

        SegmentsReceiver.receiveSegment({
            type: 'image_complete',
            aiChatThreadId: 'thread-1',
            imageUrl: '/api/images/workspace-1/file-final',
            fileId: 'file-final',
            workspaceId: 'workspace-1',
            responseId: 'response-1',
            revisedPrompt: 'A revised prompt',
            aiProvider: 'OpenAI',
            imageModelProvider: 'OpenAI',
        })
        SegmentsReceiver.receiveSegment({
            status: 'END_STREAM',
            threadId: 'thread-1',
        })

        const imageNodes = getGeneratedImageNodes(view)
        const persistedContent = onPersist.mock.calls[onPersist.mock.calls.length - 1]?.[0]

        expect(imageNodes).toHaveLength(1)
        expect(imageNodes[0].attrs).toMatchObject({
            fileId: 'file-final',
            isPartial: false,
            partialIndex: 2,
        })
        expect(onPersist).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(persistedContent)).toContain(trace.toolPrompt)

        view.destroy()
        mount.remove()
    })

    it('inserts a thumbnail image reference into the active AI response', () => {
        const { view, mount } = createView()

        SegmentsReceiver.receiveSegment({
            type: 'image_complete',
            aiChatThreadId: 'thread-1',
            imageUrl: '/api/images/workspace-1/file-1',
            fileId: 'file-1',
            workspaceId: 'workspace-1',
            responseId: 'response-1',
            revisedPrompt: 'A revised prompt',
            aiProvider: 'OpenAI',
            imageModelProvider: 'OpenAI',
        })

        const imageNodes = getGeneratedImageNodes(view)

        expect(imageNodes).toHaveLength(1)
        expect(imageNodes[0].attrs).toMatchObject({
            imageData: '/api/images/workspace-1/file-1',
            fileId: 'file-1',
            workspaceId: 'workspace-1',
            responseId: 'response-1',
            revisedPrompt: 'A revised prompt',
            isPartial: false,
            width: '112px',
            alignment: 'right',
            textWrap: 'none',
        })

        view.destroy()
        mount.remove()
    })

    it('converts the existing partial placeholder into the final thumbnail on completion', () => {
        const { view, mount } = createView()

        SegmentsReceiver.receiveSegment({
            type: 'image_partial',
            aiChatThreadId: 'thread-1',
            imageUrl: '',
            fileId: '',
            workspaceId: 'workspace-1',
            partialIndex: 0,
            aiProvider: 'OpenAI',
        })
        SegmentsReceiver.receiveSegment({
            type: 'image_complete',
            aiChatThreadId: 'thread-1',
            imageUrl: '/api/images/workspace-1/file-1',
            fileId: 'file-1',
            workspaceId: 'workspace-1',
            responseId: 'response-1',
            revisedPrompt: 'A revised prompt',
            aiProvider: 'OpenAI',
            imageModelProvider: 'OpenAI',
        })

        const imageNodes = getGeneratedImageNodes(view)

        expect(imageNodes).toHaveLength(1)
        expect(imageNodes[0].attrs).toMatchObject({
            imageData: '/api/images/workspace-1/file-1',
            fileId: 'file-1',
            workspaceId: 'workspace-1',
            responseId: 'response-1',
            revisedPrompt: 'A revised prompt',
            isPartial: false,
            partialIndex: 0,
            alignment: 'right',
        })
        expect(view.state.doc.textContent).toContain('A revised prompt')

        view.destroy()
        mount.remove()
    })

    it('passes the same response id to the canvas image callback', () => {
        const onImageCompleteToCanvas = vi.fn()
        const { view, mount } = createView(onImageCompleteToCanvas)

        SegmentsReceiver.receiveSegment({
            type: 'image_complete',
            aiChatThreadId: 'thread-1',
            imageUrl: '/api/images/workspace-1/file-1',
            fileId: 'file-1',
            workspaceId: 'workspace-1',
            responseId: 'response-1',
            revisedPrompt: 'A revised prompt',
            aiProvider: 'OpenAI',
            imageModelProvider: 'OpenAI',
        })

        expect(onImageCompleteToCanvas).toHaveBeenCalledWith(expect.objectContaining({
            imageUrl: '/api/images/workspace-1/file-1',
            fileId: 'file-1',
            workspaceId: 'workspace-1',
            responseMessageId: 'resp-1',
        }))

        view.destroy()
        mount.remove()
    })
})
