'use strict'

import { describe, it, expect, beforeEach } from 'vitest'
import { testSchema } from '$src/components/proseMirror/plugins/testUtils/testSchema.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'

describe('testSchema — shared node coverage', () => {
    beforeEach(() => {
        aiModelsStore.setAiModels([])
    })

    it('registers chat, prompt, and generated-media nodes', () => {
        expect(testSchema.nodes.aiChatThread).toBeDefined()
        expect(testSchema.nodes.aiResponseMessage).toBeDefined()
        expect(testSchema.nodes.aiPromptInput).toBeDefined()
        expect(testSchema.nodes.aiGeneratedImage).toBeDefined()
        expect(testSchema.nodes.aiGeneratedVideo).toBeDefined()
        expect(testSchema.nodes.aiReasoningSection).toBeDefined()
    })

    it('supports building nodes used by chat and prompt tests', () => {
        const promptNode = testSchema.nodes.aiPromptInput.createAndFill()
        const imageNode = testSchema.nodes.aiGeneratedImage.createAndFill()
        const videoNode = testSchema.nodes.aiGeneratedVideo.createAndFill()
        const threadNode = testSchema.nodes.aiChatThread.createAndFill({ threadId: 'thread-1' })

        const doc = testSchema.nodes.doc.create(null, [promptNode, threadNode, imageNode, videoNode])
        expect(testSchema.nodeFromJSON(doc.toJSON()).eq(doc)).toBe(true)
    })
})
