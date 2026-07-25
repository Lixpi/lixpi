'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorView } from 'prosemirror-view'
import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model'
import { type CanvasNode, type CanvasState } from '@lixpi/constants'
import { USE_AI_CHAT_META } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPluginConstants.ts'
import {
    serializeAiModelSelectionAttr,
    serializeMediaGenerationConfigSelectionAttr,
} from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'
import { AiPromptInputController } from '$src/services/ai-prompt-input-controller.ts'

vi.mock('uuid', () => ({ v4: vi.fn(() => 'thread-id') }))
vi.mock('$src/settings.ts', () => ({
    settings: {
        aiChatThread: {
            defaultDimensions: {
                width: 420,
                height: 300,
            },
            adjacentNodeGap: 16,
        },
    },
}))

function createPromptSchema() {
    return new Schema({
        nodes: {
            doc: { content: 'block+' },
            text: { group: 'inline' },
            paragraph: {
                group: 'block',
                content: 'inline*',
                attrs: {},
            },
            aiUserMessage: {
                group: 'block',
                content: 'paragraph*',
                attrs: {
                    id: { default: '' },
                    createdAt: { default: 0 },
                    referenceNodeIds: { default: [] },
                },
            },
            aiChatThread: {
                group: 'block',
                content: 'aiUserMessage*',
                attrs: {
                    threadId: { default: '' },
                    referenceId: { default: '' },
                    aiReasoningModels: { default: '' },
                    useMultipleReasoningModels: { default: false },
                    useMultipleImageModels: { default: false },
                    useMultipleVideoModels: { default: false },
                    aiImageModels: { default: '' },
                    imageGenerationSize: { default: 'auto' },
                    imageGenerationConfigGroups: { default: '' },
                    aiVideoModels: { default: '' },
                    videoAspectRatio: { default: '' },
                    videoResolution: { default: '' },
                    videoDuration: { default: '' },
                    videoGenerationConfigGroups: { default: '' },
                },
            },
            image: { inline: true, group: 'inline', attrs: { src: { default: '' } } },
        },
        marks: {},
    })
}

function createTransactionTracker() {
    const inserts: Array<{ pos: number; node: ProseMirrorNode }> = []
    const nodeMarkupCalls: Array<Record<string, unknown>> = []
    const metaCalls: Array<Record<string, unknown>> = []

    const transaction: any = {
        mapping: {
            map: vi.fn((pos: number): number => pos),
        },
        inserts,
        nodeMarkupCalls,
        metaCalls,
    }

    transaction.insert = vi.fn((pos: number, node: ProseMirrorNode) => {
        inserts.push({ pos, node })
        return transaction
    })

    transaction.setNodeMarkup = vi.fn((_nodePos: number, _type: unknown, attrs: unknown) => {
        nodeMarkupCalls.push({
            nodePos: _nodePos,
            attrs,
        })
        return transaction
    })

    transaction.setMeta = vi.fn((meta: unknown, value: unknown) => {
        metaCalls.push({
            meta,
            value,
        })
        return transaction
    })

    return { transaction, inserts, nodeMarkupCalls, metaCalls }
}

function createThreadEditorEntry(params: {
    threadId: string
    threadAttrs?: Partial<Record<string, unknown>>
    threadMessageAttrs?: Partial<Record<string, unknown>>
}) {
    const schema = createPromptSchema()

    const userMessage = schema.nodes.aiUserMessage.create(
        {
            id: 'existing-user-message',
            createdAt: 1,
            referenceNodeIds: [],
            ...params.threadMessageAttrs,
        },
        [schema.nodes.paragraph.create(null, schema.text('existing'))],
    ) as ProseMirrorNode

    const threadNode = schema.nodes.aiChatThread.create(
        {
            threadId: params.threadId,
            referenceId: `reference-${params.threadId}`,
            aiReasoningModels: serializeAiModelSelectionAttr(['existing-model']),
            useMultipleReasoningModels: false,
            useMultipleImageModels: false,
            useMultipleVideoModels: false,
            aiImageModels: serializeAiModelSelectionAttr(['existing-image']),
            imageGenerationSize: 'auto',
            aiVideoModels: serializeAiModelSelectionAttr(['existing-video']),
            videoAspectRatio: '',
            videoResolution: '',
            videoDuration: '',
            ...params.threadAttrs,
        },
        [userMessage],
    ) as ProseMirrorNode

    const doc = schema.nodes.doc.create(null, [threadNode])
    const { transaction, inserts, nodeMarkupCalls, metaCalls } = createTransactionTracker()

    const editorView = {
        state: {
            schema,
            doc,
            tr: transaction,
        },
        dispatch: vi.fn(),
    } as unknown as EditorView

    return {
        schema,
        threadNode,
        doc,
        editorView,
        dispatch: editorView.dispatch as unknown as ReturnType<typeof vi.fn>,
        transaction,
        inserts,
        nodeMarkupCalls,
        metaCalls,
    }
}

