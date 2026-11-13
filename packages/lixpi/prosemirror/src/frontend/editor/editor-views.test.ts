// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { createCoreDocumentKindRegistry } from '@lixpi/prosemirror'
import {
    type DocumentEditorHandle,
} from '@lixpi/prosemirror/frontend/document-editor'

import {
    capabilityArtifactEditorView,
    editorDocumentViews,
    mountEditorDocument,
} from './editor-views.ts'
import { createTestEditorServices } from '../../test-helpers/test-editor-services.ts'

const registry = createCoreDocumentKindRegistry()
const testServices = createTestEditorServices()
const handles: DocumentEditorHandle[] = []

afterEach(() => {
    for (const handle of handles.splice(0))
        handle.destroy()
})

const featureIds = (kindId: string): string[] => editorDocumentViews[kindId]!.features.map(feature => feature.id)

const richFeatures = [
    'document-sync',
    'focus',
    'bubble-menu',
    'link-tooltip',
    'image-selection',
    'prompt-reference-node-view',
    'input-rules',
]
const editingFeatures = ['rich-keymap', 'base-keymap', 'drop-cursor', 'gap-cursor', 'history', 'code-block']

describe('editor document views', () => {
    it('runs the same features in the same order for content, title and metadata', () => {
        for (const kindId of ['assetContent', 'assetTitle', 'assetMetadata'])
            expect(featureIds(kindId)).toEqual([...richFeatures, ...editingFeatures, 'editable'])
    })

    it('adds the thread shortcut only to conversations and the chat thread to both thread kinds', () => {
        expect(featureIds('assetConversation')).toEqual([...richFeatures, 'ai-chat-thread-shortcut', ...editingFeatures, 'ai-chat-thread', 'editable'])
        expect(featureIds('assetProvenance')).toEqual([...richFeatures, ...editingFeatures, 'ai-chat-thread', 'editable'])
    })

    it('puts the pickers and the prompt input ahead of the editing features', () => {
        expect(featureIds('aiPromptInput')).toEqual([
            'prompt-reference-picker',
            'capability-module-picker',
            'ai-prompt-input',
            ...richFeatures,
            ...editingFeatures,
            'editable',
        ])
    })

    it('wraps a Capability Artifact view in the editor session around its own features', () => {
        const ownFeature = {
            id: 'artifact-own',
            create: () => ({}),
        }
        const createInitialDocument = vi.fn()
        const view = capabilityArtifactEditorView({
            kindId: 'capabilityArtifact:example',
            features: [ownFeature],
            createInitialDocument,
        })

        expect(view.kindId).toBe('capabilityArtifact:example')
        expect(view.createInitialDocument).toBe(createInitialDocument)
        expect(view.features.map(feature => feature.id)).toEqual([
            'document-sync',
            'focus',
            'prompt-reference-node-view',
            'artifact-own',
            'base-keymap',
            'drop-cursor',
            'gap-cursor',
            'history',
            'prompt-reference-picker',
            'editable',
        ])
    })

    it('starts an empty conversation as one thread with the host thread id', () => {
        const handle = mountEditorDocument({
            registry,
            definition: editorDocumentViews.assetConversation!,
            container: document.createElement('div'),
            readOnly: true,
            context: {
                services: testServices.services,
                promptReferences: {},
                chat: {
                    threadId: 'thread-1',
                    onSubmit: vi.fn(),
                    onStop: vi.fn(),
                },
            },
        })
        handles.push(handle)

        const thread = handle.view.state.doc.firstChild!
        expect(thread.type.name).toBe('aiChatThread')
        expect(thread.attrs.threadId).toBe('thread-1')
        expect(handle.view.editable).toBe(false)
    })

    it('mounts a prompt input that reports changes and no pickers without a catalog', () => {
        const onChange = vi.fn()
        const handle = mountEditorDocument({
            registry,
            definition: editorDocumentViews.aiPromptInput!,
            container: document.createElement('div'),
            onChange,
            context: {
                services: testServices.services,
                promptReferences: {},
                prompt: {
                    onSubmit: vi.fn(),
                    controls: {
                        createModelDropdown: () => ({
                            dom: document.createElement('div'),
                            update: vi.fn(),
                        }),
                        createImageModelDropdown: () => ({
                            dom: document.createElement('div'),
                            update: vi.fn(),
                        }),
                        createImageSizeDropdown: () => ({
                            dom: document.createElement('div'),
                            update: vi.fn(),
                        }),
                        createVideoModelDropdown: () => ({
                            dom: document.createElement('div'),
                            update: vi.fn(),
                        }),
                        createVideoAspectDropdown: () => ({
                            dom: document.createElement('div'),
                            update: vi.fn(),
                        }),
                        createVideoResolutionDropdown: () => ({
                            dom: document.createElement('div'),
                            update: vi.fn(),
                        }),
                        createVideoDurationDropdown: () => ({
                            dom: document.createElement('div'),
                            update: vi.fn(),
                        }),
                        createSubmitButton: () => document.createElement('button'),
                    } as never,
                },
            },
        })
        handles.push(handle)

        expect(handle.view.state.doc.firstChild?.type.name).toBe('aiPromptInput')
        expect(handle.view.state.plugins.some(plugin => (plugin as unknown as { key: string }).key.startsWith('promptReferencePicker'))).toBe(false)

        handle.view.dispatch(handle.view.state.tr.insertText('hello', 2))

        expect(onChange).toHaveBeenCalled()
    })
})
