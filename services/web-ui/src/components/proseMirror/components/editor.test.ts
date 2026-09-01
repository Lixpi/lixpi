'use strict'

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

vi.mock('$src/components/proseMirror/plugins/aiChatThreadPlugin', () => ({
    createAiChatThreadPlugin: vi.fn(),
}))
vi.mock('$src/components/proseMirror/plugins/aiPromptInputPlugin', () => ({
    createAiPromptInputPlugin: vi.fn(),
}))

import ProseMirrorEditor from '$src/components/proseMirror/components/editor.ts'
import * as aiChatThreadPluginModule from '$src/components/proseMirror/plugins/aiChatThreadPlugin'
import * as aiPromptInputPluginModule from '$src/components/proseMirror/plugins/aiPromptInputPlugin'
import { aiChatThreadNodeType } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadNode.ts'
import { aiPromptInputNodeType } from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'
import { DOCUMENT_TYPE } from '@lixpi/prosemirror'

let consoleWarnSpy: ReturnType<typeof vi.spyOn> | null = null
let consoleLogSpy: ReturnType<typeof vi.spyOn> | null = null
let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null

const spyCreateAiChatThreadPlugin = vi.mocked(aiChatThreadPluginModule.createAiChatThreadPlugin)
const spyCreateAiPromptInputPlugin = vi.mocked(aiPromptInputPluginModule.createAiPromptInputPlugin)

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
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    spyCreateAiChatThreadPlugin.mockReset()
    spyCreateAiPromptInputPlugin.mockReset()
    spyCreateAiChatThreadPlugin.mockReturnValue(aiChatThreadPluginMock as any)
    spyCreateAiPromptInputPlugin.mockReturnValue(aiPromptInputPluginMock as any)
})

afterEach(() => {
    consoleWarnSpy?.mockRestore()
    consoleLogSpy?.mockRestore()
    consoleErrorSpy?.mockRestore()
    consoleWarnSpy = null
    consoleLogSpy = null
    consoleErrorSpy = null
})

describe('ProseMirrorEditor — schema creation', () => {
    it('builds chat-thread document schema with a chat thread content model', () => {
        const editor = createEditorShim(DOCUMENT_TYPE.ASSET_CONVERSATION)
        const chatThreadNode = editor.editorSchema.nodes.aiChatThread.createAndFill()

        const doc = editor.editorSchema.nodes.doc.create(null, [chatThreadNode])

        expect(editor.editorSchema.nodes.doc.spec.content).toBe('aiChatThread+')
        expect(editor.editorSchema.nodes[aiChatThreadNodeType]).toBeDefined()
        expect(() => doc.check()).not.toThrow()
    })

    it('builds prompt-input document schema with only a single prompt input node', () => {
        const editor = createEditorShim(DOCUMENT_TYPE.AI_PROMPT_INPUT)

        expect(editor.editorSchema.nodes.doc.spec.content).toBe('aiPromptInput')
        expect(editor.editorSchema.nodes[aiPromptInputNodeType]).toBeDefined()
    })

    it('builds standard document schema with a block content model', () => {
        const editor = createEditorShim(DOCUMENT_TYPE.ASSET_CONTENT)

        expect(editor.editorSchema.nodes.doc.spec.content).toBe('block+')
    })
})

