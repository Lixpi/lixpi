'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProseMirrorEditor from '$src/components/proseMirror/components/editor.ts'
import * as aiChatThreadPluginModule from '$src/components/proseMirror/plugins/aiChatThreadPlugin'
import * as aiPromptInputPluginModule from '$src/components/proseMirror/plugins/aiPromptInputPlugin'
import { aiChatThreadNodeType } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadNode.ts'
import { aiPromptInputNodeType } from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'
import { documentTitleNodeType } from '$src/components/proseMirror/customNodes/documentTitleNode.ts'

const spyCreateAiChatThreadPlugin = vi.spyOn(aiChatThreadPluginModule, 'createAiChatThreadPlugin')
const spyCreateAiPromptInputPlugin = vi.spyOn(aiPromptInputPluginModule, 'createAiPromptInputPlugin')

const aiChatThreadPluginMock = { kind: 'ai-chat-thread-plugin' }
const aiPromptInputPluginMock = { kind: 'ai-prompt-input-plugin' }

function createEditorShim(documentType: string) {
    const editor = Object.create(ProseMirrorEditor.prototype) as any

    editor.documentType = documentType
    editor.threadId = 'thread-1'
    editor.readOnly = false
    editor.isDisabled = false
    editor.isPromptReceiving = vi.fn(() => false)
    editor.onAiChatSubmit = vi.fn()
    editor.onAiChatStop = vi.fn()
    editor.onPromptSubmit = vi.fn()
    editor.onPromptStop = vi.fn()
    editor.promptControlFactories = {
        createContextTray: vi.fn(),
        createModelDropdown: vi.fn(),
        createModelMultiSelect: vi.fn(),
        createImageModelDropdown: vi.fn(),
        createImageModelMultiSelect: vi.fn(),
        createImageSizeDropdown: vi.fn(),
        createVideoModelDropdown: vi.fn(),
        createVideoModelMultiSelect: vi.fn(),
        createVideoAspectDropdown: vi.fn(),
        createVideoResolutionDropdown: vi.fn(),
        createVideoDurationDropdown: vi.fn(),
        createSubmitButton: vi.fn(),
    }
    editor.aiChatThreadRenderContext = { custom: true }
    editor.onEditorChange = vi.fn()
    editor.onStreamingUpdate = vi.fn()
    editor.onProjectTitleChange = vi.fn()
    editor.onReceivingStateChange = vi.fn()
    editor.editorSchema = editor.createSchema()

    return editor
}

beforeEach(() => {
    spyCreateAiChatThreadPlugin.mockReset()
    spyCreateAiPromptInputPlugin.mockReset()
    spyCreateAiChatThreadPlugin.mockReturnValue(aiChatThreadPluginMock as any)
    spyCreateAiPromptInputPlugin.mockReturnValue(aiPromptInputPluginMock as any)
})

describe('ProseMirrorEditor — schema creation', () => {
    it('builds chat-thread document schema with title + chat thread content model', () => {
        const editor = createEditorShim('aiChatThread')
        const titleNode = editor.editorSchema.nodes.documentTitle.create(null, [editor.editorSchema.text('chat document')])
        const chatThreadNode = editor.editorSchema.nodes.aiChatThread.createAndFill()

        const doc = editor.editorSchema.nodes.doc.create(null, [titleNode, chatThreadNode])

        expect(editor.editorSchema.nodes.doc.spec.content).toBe('documentTitle aiChatThread+')
        expect(editor.editorSchema.nodes[aiChatThreadNodeType]).toBeDefined()
        expect(() => doc.check()).not.toThrow()
    })

    it('builds prompt-input document schema with only a single prompt input node', () => {
        const editor = createEditorShim('aiPromptInput')

        expect(editor.editorSchema.nodes.doc.spec.content).toBe('aiPromptInput')
        expect(editor.editorSchema.nodes[aiPromptInputNodeType]).toBeDefined()
    })

    it('builds standard document schema with title + block content model', () => {
        const editor = createEditorShim('document')

        expect(editor.editorSchema.nodes.doc.spec.content).toBe('documentTitle block+')
    })
})