function createThreadlessEditorEntry() {
    const schema = createPromptSchema()
    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, schema.text('outside thread content'))])
    const { transaction, inserts, nodeMarkupCalls, metaCalls } = createTransactionTracker()

    const editorView = {
        state: {
            schema,
            doc,
            tr: transaction,
        },
        dispatch: vi.fn(),
    } as unknown as EditorView

    return {
        editorView,
        dispatch: editorView.dispatch as unknown as ReturnType<typeof vi.fn>,
        transaction,
        inserts,
        nodeMarkupCalls,
        metaCalls,
    }
}

function createController(options?: {
    getCanvasState?: () => CanvasState | null
    persistCanvasState?: (state: CanvasState) => void
    createAiChatThread?: ReturnType<typeof vi.fn>
    onAiChatThreadCreated?: ReturnType<typeof vi.fn>
    onAiSubmit?: ReturnType<typeof vi.fn>
}) {
    const persistCanvasState = options?.persistCanvasState ?? vi.fn()
    const createAiChatThread = options?.createAiChatThread ?? vi.fn()
    const onAiChatThreadCreated = options?.onAiChatThreadCreated ?? vi.fn()
    const onAiSubmit = options?.onAiSubmit ?? vi.fn()

    const controller = new AiPromptInputController({
        workspaceId: 'workspace-1',
        getCanvasState: options?.getCanvasState ?? (() => null),
        persistCanvasState,
        onAiChatThreadCreated,
        createAiChatThread,
        onAiSubmit,
    })

    return {
        controller,
        persistCanvasState,
        createAiChatThread,
        onAiChatThreadCreated,
        onAiSubmit,
    }
}

const baseNode: CanvasNode = {
    nodeId: 'target-doc',
    type: 'document',
    position: { x: 10, y: 20 },
    dimensions: { width: 120, height: 200 },
}