describe('ProseMirrorEditor — createInitialDocument', () => {
    it('returns provided initialVal for valid AI prompt input documents', () => {
        const editor = createEditorShim(DOCUMENT_TYPE.AI_PROMPT_INPUT)
        const inputNode = editor.editorSchema.nodes.aiPromptInput.createAndFill()
        const initialDocument = editor.editorSchema.nodes.doc.create(null, [inputNode]).toJSON()

        const doc = editor.createInitialDocument(initialDocument, undefined)

        expect(doc.toJSON()).toEqual(initialDocument)
    })

    it('falls back to a fresh AI prompt input node for invalid draft JSON', () => {
        const editor = createEditorShim(DOCUMENT_TYPE.AI_PROMPT_INPUT)

        const doc = editor.createInitialDocument({
            type: 'doc',
            content: [{ type: 'not-a-node' }],
        }, undefined)

        expect(doc.type.name).toBe('doc')
        expect(doc.childCount).toBe(1)
        expect(doc.child(0).type.name).toBe(aiPromptInputNodeType)
        expect(consoleWarnSpy).not.toBeNull()
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            expect.stringContaining('[EDITOR] Invalid AI prompt draft, creating fresh input:'),
            expect.any(Error),
        )
    })

    it('reuses parsed AI chat thread content when it is valid', () => {
        const editor = createEditorShim(DOCUMENT_TYPE.ASSET_CONVERSATION)
        const threadNode = editor.editorSchema.nodes.aiChatThread.createAndFill({
            threadId: 'from-initial-val',
        })
        const initialVal = editor.editorSchema.nodes.doc.create(null, [threadNode]).toJSON()

        const doc = editor.createInitialDocument(initialVal, undefined)

        expect(doc.toJSON()).toEqual(initialVal)
    })

    it('falls back to a fresh chat thread doc with threadId when initialVal is invalid', () => {
        const editor = createEditorShim(DOCUMENT_TYPE.ASSET_CONVERSATION)
        editor.threadId = 'fallback-thread'

        const doc = editor.createInitialDocument({
            type: 'doc',
            content: [{ type: 'not-a-node' }],
        }, undefined)

        expect(doc.type.name).toBe('doc')
        expect(doc.childCount).toBe(1)
        expect(doc.child(0).type.name).toBe(aiChatThreadNodeType)
        expect(doc.child(0).attrs.threadId).toBe('fallback-thread')
        expect(consoleWarnSpy).not.toBeNull()
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            expect.stringContaining('📝 [EDITOR] Invalid AI chat thread content, creating fresh document:'),
            expect.any(Error),
        )
    })

    it('reuses provided initial content when parsing a standard document and no fallback is needed', () => {
        const editor = createEditorShim(DOCUMENT_TYPE.ASSET_CONTENT)
        const paragraphNode = editor.editorSchema.nodes.paragraph.create(null, [
            editor.editorSchema.text('Hello, world'),
        ])
        const initialDocument = editor.editorSchema.nodes.doc.create(null, [paragraphNode]).toJSON()

        const doc = editor.createInitialDocument(initialDocument, undefined)

        expect(doc.toJSON()).toEqual(initialDocument)
    })

    it('falls back to DOM parsing for standard documents when initialVal is empty', () => {
        const editor = createEditorShim(DOCUMENT_TYPE.ASSET_CONTENT)
        const content = document.createElement('div')
        content.innerHTML = '<p>Fallback content</p>'

        const doc = editor.createInitialDocument({}, content)

        expect(doc.childCount).toBe(1)
        expect(doc.child(0).type.name).toBe('paragraph')
        expect(doc.textContent).toBe('Fallback content')
    })

    it('throws while parsing standard documents when initialVal has unknown node shape', () => {
        const editor = createEditorShim(DOCUMENT_TYPE.ASSET_CONTENT)
        const call = () => editor.createInitialDocument({ invalid: 'document' }, undefined)

        expect(call).toThrow()
    })
})

describe('ProseMirrorEditor — plugin wiring', () => {
    it('adds AI chat thread plugin only for assetConversation documents', async () => {
        const editor = createEditorShim(DOCUMENT_TYPE.ASSET_CONVERSATION)

        const plugins = editor.createPlugins({}, false)

        expect(spyCreateAiChatThreadPlugin).toHaveBeenCalledOnce()
        expect(spyCreateAiPromptInputPlugin).not.toHaveBeenCalled()
        const args = spyCreateAiChatThreadPlugin.mock.calls[0][0]
        // sendAiRequestHandler awaits proseMirrorAuthority?.flushPendingSteps() before
        // forwarding, so the callback resolves asynchronously.
        await args.sendAiRequestHandler('payload')
        expect(editor.onAiChatSubmit).toHaveBeenCalledWith('payload')
        args.stopAiRequestHandler('thread-id')
        expect(editor.onAiChatStop).toHaveBeenCalledWith('thread-id')
        expect(args.renderContext).toEqual(editor.aiChatThreadRenderContext)
        expect(plugins).toContain(aiChatThreadPluginMock)
    })

    it('adds AI prompt input plugin only for aiPromptInput documents', () => {
        const editor = createEditorShim(DOCUMENT_TYPE.AI_PROMPT_INPUT)
        const plugins = editor.createPlugins({}, false)

        expect(spyCreateAiPromptInputPlugin).toHaveBeenCalledOnce()
        expect(spyCreateAiChatThreadPlugin).not.toHaveBeenCalled()
        const args = spyCreateAiPromptInputPlugin.mock.calls[0][0]
        args.onSubmit('payload')
        expect(editor.onPromptSubmit).toHaveBeenCalledWith('payload')
        expect(args.createContextTray).toBe(editor.promptControlFactories.createContextTray)
        expect(args.createModelDropdown).toBe(editor.promptControlFactories.createModelDropdown)
        expect(plugins).toContain(aiPromptInputPluginMock)
    })

    it('does not add AI-specific plugins for standard documents', () => {
        const editor = createEditorShim(DOCUMENT_TYPE.ASSET_CONTENT)
        const plugins = editor.createPlugins({}, false)

        expect(spyCreateAiPromptInputPlugin).not.toHaveBeenCalled()
        expect(spyCreateAiChatThreadPlugin).not.toHaveBeenCalled()
        expect(plugins).not.toContain(aiChatThreadPluginMock)
        expect(plugins).not.toContain(aiPromptInputPluginMock)
    })

    it('injects ai thread render context into aiChatThread plugin creation args', () => {
        const editor = createEditorShim(DOCUMENT_TYPE.ASSET_CONVERSATION)
        editor.aiChatThreadRenderContext = { custom: true, trace: 'enabled' }

        const plugins = editor.createPlugins({}, false)

        expect(plugins).toContain(aiChatThreadPluginMock)
        expect(spyCreateAiChatThreadPlugin).toHaveBeenCalledOnce()
        const args = spyCreateAiChatThreadPlugin.mock.calls[0][0]
        expect(args.renderContext).toEqual(editor.aiChatThreadRenderContext)
    })
})