describe('ProseMirrorEditor — createInitialDocument', () => {
    it('returns provided initialVal for valid AI prompt input documents', () => {
        const editor = createEditorShim('aiPromptInput')
        const inputNode = editor.editorSchema.nodes.aiPromptInput.createAndFill()
        const initialDocument = editor.editorSchema.nodes.doc.create(null, [inputNode]).toJSON()

        const doc = editor.createInitialDocument(initialDocument, undefined)

        expect(doc.toJSON()).toEqual(initialDocument)
    })

    it('falls back to a fresh AI prompt input node for invalid draft JSON', () => {
        const editor = createEditorShim('aiPromptInput')
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const doc = editor.createInitialDocument({
            type: 'doc',
            content: [{ type: 'not-a-node' }],
        }, undefined)

        expect(doc.type.name).toBe('doc')
        expect(doc.childCount).toBe(1)
        expect(doc.child(0).type.name).toBe(aiPromptInputNodeType)
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('[EDITOR] Invalid AI prompt draft, creating fresh input:'),
            expect.any(Error),
        )

        warnSpy.mockRestore()
    })

    it('reuses parsed AI chat thread content when it is valid', () => {
        const editor = createEditorShim('aiChatThread')
        const titleNode = editor.editorSchema.nodes.documentTitle.create(null, [editor.editorSchema.text('Hello world')])
        const threadNode = editor.editorSchema.nodes.aiChatThread.createAndFill({
            threadId: 'from-initial-val',
        })
        const initialVal = editor.editorSchema.nodes.doc.create(null, [titleNode, threadNode]).toJSON()

        const doc = editor.createInitialDocument(initialVal, undefined)

        expect(doc.toJSON()).toEqual(initialVal)
    })

    it('falls back to a fresh chat thread doc with threadId when initialVal is invalid', () => {
        const editor = createEditorShim('aiChatThread')
        editor.threadId = 'fallback-thread'
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const doc = editor.createInitialDocument({
            type: 'doc',
            content: [{ type: 'not-a-node' }],
        }, undefined)

        expect(doc.type.name).toBe('doc')
        expect(doc.child(0).type.name).toBe(documentTitleNodeType)
        expect(doc.child(1).type.name).toBe(aiChatThreadNodeType)
        expect(doc.child(1).attrs.threadId).toBe('fallback-thread')
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('📝 [EDITOR] Invalid AI chat thread content, creating fresh document:'),
            expect.any(Error),
        )

        warnSpy.mockRestore()
    })
})

describe('ProseMirrorEditor — plugin wiring', () => {
    it('adds AI chat thread plugin only for aiChatThread documents', () => {
        const editor = createEditorShim('aiChatThread')

        const plugins = editor.createPlugins({}, false)

        expect(spyCreateAiChatThreadPlugin).toHaveBeenCalledOnce()
        expect(spyCreateAiPromptInputPlugin).not.toHaveBeenCalled()
        const args = spyCreateAiChatThreadPlugin.mock.calls[0][0]
        args.sendAiRequestHandler('payload')
        expect(editor.onAiChatSubmit).toHaveBeenCalledWith('payload')
        args.stopAiRequestHandler('thread-id')
        expect(editor.onAiChatStop).toHaveBeenCalledWith('thread-id')
        expect(args.renderContext).toEqual(editor.aiChatThreadRenderContext)
        expect(plugins).toContain(aiChatThreadPluginMock)
    })

    it('adds AI prompt input plugin only for aiPromptInput documents', () => {
        const editor = createEditorShim('aiPromptInput')
        editor.isPromptReceiving = vi.fn(() => true)
        const plugins = editor.createPlugins({}, false)

        expect(spyCreateAiPromptInputPlugin).toHaveBeenCalledOnce()
        expect(spyCreateAiChatThreadPlugin).not.toHaveBeenCalled()
        const args = spyCreateAiPromptInputPlugin.mock.calls[0][0]
        args.onSubmit('payload')
        expect(editor.onPromptSubmit).toHaveBeenCalledWith('payload')
        args.onStop()
        expect(editor.onPromptStop).toHaveBeenCalled()
        expect(args.isReceiving()).toBe(true)
        expect(editor.isPromptReceiving).toHaveBeenCalledTimes(1)
        expect(args.createContextTray).toBe(editor.promptControlFactories.createContextTray)
        expect(args.createModelDropdown).toBe(editor.promptControlFactories.createModelDropdown)
        expect(plugins).toContain(aiPromptInputPluginMock)
    })

    it('does not add AI-specific plugins for standard documents', () => {
        const editor = createEditorShim('document')
        const plugins = editor.createPlugins({}, false)

        expect(spyCreateAiPromptInputPlugin).not.toHaveBeenCalled()
        expect(spyCreateAiChatThreadPlugin).not.toHaveBeenCalled()
        expect(plugins).not.toContain(aiChatThreadPluginMock)
        expect(plugins).not.toContain(aiPromptInputPluginMock)
    })
})

describe('ProseMirrorEditor — state/editability and lifecycle', () => {
    it('reports editability from disabled/read-only flags', () => {
        const editor = createEditorShim('document')

        expect(editor.isEditorEditable()).toBe(true)

        editor.isDisabled = true
        expect(editor.isEditorEditable()).toBe(false)

        editor.isDisabled = false
        editor.readOnly = true
        expect(editor.isEditorEditable()).toBe(false)
    })

    it('forwards editor state and streaming callbacks', () => {
        const editor = createEditorShim('document')
        const documentChange = { type: 'change' }
        const streamingChange = { type: 'streaming' }

        editor.dispatchStateChange(documentChange)
        editor.dispatchStreamingUpdate(streamingChange)

        expect(editor.onEditorChange).toHaveBeenCalledWith(documentChange)
        expect(editor.onStreamingUpdate).toHaveBeenCalledWith(streamingChange)
    })

    it('sets new editable prop when focus state updates', () => {
        const editor = createEditorShim('document')
        editor.editorView = {
            setProps: vi.fn(),
        }

        editor.updateEditorFocusState()
        expect(editor.editorView.setProps).toHaveBeenCalledWith({
            editable: expect.any(Function),
        })
    })

    it('destroys editor view and clears schema state', () => {
        const editor = createEditorShim('document')
        const destroyMock = vi.fn()
        editor.editorView = { destroy: destroyMock }

        editor.destroy()

        expect(destroyMock).toHaveBeenCalledTimes(1)
        expect(editor.editorView).toBeNull()
        expect(editor.editorSchema).toBeNull()
    })
})
