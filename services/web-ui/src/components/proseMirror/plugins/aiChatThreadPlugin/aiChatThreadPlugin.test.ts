'use strict'

import { describe, expect, it, vi } from 'vitest'
import { afterEach, beforeEach } from 'vitest'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { AI_CHAT_THREAD_PLUGIN_KEY, STOP_AI_CHAT_META, USE_AI_CHAT_META } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPluginConstants.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import { createAiChatThreadPlugin } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPlugin.ts'
import {
    doc,
    createStateWithTextSelection,
    findNodePosition,
    schema,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'

vi.mock('prosemirror-transform', () => ({
    Step: {
        fromJSON: vi.fn(() => ({
            apply: vi.fn((doc: unknown) => ({
                doc,
                failed: null,
                maps: [],
            })),
        })),
    },
}))

function createPlugin(sendAiRequestHandler = vi.fn(), stopAiRequestHandler = vi.fn()) {
    return createAiChatThreadPlugin({
        sendAiRequestHandler,
        stopAiRequestHandler,
        placeholders: { titlePlaceholder: 'Title', paragraphPlaceholder: 'Type here' },
    })
}

let consoleWarnSpy: { mockRestore: () => void } | null = null
let consoleErrorSpy: { mockRestore: () => void } | null = null
beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
    consoleWarnSpy?.mockRestore()
    consoleWarnSpy = null
    consoleErrorSpy?.mockRestore()
    consoleErrorSpy = null
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

function makeParagraphMessage(
    nodeType: 'aiUserMessage' | 'aiResponseMessage',
    text: string,
    inlineChildren: ProseMirrorNode[] = [],
): ProseMirrorNode {
    const creator = nodeType === 'aiUserMessage'
        ? schema.nodes.aiUserMessage
        : schema.nodes.aiResponseMessage
    return creator.create({}, [
        schema.nodes.paragraph.create(null, [schema.text(text), ...inlineChildren]),
    ])
}

function makeThread(attrs: Record<string, unknown> = {}, children: ProseMirrorNode[] = []): ProseMirrorNode {
    return schema.nodes.aiChatThread.create({
        threadId: 'thread-1',
        aiReasoningModels: JSON.stringify(['Anthropic:claude-sonnet-4-6']),
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
                        aiReasoningModels: JSON.stringify(selectedReasoningModels),
                        useMultipleReasoningModels: true,
                        aiImageModels: JSON.stringify([imageModel]),
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
            aiReasoningModels: selectedReasoningModels,
            imageOptions: expect.objectContaining({
                aiImageModels: [imageModel],
                imageGenerationSize: 'auto',
            }),
            conversationAssetId: 'thread-1',
        }))
    })
})

// =============================================================================
// aiChatThreadPlugin — request payload construction
// =============================================================================