describe('AiPromptInputController', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('warns when no target is set', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const { controller } = createController()

        await controller.submitMessage({
            contentJSON: [{ type: 'paragraph' }],
            aiReasoningModels: ['text-model'],
        })

        expect(warnSpy).toHaveBeenCalledWith('[AiPromptInputController] No target set, cannot submit')
        warnSpy.mockRestore()
    })

    it('logs a validation error when AI models are missing', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

        const { controller } = createController()

        controller.setTarget({ nodeId: 'thread-1', type: 'aiChatThread', referenceId: 'thread-1' })
        await controller.submitMessage({
            contentJSON: [{ type: 'paragraph' }],
            aiReasoningModels: [],
        })

        expect(errorSpy).toHaveBeenCalledWith('[AiPromptInputController] Cannot submit without a reasoning model.')
        errorSpy.mockRestore()
    })

    it('queues a pending message and injects it once the thread editor registers', async () => {
        const { controller } = createController()
        const editorEntry = createThreadEditorEntry({
            threadId: 'thread-pending',
            threadAttrs: { aiReasoningModels: serializeAiModelSelectionAttr(['existing-model']) },
        })

        controller.setTarget({ nodeId: 'thread-node', type: 'aiChatThread', referenceId: 'thread-pending' })
        await controller.submitMessage({
            contentJSON: [{
                type: 'paragraph',
                content: [{ type: 'text', text: 'Draft prompt' }],
            }],
            aiReasoningModels: ['text-model'],
            referenceNodeIds: ['image-1', 'image-2'],
        })

        expect(editorEntry.dispatch).not.toHaveBeenCalled()

        controller.registerThreadEditor('thread-pending', {
            editorView: editorEntry.editorView,
            triggerGradientAnimation: vi.fn(),
        })

        expect(editorEntry.dispatch).toHaveBeenCalledWith(editorEntry.transaction)
        expect(editorEntry.transaction.insert).toHaveBeenCalled()
        const insertedNode = editorEntry.inserts.at(-1)?.node
        expect((insertedNode?.attrs as { referenceNodeIds?: unknown[] })?.referenceNodeIds).toEqual(['image-1', 'image-2'])
        expect(editorEntry.transaction.setMeta).toHaveBeenCalledWith(USE_AI_CHAT_META, {
            threadId: 'thread-pending',
            nodePos: 0,
        })
    })

    it('warns when thread editor has no aiChatThread node in the current document', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const { controller } = createController()
        const editorEntry = createThreadlessEditorEntry()

        controller.setTarget({ nodeId: 'thread-missing', type: 'aiChatThread', referenceId: 'thread-missing' })
        controller.registerThreadEditor('thread-missing', {
            editorView: editorEntry.editorView,
            triggerGradientAnimation: vi.fn(),
        })

        await controller.submitMessage({
            contentJSON: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft prompt' }] }],
            aiReasoningModels: ['text-model'],
        })

        expect(warnSpy).toHaveBeenCalledWith('[AiPromptInputController] Could not find aiChatThread node in editor')
        expect(editorEntry.dispatch).not.toHaveBeenCalled()
        warnSpy.mockRestore()
    })

    it('updates thread attributes when options diverge from current settings', async () => {
        const { controller } = createController()
        const editorEntry = createThreadEditorEntry({
            threadId: 'thread-update',
            threadAttrs: {
                useMultipleReasoningModels: false,
                useMultipleImageModels: false,
                useMultipleVideoModels: false,
                aiReasoningModels: serializeAiModelSelectionAttr(['legacy']),
                aiImageModels: serializeAiModelSelectionAttr(['old-img']),
                imageGenerationSize: 'auto',
                imageGenerationConfigGroups: '',
                aiVideoModels: serializeAiModelSelectionAttr(['old-video']),
                videoAspectRatio: '',
                videoResolution: '',
                videoDuration: '',
                videoGenerationConfigGroups: '',
            },
        })

        controller.setTarget({ nodeId: 'thread-update-node', type: 'aiChatThread', referenceId: 'thread-update' })
        controller.registerThreadEditor('thread-update', {
            editorView: editorEntry.editorView,
            triggerGradientAnimation: vi.fn(),
        })

        await controller.submitMessage({
            contentJSON: [{ type: 'paragraph' }],
            aiReasoningModels: ['model-alpha', 'model-beta'],
            useMultipleReasoningModels: true,
            useMultipleImageModels: true,
            useMultipleVideoModels: true,
            imageOptions: {
                aiImageModels: ['img-a', 'img-b'],
                imageGenerationSize: '1024x1024',
                configGroups: [{ groupId: 'size', modelIds: ['img-a'], values: { style: 'vivid' } }],
            },
            videoOptions: {
                aiVideoModels: ['video-a'],
                videoAspectRatio: '16:9',
                videoResolution: '1080p',
                videoDuration: '10',
                configGroups: [{ groupId: 'quality', modelIds: ['video-a'], values: { motion: 'stable' } }],
            },
        })

        const updatedAttrs = editorEntry.nodeMarkupCalls.at(-1)?.attrs as Record<string, unknown> | undefined
        expect(updatedAttrs).toMatchObject({
            aiReasoningModels: serializeAiModelSelectionAttr(['model-alpha', 'model-beta']),
            useMultipleReasoningModels: true,
            useMultipleImageModels: true,
            useMultipleVideoModels: true,
            aiImageModels: serializeAiModelSelectionAttr(['img-a', 'img-b']),
            imageGenerationSize: '1024x1024',
            imageGenerationConfigGroups: serializeMediaGenerationConfigSelectionAttr([
                { groupId: 'size', modelIds: ['img-a'], values: { style: 'vivid' } },
            ]),
            aiVideoModels: serializeAiModelSelectionAttr(['video-a']),
            videoAspectRatio: '16:9',
            videoResolution: '1080p',
            videoDuration: '10',
            videoGenerationConfigGroups: serializeMediaGenerationConfigSelectionAttr([
                { groupId: 'quality', modelIds: ['video-a'], values: { motion: 'stable' } },
            ]),
        })
    })

    it('creates and activates a standalone AI chat thread for non-chat targets', async () => {
        const canvasState: CanvasState = {
            nodes: [
                {
                    ...baseNode,
                    type: 'document',
                },
            ],
            edges: [],
            nodeIdsByType: { document: ['target-doc'], all: ['target-doc'] },
            workspaceId: 'workspace-1',
        } as CanvasState
        const persistCanvasState = vi.fn()
        const createAiChatThread = vi.fn().mockResolvedValue({
            threadId: 'thread-id',
            content: { type: 'doc' },
        })
        const onAiChatThreadCreated = vi.fn()

        const { controller } = createController({
            getCanvasState: () => canvasState,
            persistCanvasState,
            createAiChatThread,
            onAiChatThreadCreated,
        })

        controller.setTarget({ nodeId: 'target-doc', type: 'document', referenceId: 'doc-1' })
        await controller.submitMessage({
            contentJSON: [{
                type: 'paragraph',
                content: [{ type: 'text', text: 'Start a new thread' }],
            }],
            aiReasoningModels: ['text-model'],
            useMultipleReasoningModels: false,
            useMultipleImageModels: false,
            useMultipleVideoModels: false,
            imageOptions: {
                aiImageModels: ['thread-image-model'],
                imageGenerationSize: 'auto',
                configGroups: [],
            },
        })

        expect(createAiChatThread).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            threadId: 'thread-id',
            content: expect.objectContaining({
                type: 'doc',
                content: expect.arrayContaining([
                    expect.objectContaining({
                        type: 'aiChatThread',
                        attrs: expect.objectContaining({
                            threadId: 'thread-id',
                            aiReasoningModels: serializeAiModelSelectionAttr(['text-model']),
                            useMultipleReasoningModels: false,
                            useMultipleImageModels: false,
                            useMultipleVideoModels: false,
                            aiImageModels: serializeAiModelSelectionAttr(['thread-image-model']),
                        }),
                    }),
                ]),
            }),
            aiModel: 'text-model',
            owner: { type: 'standalone' },
        })

        expect(onAiChatThreadCreated).toHaveBeenCalledWith({ threadId: 'thread-id' })
        expect(controller.getTargetThreadId()).toBe('thread-id')

        const threadEditor = createThreadEditorEntry({ threadId: 'thread-id' })
        controller.registerThreadEditor('thread-id', {
            editorView: threadEditor.editorView,
            triggerGradientAnimation: vi.fn(),
        })

        expect(threadEditor.dispatch).toHaveBeenCalledWith(threadEditor.transaction)
    })

    it('does not persist canvas state for document targets in the current implementation', async () => {
        const persistCanvasState = vi.fn()
        const createAiChatThread = vi.fn().mockResolvedValue({
            threadId: 'thread-id',
        })

        const { controller } = createController({
            getCanvasState: () => null,
            persistCanvasState,
            createAiChatThread,
        })

        controller.setTarget({ nodeId: 'target-doc', type: 'document', referenceId: 'doc-1' })
        await controller.submitMessage({
            contentJSON: [{ type: 'paragraph' }],
            aiReasoningModels: ['text-model'],
        })

        expect(createAiChatThread).toHaveBeenCalled()
        expect(persistCanvasState).not.toHaveBeenCalled()
    })

    it('does not explode when thread creation fails and does not activate a new target', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const createAiChatThread = vi.fn().mockRejectedValue(new Error('db down'))
        const onAiChatThreadCreated = vi.fn()

        const { controller } = createController({
            createAiChatThread,
            onAiChatThreadCreated,
        })

        controller.setTarget({ nodeId: 'target-doc', type: 'document', referenceId: 'doc-1' })
        await controller.submitMessage({
            contentJSON: [{ type: 'paragraph' }],
            aiReasoningModels: ['text-model'],
        })

        expect(createAiChatThread).toHaveBeenCalled()
        expect(onAiChatThreadCreated).not.toHaveBeenCalled()
        expect(controller.getTargetThreadId()).toBeNull()
        expect(errorSpy).toHaveBeenCalledWith('[AiPromptInputController] Failed to create thread:', expect.any(Error))
        errorSpy.mockRestore()
    })

    it('tracks receiving state for a selected thread and ignores non-target streaming state', () => {
        const { controller } = createController()
        expect(controller.isReceiving()).toBe(false)

        controller.setReceiving('thread-1', true)
        expect(controller.isReceiving()).toBe(false)

        controller.setTarget({ nodeId: 'thread-1', type: 'aiChatThread', referenceId: 'thread-1' })
        expect(controller.isReceiving()).toBe(true)

        controller.setReceiving('thread-1', false)
        expect(controller.isReceiving()).toBe(false)

        controller.setReceiving('thread-2', true)
        expect(controller.isReceiving('thread-2')).toBe(true)
        expect(controller.isReceiving('thread-1')).toBe(false)
    })

    it('drops queued or pending messages after destroy', async () => {
        const { controller } = createController()
        const editorEntry = createThreadEditorEntry({ threadId: 'thread-destroy' })

        controller.setTarget({ nodeId: 'thread-node-destroy', type: 'aiChatThread', referenceId: 'thread-destroy' })
        await controller.submitMessage({
            contentJSON: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft prompt' }] }],
            aiReasoningModels: ['text-model'],
        })
        controller.destroy()

        controller.registerThreadEditor('thread-destroy', {
            editorView: editorEntry.editorView,
            triggerGradientAnimation: vi.fn(),
        })

        expect(editorEntry.dispatch).not.toHaveBeenCalled()
        expect(controller.getTarget()).toBeNull()
        expect(controller.isReceiving('thread-destroy')).toBe(false)
    })
})