describe('ProseMirrorEditor — state/editability and lifecycle', () => {
    it('reports editability from disabled/read-only flags', () => {
        const editor = createEditorShim(DOCUMENT_TYPE.ASSET_CONTENT)

        expect(editor.isEditorEditable()).toBe(true)

        editor.isDisabled = true
        expect(editor.isEditorEditable()).toBe(false)

        editor.isDisabled = false
        editor.readOnly = true
        expect(editor.isEditorEditable()).toBe(false)
    })

    it('forwards editor state and streaming callbacks', () => {
        const editor = createEditorShim(DOCUMENT_TYPE.ASSET_CONTENT)
        const documentChange = { type: 'change' }
        const streamingChange = { type: 'streaming' }

        editor.dispatchStateChange(documentChange)
        editor.dispatchStreamingUpdate(streamingChange)

        expect(editor.onEditorChange).toHaveBeenCalledWith(documentChange)
        expect(editor.onStreamingUpdate).toHaveBeenCalledWith(streamingChange)
    })

    it('delegates local transactions to ProseMirror authority when present', () => {
        const editor = createEditorShim(DOCUMENT_TYPE.ASSET_CONTENT)
        const transaction = { docChanged: true }
        editor.proseMirrorAuthority = {
            submitLocalTransaction: vi.fn(),
            disconnect: vi.fn(),
        }

        editor.dispatchLocalTransaction(transaction)

        expect(editor.proseMirrorAuthority.submitLocalTransaction).toHaveBeenCalledWith(transaction)
    })

    it('sets new editable prop when focus state updates', () => {
        const editor = createEditorShim(DOCUMENT_TYPE.ASSET_CONTENT)
        editor.editorView = {
            setProps: vi.fn(),
        }

        editor.updateEditorFocusState()
        expect(editor.editorView.setProps).toHaveBeenCalledWith({
            editable: expect.any(Function),
        })
    })

    it('ignores a lease-state callback after the editor view is destroyed', () => {
        const editor = createEditorShim(DOCUMENT_TYPE.ASSET_CONTENT)
        const onLeaseStateChange = vi.fn()
        editor.editorView = null

        expect(() => editor.handleLeaseStateChange({ readOnly: false }, onLeaseStateChange)).not.toThrow()
        expect(onLeaseStateChange).not.toHaveBeenCalled()
    })

    it('destroys editor view and clears schema state', () => {
        const editor = createEditorShim(DOCUMENT_TYPE.ASSET_CONTENT)
        const destroyMock = vi.fn()
        const disconnectMock = vi.fn()
        editor.editorView = { destroy: destroyMock }
        editor.proseMirrorAuthority = { disconnect: disconnectMock }

        editor.destroy()

        expect(disconnectMock).toHaveBeenCalledTimes(1)
        expect(destroyMock).toHaveBeenCalledTimes(1)
        expect(editor.proseMirrorAuthority).toBeNull()
        expect(editor.editorView).toBeNull()
        expect(editor.editorSchema).toBeNull()
    })
})