describe('aiChatThreadPlugin — request payload construction', () => {
    it('builds plain-text payload messages, resolving image/video references separately from the workspace context snapshot', async () => {
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
                    {
                        threadId: 'thread-featured',
                        aiReasoningModels: JSON.stringify(['Anthropic:claude-sonnet-4-6']),
                        // mediaGenerationMode defaults to 'image', which now requires at
                        // least one selected image model for handleChatRequest to submit.
                        aiImageModels: JSON.stringify(['Google:gemini-2.5-flash-image']),
                    },
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
        expect(payload.conversationAssetId).toBe('thread-featured')
        // toMessages emits plain-text content only; images/video posters are no
        // longer inlined as image_url parts here (see ContentExtractor.toMessages
        // comment) — they're resolved separately via the Asset-backed workspace
        // context snapshot instead.
        expect(payload.messages).toEqual([
            {
                role: 'user',
                content: 'User message with image reference',
            },
            {
                role: 'assistant',
                content: 'Assistant message with visual context',
            },
        ])
        expect(payload).not.toHaveProperty('capabilityReferences')
    })

    it('forwards valid image generation config groups to imageOptions', async () => {
        const sendAiRequestHandler = vi.fn()
        const plugin = createPlugin(sendAiRequestHandler)
        const reasoningGenerationConfigGroups = JSON.stringify([
            {
                groupId: 'reasoning-effort',
                modelIds: ['Anthropic:claude-sonnet-4-6'],
                values: { reasoningEffort: 'high' },
            },
        ])
        const imageGenerationConfigGroups = JSON.stringify([
            {
                groupId: 'image-quality',
                modelIds: ['Google:gemini-3.1-flash-image'],
                values: {
                    quality: 'high',
                    style: 'cinematic',
                },
            },
        ])

        const state = EditorState.create({
            doc: doc(
                makeThread(
                    {
                        threadId: 'thread-image-config',
                        aiReasoningModels: JSON.stringify(['Anthropic:claude-sonnet-4-6']),
                        reasoningGenerationConfigGroups,
                        useMultipleImageModels: true,
                        aiImageModels: JSON.stringify(['Google:gemini-3.1-flash-image']),
                        imageGenerationConfigGroups,
                    },
                    [makeUserMessage('Image config group test')]
                )
            ),
            schema,
            plugins: [plugin],
        })

        const trigger = state.tr.setMeta(USE_AI_CHAT_META, {
            threadId: 'thread-image-config',
            nodePos: findNodePosition(state.doc, 'aiChatThread'),
        })
        state.applyTransaction(trigger)

        await Promise.resolve()

        const payload = sendAiRequestHandler.mock.calls.at(-1)?.[0]
        expect(payload.reasoningOptions).toEqual({
            configGroups: [{
                groupId: 'reasoning-effort',
                modelIds: ['Anthropic:claude-sonnet-4-6'],
                values: { reasoningEffort: 'high' },
            }],
        })
        expect(payload.imageOptions).toMatchObject({
            configGroups: [
                {
                    groupId: 'image-quality',
                    modelIds: ['Google:gemini-3.1-flash-image'],
                    values: {
                        quality: 'high',
                        style: 'cinematic',
                    },
                },
            ],
        })
    })

    it('forwards valid video generation config groups to videoOptions', async () => {
        const sendAiRequestHandler = vi.fn()
        const plugin = createPlugin(sendAiRequestHandler)
        const videoGenerationConfigGroups = JSON.stringify([
            {
                groupId: 'video-options',
                modelIds: ['OpenAI:o4-mini'],
                values: {
                    style: 'cinematic',
                },
            },
        ])

        const state = EditorState.create({
            doc: doc(
                makeThread(
                    {
                        threadId: 'thread-video-config',
                        aiReasoningModels: JSON.stringify(['Anthropic:claude-sonnet-4-6']),
                        // videoModelIds is only populated when mediaGenerationMode is
                        // 'video' — it defaults to 'image' otherwise.
                        mediaGenerationMode: 'video',
                        useMultipleVideoModels: true,
                        aiVideoModels: JSON.stringify(['OpenAI:o4-mini']),
                        videoGenerationConfigGroups,
                        videoAspectRatio: '16:9',
                        videoResolution: '1080p',
                    },
                    [makeUserMessage('Video config group test')]
                )
            ),
            schema,
            plugins: [plugin],
        })

        const trigger = state.tr.setMeta(USE_AI_CHAT_META, {
            threadId: 'thread-video-config',
            nodePos: findNodePosition(state.doc, 'aiChatThread'),
        })
        state.applyTransaction(trigger)

        await Promise.resolve()

        const payload = sendAiRequestHandler.mock.calls.at(-1)?.[0]
        expect(payload.videoOptions).toMatchObject({
            configGroups: [
                {
                    groupId: 'video-options',
                    modelIds: ['OpenAI:o4-mini'],
                    values: {
                        style: 'cinematic',
                    },
                },
            ],
        })
    })

    it('extracts and merges consecutive text-only messages while preserving text order', async () => {
        const sendAiRequestHandler = vi.fn()
        const plugin = createPlugin(sendAiRequestHandler)

        const state = EditorState.create({
            doc: doc(
                makeThread(
                    {
                        threadId: 'thread-merge',
                        aiImageModels: JSON.stringify(['Google:gemini-2.5-flash-image']),
                    },
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
            {
                threadId: 'thread-a',
                aiReasoningModels: JSON.stringify(['Anthropic:claude-sonnet-4-6']),
                aiImageModels: JSON.stringify(['Google:gemini-2.5-flash-image']),
            },
            [makeUserMessage('Thread one prompt')]
        )
        const threadTwo = makeThread(
            { threadId: 'thread-b', aiReasoningModels: JSON.stringify(['Anthropic:claude-sonnet-4-6']) },
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
        expect(payload.conversationAssetId).toBe('thread-a')

        const content = payload.messages.map((message: any) => message.content)
        const joined = content.join('\n')
        expect(joined).toContain('Thread one prompt')
        expect(joined).not.toContain('Thread two prompt')
    })

    it('falls back to active-thread scope when thread context metadata is unavailable', async () => {
        const sendAiRequestHandler = vi.fn()
        const plugin = createPlugin(sendAiRequestHandler)

        let currentThreadPos: number | null = null

        const state = EditorState.create({
            doc: doc(
                makeThread(
                    {
                        threadId: 'thread-workspace',
                        aiReasoningModels: JSON.stringify(['Anthropic:claude-sonnet-4-6']),
                        threadContext: 'Workspace',
                        workspaceSelected: true,
                    },
                    [makeUserMessage('Workspace prompt')],
                ),
                makeThread(
                    {
                        threadId: 'thread-current',
                        aiReasoningModels: JSON.stringify(['Anthropic:claude-sonnet-4-6']),
                        aiImageModels: JSON.stringify(['Google:gemini-2.5-flash-image']),
                        threadContext: 'Workspace',
                        workspaceSelected: false,
                    },
                    [makeUserMessage('Current thread prompt')],
                ),
            ),
            schema,
            plugins: [plugin],
        })

        state.doc.descendants((node, pos) => {
            if (node.type.name === 'aiChatThread' && node.attrs.threadId === 'thread-current') {
                currentThreadPos = pos
                return false
            }
            return true
        })

        expect(currentThreadPos).not.toBeNull()

        const trigger = state.tr.setMeta(USE_AI_CHAT_META, {
            threadId: 'thread-current',
            nodePos: currentThreadPos,
        })
        state.applyTransaction(trigger)

        await Promise.resolve()

        const payload = sendAiRequestHandler.mock.calls.at(-1)?.[0]
        expect(payload).toBeTruthy()
        expect(payload.conversationAssetId).toBe('thread-current')
        expect(payload.messages).toHaveLength(1)

        const messageContent = payload.messages[0].content
        expect(typeof messageContent).toBe('string')
        expect(messageContent).toContain('Current thread prompt')
        expect(messageContent).not.toContain('Workspace prompt')
    })

    it('updates ai reasoning model dropdown selection into thread attrs', () => {
        const plugin = createPlugin(vi.fn())
        const state = EditorState.create({
            doc: doc(makeThread({
                threadId: 'thread-dropdown',
                aiReasoningModels: JSON.stringify(['Anthropic:claude-sonnet-4-6']),
            }, [makeUserMessage('dropdown selection')])),
            schema,
            plugins: [plugin],
        })

        const threadPos = findNodePosition(state.doc, 'aiChatThread')
        expect(threadPos).not.toBeNull()

        const transaction = state.tr.setMeta('dropdownOptionSelected', {
            dropdownId: 'ai-model-dropdown-thread',
            nodePos: threadPos! + 1,
            option: {
                provider: 'OpenAI',
                model: 'o4-mini',
            },
        })

        const { state: nextState } = state.applyTransaction(transaction)
        const nextThread = nextState.doc.nodeAt(threadPos!)

        expect(nextThread?.attrs.aiReasoningModels).toBe('["OpenAI:o4-mini"]')
        // The dropdown handler returns an appended doc-changing transaction; the
        // editor's own change pipeline (not an explicit document-store call) is
        // what now signals the document needs saving.
        expect(nextState.doc.eq(state.doc)).toBe(false)
    })

    it('ignores thread-context dropdown selection because threadContext is not a declared aiChatThread attr', () => {
        // aiChatThreadNodeSpec.attrs (packages/lixpi/prosemirror/src/shared/node-specs.ts)
        // no longer declares a `threadContext` attr, so ProseMirror's Node.create /
        // setNodeMarkup silently drop it from any attrs object passed in. The
        // 'thread-context-dropdown-' branch in appendTransaction still runs and
        // calls setNodeMarkup, but it can never change stored node attrs.
        const plugin = createPlugin(vi.fn())

        const state = EditorState.create({
            doc: doc(makeThread({
                threadId: 'thread-context',
            }, [makeUserMessage('thread context update')])),
            schema,
            plugins: [plugin],
        })

        const threadPos = findNodePosition(state.doc, 'aiChatThread')
        expect(threadPos).not.toBeNull()

        const transaction = state.tr.setMeta('dropdownOptionSelected', {
            dropdownId: 'thread-context-dropdown-thread',
            nodePos: threadPos! + 1,
            option: {
                value: 'Workspace',
            },
        })

        const { state: nextState } = state.applyTransaction(transaction)
        const nextThread = nextState.doc.nodeAt(threadPos!)

        expect(nextState.doc.eq(state.doc)).toBe(true)
        expect(nextThread?.attrs.threadContext).toBeUndefined()
    })

    it('resolves ai model dropdown titles through aiModelsStore and updates thread attrs', () => {
        const getDataSpy = vi.spyOn(aiModelsStore, 'getData').mockReturnValue([
            { provider: 'OpenAI', model: 'o4-mini', title: 'OpenAI o4-mini' },
        ] as any)

        const plugin = createPlugin(vi.fn())

        const state = EditorState.create({
            doc: doc(makeThread({
                threadId: 'thread-title-dropdown',
                aiReasoningModels: JSON.stringify(['Anthropic:claude-sonnet-4-6']),
            }, [makeUserMessage('model title dropdown')])),
            schema,
            plugins: [plugin],
        })

        const threadPos = findNodePosition(state.doc, 'aiChatThread')
        expect(threadPos).not.toBeNull()

        const transaction = state.tr.setMeta('dropdownOptionSelected', {
            dropdownId: 'ai-model-dropdown-thread-title-dropdown',
            nodePos: threadPos! + 1,
            option: {
                title: 'OpenAI o4-mini',
            },
        })

        const { state: nextState } = state.applyTransaction(transaction)
        const nextThread = nextState.doc.nodeAt(threadPos!)

        expect(getDataSpy).toHaveBeenCalled()
        expect(nextThread?.attrs.aiReasoningModels).toBe(JSON.stringify(['OpenAI:o4-mini']))

        getDataSpy.mockRestore()
    })

    it('does not append a transaction when AI model dropdown selection is unchanged', () => {
        const plugin = createPlugin(vi.fn())

        const state = EditorState.create({
            doc: doc(makeThread({
                threadId: 'thread-dropdown-no-change',
                aiReasoningModels: JSON.stringify(['OpenAI:o4-mini']),
            }, [makeUserMessage('dropdown unchanged')])),
            schema,
            plugins: [plugin],
        })

        const threadPos = findNodePosition(state.doc, 'aiChatThread')
        expect(threadPos).not.toBeNull()

        const transaction = state.tr.setMeta('dropdownOptionSelected', {
            dropdownId: 'ai-model-dropdown-thread-dropdown-no-change',
            nodePos: threadPos! + 1,
            option: {
                provider: 'OpenAI',
                model: 'o4-mini',
            },
        })

        const { state: nextState } = state.applyTransaction(transaction)
        expect(nextState.doc.eq(state.doc)).toBe(true)
        expect(AI_CHAT_THREAD_PLUGIN_KEY.getState(nextState)?.receivingThreadIds.size).toBe(0)
    })

    it('parses string-based boolean toggles for multi-model settings (image mode)', async () => {
        const sendAiRequestHandler = vi.fn()
        const plugin = createPlugin(sendAiRequestHandler)

        const state = EditorState.create({
            doc: doc(
                makeThread(
                    {
                        threadId: 'thread-string-flags',
                        aiReasoningModels: JSON.stringify([
                            'Anthropic:claude-sonnet-4-6',
                        ]),
                        useMultipleReasoningModels: 'true',
                        useMultipleImageModels: 'true',
                        aiImageModels: JSON.stringify([
                            'Google:gemini-2.5-flash-image',
                            'OpenAI:o4-mini',
                        ]),
                    },
                    [makeUserMessage('String flag parsing')]
                )
            ),
            schema,
            plugins: [plugin],
        })

        const trigger = state.tr.setMeta(USE_AI_CHAT_META, {
            threadId: 'thread-string-flags',
            nodePos: findNodePosition(state.doc, 'aiChatThread'),
        })
        state.applyTransaction(trigger)

        await Promise.resolve()

        const payload = sendAiRequestHandler.mock.calls.at(-1)?.[0]
        expect(payload.useMultipleReasoningModels).toBe(true)
        expect(payload.useMultipleImageModels).toBe(true)
        expect(payload.imageOptions).toMatchObject({
            aiImageModels: ['Google:gemini-2.5-flash-image', 'OpenAI:o4-mini'],
            imageGenerationSize: 'auto',
        })
    })

    it('parses string-based boolean toggles for multi-model settings (video mode) and collapses to the first model when disabled', async () => {
        const sendAiRequestHandler = vi.fn()
        const plugin = createPlugin(sendAiRequestHandler)

        const state = EditorState.create({
            doc: doc(
                makeThread(
                    {
                        threadId: 'thread-string-flags-video',
                        aiReasoningModels: JSON.stringify([
                            'Anthropic:claude-sonnet-4-6',
                        ]),
                        // videoModelIds is only populated when mediaGenerationMode is
                        // explicitly 'video'.
                        mediaGenerationMode: 'video',
                        useMultipleVideoModels: 'false',
                        aiVideoModels: JSON.stringify([
                            'Anthropic:claude-4',
                            'OpenAI:o4-mini',
                        ]),
                    },
                    [makeUserMessage('String flag parsing')]
                )
            ),
            schema,
            plugins: [plugin],
        })

        const trigger = state.tr.setMeta(USE_AI_CHAT_META, {
            threadId: 'thread-string-flags-video',
            nodePos: findNodePosition(state.doc, 'aiChatThread'),
        })
        state.applyTransaction(trigger)

        await Promise.resolve()

        const payload = sendAiRequestHandler.mock.calls.at(-1)?.[0]
        expect(payload.useMultipleVideoModels).toBe(false)
        expect(payload.videoOptions?.aiVideoModels).toEqual(['Anthropic:claude-4'])
    })

    it('calls onReceivingStateChange only on actual receiving state transitions', () => {
        const onReceivingStateChange = vi.fn()
        const plugin = createAiChatThreadPlugin({
            sendAiRequestHandler: vi.fn(),
            stopAiRequestHandler: vi.fn(),
            placeholders: {
                titlePlaceholder: 'Title',
                paragraphPlaceholder: 'Type here',
            },
            onReceivingStateChange,
        })

        const state = EditorState.create({
            doc: doc(makeThread({
                threadId: 'thread-receiving',
            }, [makeUserMessage('receiving state')])),
            schema,
            plugins: [plugin],
        })

        const runOne = state.tr.setMeta('setReceiving', {
            threadId: 'thread-receiving',
            receiving: true,
            runKey: 'run-1',
        })
        const { state: afterRunOne } = state.applyTransaction(runOne)
        expect(onReceivingStateChange).toHaveBeenCalledTimes(1)
        expect(onReceivingStateChange).toHaveBeenCalledWith('thread-receiving', true)
        expect(AI_CHAT_THREAD_PLUGIN_KEY.getState(afterRunOne)?.receivingThreadIds.has('thread-receiving')).toBe(true)

        const runTwo = afterRunOne.tr.setMeta('setReceiving', {
            threadId: 'thread-receiving',
            receiving: true,
            runKey: 'run-2',
        })
        const { state: afterRunTwo } = afterRunOne.applyTransaction(runTwo)
        expect(onReceivingStateChange).toHaveBeenCalledTimes(1)
        expect(AI_CHAT_THREAD_PLUGIN_KEY.getState(afterRunTwo)?.receivingThreadIds.has('thread-receiving')).toBe(true)

        const runTwoStop = afterRunTwo.tr.setMeta('setReceiving', {
            threadId: 'thread-receiving',
            receiving: false,
            runKey: 'run-2',
        })
        const { state: afterRunTwoStop } = afterRunTwo.applyTransaction(runTwoStop)
        expect(onReceivingStateChange).toHaveBeenCalledTimes(1)
        expect(AI_CHAT_THREAD_PLUGIN_KEY.getState(afterRunTwoStop)?.receivingThreadIds.has('thread-receiving')).toBe(true)

        const runOneStop = afterRunTwoStop.tr.setMeta('setReceiving', {
            threadId: 'thread-receiving',
            receiving: false,
            runKey: 'run-1',
        })
        const { state: afterAllStop } = afterRunTwoStop.applyTransaction(runOneStop)

        expect(onReceivingStateChange).toHaveBeenCalledTimes(2)
        expect(onReceivingStateChange).toHaveBeenLastCalledWith('thread-receiving', false)
        expect(AI_CHAT_THREAD_PLUGIN_KEY.getState(afterAllStop)?.receivingThreadIds.has('thread-receiving')).toBe(false)
    })

    it('blocks paste inside an aiChatThread and allows it outside', () => {
        const plugin = createPlugin(vi.fn())

        const state = EditorState.create({
            doc: doc(makeThread({
                threadId: 'thread-paste',
            }, [makeUserMessage('paste test')])),
            schema,
            plugins: [plugin],
        })

        const threadPos = findNodePosition(state.doc, 'aiChatThread')
        const stateInsideThread = createStateWithTextSelection(state.doc, threadPos! + 1, threadPos! + 1)

        const handlePaste = plugin.spec.props.handlePaste
        expect(handlePaste).toBeDefined()

        const insidePaste = handlePaste!({ state: stateInsideThread } as any, {} as ClipboardEvent, null as any)
        const outsidePaste = handlePaste!({
            state: createStateWithTextSelection(state.doc, state.doc.content.size, state.doc.content.size),
        } as any, {} as ClipboardEvent, null as any)

        expect(insidePaste).toBe(true)
        expect(outsidePaste).toBe(false)
    })

    it('passes section multi-model settings into image request options (image mode)', async () => {
        const sendAiRequestHandler = vi.fn()
        const plugin = createPlugin(sendAiRequestHandler)

        const state = EditorState.create({
            doc: doc(
                makeThread(
                    {
                        threadId: 'thread-legacy-image',
                        aiReasoningModels: JSON.stringify([
                            'Anthropic:claude-sonnet-4-6',
                            'OpenAI:gpt-4.1',
                        ]),
                        useMultipleReasoningModels: true,
                        useMultipleImageModels: true,
                        aiImageModels: JSON.stringify([
                            'Google:gemini-2.5-flash-image',
                        ]),
                        imageGenerationSize: '1024x1024',
                    },
                    [makeUserMessage('Legacy multi-model payload')]
                )
            ),
            schema,
            plugins: [plugin],
        })

        const trigger = state.tr.setMeta(USE_AI_CHAT_META, {
            threadId: 'thread-legacy-image',
            nodePos: findNodePosition(state.doc, 'aiChatThread'),
        })
        state.applyTransaction(trigger)

        await Promise.resolve()

        const payload = sendAiRequestHandler.mock.calls.at(-1)?.[0]
        expect(payload.aiReasoningModels).toEqual([
            'Anthropic:claude-sonnet-4-6',
            'OpenAI:gpt-4.1',
        ])
        expect(payload.imageOptions).toMatchObject({
            aiImageModels: ['Google:gemini-2.5-flash-image'],
            imageGenerationSize: '1024x1024',
        })
        expect(payload.videoOptions).toBeUndefined()
    })

    it('passes section multi-model settings into video request options (video mode)', async () => {
        const sendAiRequestHandler = vi.fn()
        const plugin = createPlugin(sendAiRequestHandler)

        const state = EditorState.create({
            doc: doc(
                makeThread(
                    {
                        threadId: 'thread-legacy-video',
                        aiReasoningModels: JSON.stringify([
                            'Anthropic:claude-sonnet-4-6',
                            'OpenAI:gpt-4.1',
                        ]),
                        useMultipleReasoningModels: true,
                        mediaGenerationMode: 'video',
                        useMultipleVideoModels: true,
                        aiVideoModels: JSON.stringify([
                            'OpenAI:o4-mini',
                        ]),
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
            threadId: 'thread-legacy-video',
            nodePos: findNodePosition(state.doc, 'aiChatThread'),
        })
        state.applyTransaction(trigger)

        await Promise.resolve()

        const payload = sendAiRequestHandler.mock.calls.at(-1)?.[0]
        expect(payload.aiReasoningModels).toEqual([
            'Anthropic:claude-sonnet-4-6',
            'OpenAI:gpt-4.1',
        ])
        expect(payload.imageOptions).toBeUndefined()
        expect(payload.videoOptions).toMatchObject({
            aiVideoModels: ['OpenAI:o4-mini'],
            videoAspectRatio: '16:9',
            videoResolution: '1080p',
            videoDuration: '8',
            sourceVideoNodeId: 'video-source-node',
        })
    })

    it('rejects image multi-model payloads with invalid JSON and logs a validation error', async () => {
        const sendAiRequestHandler = vi.fn()
        const plugin = createPlugin(sendAiRequestHandler)

        const state = EditorState.create({
            doc: doc(
                makeThread(
                    {
                        threadId: 'thread-invalid-image-models',
                        aiReasoningModels: JSON.stringify(['Anthropic:claude-sonnet-4-6']),
                        useMultipleImageModels: true,
                        aiImageModels: 'not-json',
                    },
                    [makeUserMessage('Image model payload validation')]
                )
            ),
            schema,
            plugins: [plugin],
        })

        const trigger = state.tr.setMeta(USE_AI_CHAT_META, {
            threadId: 'thread-invalid-image-models',
            nodePos: findNodePosition(state.doc, 'aiChatThread'),
        })
        state.applyTransaction(trigger)

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            '[AI_CHAT_THREAD] Image generation requires at least one image model.'
        )
        expect(sendAiRequestHandler).not.toHaveBeenCalled()
    })

    it('collapses a multi-entry image list to the first model when image multi-mode is disabled', async () => {
        const sendAiRequestHandler = vi.fn()
        const plugin = createPlugin(sendAiRequestHandler)

        const state = EditorState.create({
            doc: doc(
                makeThread(
                    {
                        threadId: 'thread-single-image-collapse',
                        aiReasoningModels: JSON.stringify(['Anthropic:claude-sonnet-4-6']),
                        aiImageModels: JSON.stringify([
                            'Google:gemini-2.5-flash-image',
                            'OpenAI:gpt-image-1',
                        ]),
                    },
                    [makeUserMessage('Single-image-model collapse')]
                )
            ),
            schema,
            plugins: [plugin],
        })

        const trigger = state.tr.setMeta(USE_AI_CHAT_META, {
            threadId: 'thread-single-image-collapse',
            nodePos: findNodePosition(state.doc, 'aiChatThread'),
        })
        state.applyTransaction(trigger)

        await Promise.resolve()

        const payload = sendAiRequestHandler.mock.calls.at(-1)?.[0]
        expect(payload.imageOptions).toMatchObject({
            aiImageModels: ['Google:gemini-2.5-flash-image'],
        })
    })

    it('rejects video multi-model payloads with invalid JSON and logs a validation error', async () => {
        const sendAiRequestHandler = vi.fn()
        const plugin = createPlugin(sendAiRequestHandler)

        const state = EditorState.create({
            doc: doc(
                makeThread(
                    {
                        threadId: 'thread-invalid-video-models',
                        aiReasoningModels: JSON.stringify(['Anthropic:claude-sonnet-4-6']),
                        mediaGenerationMode: 'video',
                        useMultipleVideoModels: true,
                        aiVideoModels: 'not-json',
                    },
                    [makeUserMessage('Video model payload validation')]
                )
            ),
            schema,
            plugins: [plugin],
        })

        const trigger = state.tr.setMeta(USE_AI_CHAT_META, {
            threadId: 'thread-invalid-video-models',
            nodePos: findNodePosition(state.doc, 'aiChatThread'),
        })
        state.applyTransaction(trigger)

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            '[AI_CHAT_THREAD] Video generation requires at least one video model.'
        )
        expect(sendAiRequestHandler).not.toHaveBeenCalled()
    })

    it('dispatches stop request payload when STOP_AI_CHAT_META is present', () => {
        const stopAiRequestHandler = vi.fn()
        const plugin = createPlugin(vi.fn(), stopAiRequestHandler)

        const state = EditorState.create({
            doc: doc(
                makeThread(
                    { threadId: 'thread-stop', aiReasoningModels: JSON.stringify(['Anthropic:claude-sonnet-4-6']) },
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
        expect(stopAiRequestHandler).toHaveBeenCalledWith({ conversationAssetId: 'thread-stop' })
    })

    it('prevents deleting the final child inside an aiChatThread', () => {
        const plugin = createPlugin()

        const thread = makeThread(
            { threadId: 'thread-delete', aiReasoningModels: JSON.stringify(['Anthropic:claude-sonnet-4-6']) },
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
