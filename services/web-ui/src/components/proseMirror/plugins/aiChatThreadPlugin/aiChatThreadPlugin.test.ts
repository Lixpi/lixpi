'use strict'

import { describe, expect, it, vi } from 'vitest'
import { beforeEach, beforeAll } from 'vitest'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { STOP_AI_CHAT_META, USE_AI_CHAT_META } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPluginConstants.ts'
import { createAiChatThreadPlugin } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPlugin.ts'
import {
    doc,
    findNodePosition,
    schema,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'

function createPlugin(sendAiRequestHandler = vi.fn(), stopAiRequestHandler = vi.fn()) {
    return createAiChatThreadPlugin({
        sendAiRequestHandler,
        stopAiRequestHandler,
        placeholders: { titlePlaceholder: 'Title', paragraphPlaceholder: 'Type here' },
    })
}

const alertMock = vi.fn()
beforeAll(() => {
    ;(globalThis as any).alert = alertMock
})
beforeEach(() => {
    alertMock.mockReset()
})

function collectNodes(state: EditorState, nodeType: string): ProseMirrorNode[] {
    const nodes: ProseMirrorNode[] = []
    state.doc.descendants((node) => {
        if (node.type.name === nodeType) nodes.push(node)
    })
    return nodes
}

function makeUserMessage(text: string, extraChildren: ProseMirrorNode[] = []): ProseMirrorNode {
    return schema.nodes.aiUserMessage.create({}, [schema.nodes.paragraph.create(null, schema.text(text)), ...extraChildren])
}

function makeImageRef(overrides: Record<string, unknown> = {}): ProseMirrorNode {
    return schema.nodes.aiGeneratedImage.create({
        imageData: 'data:image/png;base64,ZmFrZQ==',
        fileId: 'image-file',
        workspaceId: 'workspace-image',
        revisedPrompt: '',
        responseId: 'response-image',
        aiModel: 'Google:gemini-2.5-flash-image',
        isPartial: false,
        partialIndex: 0,
        width: '112px',
        alignment: 'right',
        textWrap: 'none',
        ...overrides,
    })
}

function makeVideoRef(overrides: Record<string, unknown> = {}): ProseMirrorNode {
    return schema.nodes.aiGeneratedVideo.create({
        videoUrl: '',
        fileId: 'video-file',
        workspaceId: 'workspace-video',
        posterUrl: '',
        posterFileId: 'poster-file',
        durationSeconds: 0,
        aspectRatio: 1.777,
        hasAudio: true,
        revisedPrompt: '',
        responseId: 'response-video',
        videoModel: 'OpenAI:o4-mini',
        isPending: false,
        errorMessage: '',
        width: '112px',
        alignment: 'right',
        textWrap: 'none',
        generationRequestId: '',
        reasoningRunId: '',
        mediaRunId: '',
        reasoningModelId: '',
        mediaModelId: '',
        mediaType: 'video',
        variantIndex: null,
        ...overrides,
    })
}

function makeThread(attrs: Record<string, unknown> = {}, children: ProseMirrorNode[] = []): ProseMirrorNode {
    return schema.nodes.aiChatThread.create({
        threadId: 'thread-1',
        aiModel: 'Anthropic:claude-sonnet-4-6',
        ...attrs,
    }, children)
}

// =============================================================================
// aiChatThreadPlugin — local media response templates
// =============================================================================

describe('aiChatThreadPlugin — local media response templates', () => {
    it('creates one assistant response with one reasoning section per selected reasoning model', async () => {
        const sendAiRequestHandler = vi.fn()
        const selectedReasoningModels = [
            'Anthropic:claude-sonnet-4-6',
            'Google:gemini-flash-latest',
        ]
        const imageModel = 'Google:gemini-2.5-flash-image'
        const plugin = createPlugin(sendAiRequestHandler)
        const initialState = EditorState.create({
            doc: doc(
                makeThread(
                    {
                        aiModel: selectedReasoningModels[0],
                        aiModels: JSON.stringify(selectedReasoningModels),
                        useMultipleReasoningModels: true,
                        aiImageModel: imageModel,
                        imageGenerationSize: 'auto',
                    },
                    [makeUserMessage('Swap the characters')]
                )
            ),
            schema,
            plugins: [plugin],
        })
        const threadPos = findNodePosition(initialState.doc, 'aiChatThread')
        expect(threadPos).not.toBeNull()

        const triggerTransaction = initialState.tr.setMeta(USE_AI_CHAT_META, {
            threadId: 'thread-1',
            nodePos: threadPos,
        })
        const { state: nextState } = initialState.applyTransaction(triggerTransaction)
        const responseNodes = collectNodes(nextState, 'aiResponseMessage')
        const sectionNodes = collectNodes(nextState, 'aiReasoningSection')

        expect(responseNodes).toHaveLength(1)
        expect(sectionNodes).toHaveLength(2)
        expect(responseNodes[0].attrs.isReceivingAnimation).toBe(true)
        expect(responseNodes[0].attrs.isInitialRenderAnimation).toBe(true)
        expect(responseNodes[0].attrs.generationRequestId).toBe('')
        expect(responseNodes[0].childCount).toBe(2)
        expect(sectionNodes.map((node) => node.attrs.reasoningModelId)).toEqual(selectedReasoningModels)
        expect(sectionNodes.map((node) => node.attrs.reasoningIndex)).toEqual([0, 1])
        expect(sectionNodes.every((node) => node.attrs.isReceivingAnimation)).toBe(true)

        await Promise.resolve()

        expect(sendAiRequestHandler).toHaveBeenCalledWith(expect.objectContaining({
            aiModel: selectedReasoningModels[0],
            aiModels: selectedReasoningModels,
            imageOptions: expect.objectContaining({
                aiImageModel: imageModel,
                aiImageModels: [],
                imageGenerationSize: 'auto',
            }),
            threadId: 'thread-1',
        }))
    })
})

// =============================================================================
// aiChatThreadPlugin — request payload construction
// =============================================================================

describe('aiChatThreadPlugin — request payload construction', () => {
    it('builds multimodal payload entries from image and video references', async () => {
        const sendAiRequestHandler = vi.fn()
        const plugin = createPlugin(sendAiRequestHandler)

        const userImage = makeImageRef({ fileId: 'image-file-1', workspaceId: 'workspace-1' })
        const responseVideo = makeVideoRef({ posterFileId: 'video-poster-1', workspaceId: 'workspace-video-1' })

        const userMessage = makeUserMessage('User message with image reference', [userImage])
        const responseParagraph = schema.nodes.paragraph.create(null, [schema.text('Assistant message with visual context')])
        const responseMessageWithFeature = schema.nodes.aiResponseMessage.create({}, [responseParagraph, responseVideo])

        const state = EditorState.create({
            doc: doc(
                makeThread(
                    { threadId: 'thread-featured', aiModel: 'Anthropic:claude-sonnet-4-6' },
                    [userMessage, responseMessageWithFeature]
                )
            ),
            schema,
            plugins: [plugin],
        })

        const threadPos = findNodePosition(state.doc, 'aiChatThread')
        expect(threadPos).not.toBeNull()

        const trigger = state.tr.setMeta(USE_AI_CHAT_META, {
            threadId: 'thread-featured',
            nodePos: threadPos,
        })
        state.applyTransaction(trigger)

        await Promise.resolve()

        const payload = sendAiRequestHandler.mock.calls.at(-1)?.[0]
        expect(payload).toBeTruthy()
        expect(payload.threadId).toBe('thread-featured')
        expect(payload.messages).toEqual([
                {
                    role: 'user',
                    content: [
                    { type: 'text', text: 'User message with image reference' },
                    { type: 'image_url', image_url: { url: 'nats-obj://workspace-workspace-1-files/image-file-1' } },
                ],
            },
            {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'Assistant message with visual context' },
                    { type: 'image_url', image_url: { url: 'nats-obj://workspace-workspace-video-1-files/video-poster-1' } },
                ],
            },
        ])
        expect(payload.referencedFeatureIds).toEqual([])
    })

    it('extracts and merges consecutive text-only messages while preserving text order', async () => {
        const sendAiRequestHandler = vi.fn()
        const plugin = createPlugin(sendAiRequestHandler)

        const state = EditorState.create({
            doc: doc(
                makeThread(
                    { threadId: 'thread-merge' },
                    [
                        makeUserMessage('First line'),
                        makeUserMessage('Second line'),
                    ]
                )
            ),
            schema,
            plugins: [plugin],
        })

        const trigger = state.tr.setMeta(USE_AI_CHAT_META, {
            threadId: 'thread-merge',
            nodePos: findNodePosition(state.doc, 'aiChatThread'),
        })
        state.applyTransaction(trigger)

        await Promise.resolve()

        const payload = sendAiRequestHandler.mock.calls.at(-1)?.[0]
        expect(payload.messages).toEqual([
            {
                role: 'user',
                content: 'First line\nSecond line',
            },
        ])
    })

    it('uses active thread scope by default even when other threads are present', async () => {
        const sendAiRequestHandler = vi.fn()
        const plugin = createPlugin(sendAiRequestHandler)

        const threadOne = makeThread(
            { threadId: 'thread-a', aiModel: 'Anthropic:claude-sonnet-4-6' },
            [makeUserMessage('Thread one prompt')]
        )
        const threadTwo = makeThread(
            { threadId: 'thread-b', aiModel: 'Anthropic:claude-sonnet-4-6' },
            [makeUserMessage('Thread two prompt')]
        )

        const state = EditorState.create({
            doc: doc(threadOne, threadTwo),
            schema,
            plugins: [plugin],
        })

        const threadPos = findNodePosition(state.doc, 'aiChatThread')
        expect(threadPos).not.toBeNull()

        const trigger = state.tr.setMeta(USE_AI_CHAT_META, {
            threadId: 'thread-a',
            nodePos: threadPos,
        })
        state.applyTransaction(trigger)

        await Promise.resolve()

        const payload = sendAiRequestHandler.mock.calls.at(-1)?.[0]
        expect(payload.threadId).toBe('thread-a')

        const content = payload.messages.map((message: any) => message.content)
        const joined = content.join('\n')
        expect(joined).toContain('Thread one prompt')
        expect(joined).not.toContain('Thread two prompt')
    })

    it('expands legacy multi-model settings into image/video request options', async () => {
        const sendAiRequestHandler = vi.fn()
        const plugin = createPlugin(sendAiRequestHandler)

        const state = EditorState.create({
            doc: doc(
                makeThread(
                    {
                        threadId: 'thread-legacy',
                        aiModel: 'Anthropic:claude-sonnet-4-6',
                        aiModels: JSON.stringify([
                            'Anthropic:claude-sonnet-4-6',
                            'OpenAI:gpt-4.1',
                        ]),
                        useMultipleModels: true,
                        aiImageModel: 'Google:gemini-2.5-flash-image',
                        aiImageModels: JSON.stringify([
                            'Google:gemini-2.5-flash-image',
                        ]),
                        aiVideoModel: 'OpenAI:o4-mini',
                        aiVideoModels: JSON.stringify([
                            'OpenAI:o4-mini',
                        ]),
                        imageGenerationSize: '1024x1024',
                        videoAspectRatio: '16:9',
                        videoResolution: '1080p',
                        videoDuration: '8',
                        sourceVideoNodeId: 'video-source-node',
                    },
                    [makeUserMessage('Legacy multi-model payload')]
                )
            ),
            schema,
            plugins: [plugin],
        })

        const trigger = state.tr.setMeta(USE_AI_CHAT_META, {
            threadId: 'thread-legacy',
            nodePos: findNodePosition(state.doc, 'aiChatThread'),
        })
        state.applyTransaction(trigger)

        await Promise.resolve()

        const payload = sendAiRequestHandler.mock.calls.at(-1)?.[0]
        expect(payload.aiModels).toEqual([
            'Anthropic:claude-sonnet-4-6',
            'OpenAI:gpt-4.1',
        ])
        expect(payload.imageOptions).toMatchObject({
            aiImageModel: 'Google:gemini-2.5-flash-image',
            aiImageModels: ['Google:gemini-2.5-flash-image'],
            imageGenerationSize: '1024x1024',
        })
        expect(payload.videoOptions).toMatchObject({
            aiVideoModel: 'OpenAI:o4-mini',
            aiVideoModels: ['OpenAI:o4-mini'],
            videoAspectRatio: '16:9',
            videoResolution: '1080p',
            videoDuration: '8',
            sourceVideoNodeId: 'video-source-node',
        })
    })

    it('dispatches stop request payload when STOP_AI_CHAT_META is present', () => {
        const stopAiRequestHandler = vi.fn()
        const plugin = createPlugin(vi.fn(), stopAiRequestHandler)

        const state = EditorState.create({
            doc: doc(
                makeThread(
                    { threadId: 'thread-stop', aiModel: 'Anthropic:claude-sonnet-4-6' },
                    [makeUserMessage('Stopping request')]
                )
            ),
            schema,
            plugins: [plugin],
        })

        const stopTransaction = state.tr.setMeta(STOP_AI_CHAT_META, {
            threadId: 'thread-stop',
        })
        state.applyTransaction(stopTransaction)

        expect(stopAiRequestHandler).toHaveBeenCalledTimes(1)
        expect(stopAiRequestHandler).toHaveBeenCalledWith({ threadId: 'thread-stop' })
    })

    it('prevents deleting the final child inside an aiChatThread', () => {
        const plugin = createPlugin()

        const thread = makeThread(
            { threadId: 'thread-delete', aiModel: 'Anthropic:claude-sonnet-4-6' },
            [makeUserMessage('Only message')]
        )
        const state = EditorState.create({
            doc: doc(thread),
            schema,
            plugins: [plugin],
        })

        const threadPos = findNodePosition(state.doc, 'aiChatThread')
        expect(threadPos).not.toBeNull()
        const threadNode = state.doc.nodeAt(threadPos!)
        expect(threadNode).not.toBeNull()
        const childPos = threadPos! + 1
        const deletePos = childPos + (threadNode!.child(0)!.nodeSize)

        const transaction = state.tr.delete(childPos, deletePos)
        const { state: appliedState } = state.applyTransaction(transaction)

        expect(appliedState.doc.eq(state.doc)).toBe(true)
    })
})
