'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorView } from 'prosemirror-view'
import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model'
import { type CanvasNode, type CanvasState } from '@lixpi/constants'
import { USE_AI_CHAT_META } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPluginConstants.ts'
import { serializeAiModelSelectionAttr } from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'
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
                },
            },
            aiChatThread: {
                group: 'block',
                content: 'aiUserMessage*',
                attrs: {
                    threadId: { default: '' },
                    referenceId: { default: '' },
                    aiModel: { default: '' },
                    aiModels: { default: '' },
                    useMultipleModels: { default: false },
                    useMultipleReasoningModels: { default: false },
                    useMultipleImageModels: { default: false },
                    useMultipleVideoModels: { default: false },
                    aiImageModel: { default: '' },
                    aiImageModels: { default: '' },
                    imageGenerationSize: { default: 'auto' },
                    aiVideoModel: { default: '' },
                    aiVideoModels: { default: '' },
                    videoAspectRatio: { default: '' },
                    videoResolution: { default: '' },
                    videoDuration: { default: '' },
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
}) {
    const schema = createPromptSchema()

    const userMessage = schema.nodes.aiUserMessage.create(
        {
            id: 'existing-user-message',
            createdAt: 1,
        },
        [schema.nodes.paragraph.create(null, schema.text('existing'))],
    ) as ProseMirrorNode

    const threadNode = schema.nodes.aiChatThread.create(
        {
            threadId: params.threadId,
            referenceId: `reference-${params.threadId}`,
            aiModel: 'existing-model',
            useMultipleModels: false,
            useMultipleReasoningModels: false,
            useMultipleImageModels: false,
            useMultipleVideoModels: false,
            aiImageModel: 'existing-image',
            aiImageModels: '[]',
            imageGenerationSize: 'auto',
            aiVideoModel: 'existing-video',
            aiVideoModels: '[]',
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

function createController(options?: {
    getCanvasState?: () => CanvasState | null
    persistCanvasState?: (state: CanvasState) => void
    createAiChatThread?: ReturnType<typeof vi.fn>
    onAiChatThreadCreated?: ReturnType<typeof vi.fn>
    onAiSubmit?: ReturnType<typeof vi.fn>
    onAiStop?: ReturnType<typeof vi.fn>
}) {
    const persistCanvasState = options?.persistCanvasState ?? vi.fn()
    const createAiChatThread = options?.createAiChatThread ?? vi.fn()
    const onAiChatThreadCreated = options?.onAiChatThreadCreated ?? vi.fn()
    const onAiSubmit = options?.onAiSubmit ?? vi.fn()
    const onAiStop = options?.onAiStop ?? vi.fn()

    const controller = new AiPromptInputController({
        workspaceId: 'workspace-1',
        getCanvasState: options?.getCanvasState ?? (() => null),
        persistCanvasState,
        onAiChatThreadCreated,
        createAiChatThread,
        onAiSubmit,
        onAiStop,
    })

    return {
        controller,
        persistCanvasState,
        createAiChatThread,
        onAiChatThreadCreated,
        onAiSubmit,
        onAiStop,
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

    it('does not submit when no target is set', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const { controller } = createController()

        await controller.submitMessage({
            contentJSON: [{ type: 'paragraph' }],
            aiModel: 'text-model',
        })

        expect(warnSpy).toHaveBeenCalledWith('[AiPromptInputController] No target set, cannot submit')
    })

    it('alerts when AI model is missing for any target', async () => {
        const originalAlert = (globalThis as { alert?: () => void }).alert
        const alertSpy = vi.fn()
        ;(globalThis as { alert?: () => void }).alert = alertSpy
        const { controller } = createController()

        controller.setTarget({ nodeId: 'thread-1', type: 'aiChatThread', referenceId: 'thread-1' })
        await controller.submitMessage({
            contentJSON: [{ type: 'paragraph' }],
            aiModel: '',
        })

        expect(alertSpy).toHaveBeenCalledWith('Please select an AI model from the dropdown before submitting.')
        ;(globalThis as { alert?: () => void }).alert = originalAlert
    })

    it('queues a message until the target thread editor mounts, then injects it', async () => {
        const { controller } = createController()
        const editorEntry = createThreadEditorEntry({
            threadId: 'thread-1',
            threadAttrs: { aiModel: 'existing-model' },
        })

        controller.setTarget({ nodeId: 'thread-node-1', type: 'aiChatThread', referenceId: 'thread-1' })
        await controller.submitMessage({
            contentJSON: [{
                type: 'paragraph',
                content: [{ type: 'text', text: 'Draft prompt' }],
            }],
            aiModel: 'text-model',
        })

        expect(editorEntry.dispatch).not.toHaveBeenCalled()

        controller.registerThreadEditor('thread-1', {
            editorView: editorEntry.editorView,
            triggerGradientAnimation: vi.fn(),
        })

        expect(editorEntry.dispatch).toHaveBeenCalledWith(editorEntry.transaction)
        expect(editorEntry.transaction.insert).toHaveBeenCalled()
        expect(editorEntry.transaction.setMeta).toHaveBeenCalledWith(USE_AI_CHAT_META, {
            threadId: 'thread-1',
            nodePos: 0,
        })
    })

    it('updates existing thread attrs when the incoming submission options differ', async () => {
        const { controller } = createController()
        const editorEntry = createThreadEditorEntry({
            threadId: 'thread-2',
            threadAttrs: {
                aiModel: 'existing-model',
                useMultipleReasoningModels: false,
                useMultipleImageModels: false,
                useMultipleVideoModels: false,
                aiModels: serializeAiModelSelectionAttr(['legacy']) ,
                aiImageModel: 'old-img',
                aiImageModels: '[]',
                imageGenerationSize: 'auto',
                aiVideoModel: 'old-video',
                aiVideoModels: '[]',
                videoAspectRatio: '',
                videoResolution: '',
                videoDuration: '',
            },
        })

        controller.setTarget({
            nodeId: 'thread-node-2',
            type: 'aiChatThread',
            referenceId: 'thread-2',
        })

        controller.registerThreadEditor('thread-2', {
            editorView: editorEntry.editorView,
            triggerGradientAnimation: vi.fn(),
        })

        await controller.submitMessage({
            contentJSON: [{ type: 'paragraph' }],
            aiModel: 'next-text-model',
            aiModels: ['model-alpha', 'model-alpha', 'model-beta'],
            useMultipleModels: true,
            useMultipleImageModels: true,
            imageOptions: {
                aiImageModel: 'new-img',
                aiImageModels: ['img-a', 'img-b'],
                imageGenerationSize: '1024x1024',
            },
            videoOptions: {
                aiVideoModel: 'new-video',
                aiVideoModels: ['video-a'],
                videoAspectRatio: '16:9',
                videoResolution: '1080p',
                videoDuration: '10',
            },
        })

        expect(editorEntry.transaction.setNodeMarkup).toHaveBeenCalled()
        const updatedAttrs = editorEntry.nodeMarkupCalls.at(-1)?.attrs as Record<string, unknown> | undefined
        expect(updatedAttrs).toMatchObject({
            aiModel: 'next-text-model',
            aiModels: serializeAiModelSelectionAttr(['model-alpha', 'model-beta']),
            useMultipleModels: true,
            useMultipleReasoningModels: true,
            useMultipleImageModels: true,
            useMultipleVideoModels: true,
            aiImageModel: 'new-img',
            aiImageModels: serializeAiModelSelectionAttr(['img-a', 'img-b']),
            imageGenerationSize: '1024x1024',
            aiVideoModel: 'new-video',
            aiVideoModels: serializeAiModelSelectionAttr(['video-a']),
            videoAspectRatio: '16:9',
            videoResolution: '1080p',
            videoDuration: '10',
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
            aiModel: 'text-model',
            useMultipleModels: true,
            imageOptions: {
                aiImageModel: 'thread-image-model',
                imageGenerationSize: 'auto',
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
                            aiModel: 'text-model',
                            useMultipleModels: true,
                            useMultipleReasoningModels: true,
                            useMultipleImageModels: true,
                            useMultipleVideoModels: true,
                            aiImageModel: 'thread-image-model',
                        }),
                    }),
                ]),
            }),
            aiModel: 'text-model',
            owner: { type: 'standalone' },
        })

        expect(persistCanvasState).toHaveBeenCalledWith(
            expect.objectContaining({
                nodes: expect.arrayContaining([
                    expect.objectContaining({
                        nodeId: 'node-thread-id',
                        type: 'aiChatThread',
                        referenceId: 'thread-id',
                        position: { x: 146, y: 20 },
                        dimensions: { width: 420, height: 300 },
                    }),
                ]),
                edges: expect.arrayContaining([
                    expect.objectContaining({ sourceNodeId: 'target-doc', targetNodeId: 'node-thread-id' }),
                ]),
            }),
        )

        expect(onAiChatThreadCreated).toHaveBeenCalledWith({
            threadId: 'thread-id',
            nodeId: 'node-thread-id',
        })
        expect(controller.getTargetThreadId()).toBe('thread-id')

        const threadEditor = createThreadEditorEntry({ threadId: 'thread-id' })
        controller.registerThreadEditor('thread-id', {
            editorView: threadEditor.editorView,
            triggerGradientAnimation: vi.fn(),
        })

        expect(threadEditor.dispatch).toHaveBeenCalledWith(threadEditor.transaction)
    })

    it('tracks receiving state and falls back to the selected target thread', () => {
        const { controller } = createController()
        expect(controller.isReceiving()).toBe(false)

        controller.setReceiving('thread-1', true)
        expect(controller.isReceiving()).toBe(false)

        controller.setTarget({ nodeId: 'thread-1', type: 'aiChatThread', referenceId: 'thread-1' })
        expect(controller.isReceiving()).toBe(true)

        controller.setReceiving('thread-1', false)
        expect(controller.isReceiving()).toBe(false)
    })
})
