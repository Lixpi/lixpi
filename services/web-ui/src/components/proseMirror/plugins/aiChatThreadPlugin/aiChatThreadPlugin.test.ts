'use strict'

import { EditorState } from 'prosemirror-state'
import { describe, expect, it, vi } from 'vitest'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { USE_AI_CHAT_META } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPluginConstants.ts'
import { createAiChatThreadPlugin } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPlugin.ts'
import {
    doc,
    findNodePosition,
    p,
    schema,
    thread,
    userMsg,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'

function collectNodes(state: EditorState, nodeType: string): ProseMirrorNode[] {
    const nodes: ProseMirrorNode[] = []
    state.doc.descendants((node) => {
        if (node.type.name === nodeType) nodes.push(node)
    })
    return nodes
}

function createPlugin(sendAiRequestHandler = vi.fn()) {
    return createAiChatThreadPlugin({
        sendAiRequestHandler,
        stopAiRequestHandler: vi.fn(),
        placeholders: { titlePlaceholder: 'Title', paragraphPlaceholder: 'Type here' },
    })
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
                thread(
                    {
                        threadId: 'thread-1',
                        aiModel: selectedReasoningModels[0],
                        aiModels: JSON.stringify(selectedReasoningModels),
                        useMultipleReasoningModels: true,
                        aiImageModel: imageModel,
                        imageGenerationSize: 'auto',
                    },
                    userMsg(p('Swap the characters'))
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

        await new Promise<void>((resolve) => queueMicrotask(resolve))

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
