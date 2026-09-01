'use strict'

import {
    describe,
    it,
    expect,
    beforeEach,
} from 'vitest'
import { type Node as ProseMirrorNode } from 'prosemirror-model'
import { marks } from '$src/components/proseMirror/components/schema.ts'
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
        expect(testSchema.nodes.prompt_reference).toBeDefined()
    })

    it('reuses marks from the shared proseMirror schema', () => {
        const sharedMarkNames = Object.keys(marks)
        for (const markName of sharedMarkNames) {
            expect(testSchema.marks[markName]).toBeDefined()
        }
    })

    it('supports a valid mixed document containing block nodes and aiChatThread', () => {
        const promptNode = testSchema.nodes.aiPromptInput.createAndFill()
        const responseNode = testSchema.nodes.aiResponseMessage.createAndFill()
        const imageNode = testSchema.nodes.aiGeneratedImage.createAndFill()
        const videoNode = testSchema.nodes.aiGeneratedVideo.createAndFill()
        const threadNode = testSchema.nodes.aiChatThread.createAndFill({ threadId: 'thread-1' })

        const doc = testSchema.nodes.doc.create(null, [
            promptNode,
            threadNode,
            responseNode,
            imageNode,
            videoNode,
        ])

        expect(doc.childCount).toBe(5)
        expect(testSchema.nodeFromJSON(doc.toJSON()).eq(doc)).toBe(true)
    })

    it('keeps top-level inline content as inline text nodes', () => {
        const inlineTextNode = testSchema.text('inline node') as ProseMirrorNode
        const paragraphDoc = testSchema.nodes.doc.create(null, [inlineTextNode])
        expect(paragraphDoc.childCount).toBe(1)
        expect(paragraphDoc.child(0).type.name).toBe('text')
        expect(paragraphDoc.child(0).textContent).toBe('inline node')

        const paragraphNode = testSchema.nodes.doc.create(null, [
            testSchema.nodes.paragraph.create(null, [testSchema.text('Hello world')]),
        ])
        expect(paragraphNode.childCount).toBe(1)
    })

    it('builds generated media with schema default attrs', () => {
        const imageNode = testSchema.nodes.aiGeneratedImage.createAndFill()
        const videoNode = testSchema.nodes.aiGeneratedVideo.createAndFill()

        expect(imageNode).not.toBeNull()
        expect(imageNode?.attrs.responseId).toBe('')
        expect(imageNode?.attrs.isPartial).toBe(true)

        expect(videoNode).not.toBeNull()
        expect(videoNode?.attrs.responseId).toBe('')
        expect(videoNode?.attrs.isPending).toBe(true)
        expect(videoNode?.attrs.mediaType).toBe('')
    })

    it('keeps aiReasoningSection defaults stable for downstream parser assumptions', () => {
        const reasoningSection = testSchema.nodes.aiReasoningSection.createAndFill()
        expect(reasoningSection).not.toBeNull()

        if (reasoningSection) {
            expect(reasoningSection.attrs.reasoningIndex).toBeNull()
            expect(reasoningSection.attrs.lineageProjectionScope).toBe('conversation')
        }
    })
})
