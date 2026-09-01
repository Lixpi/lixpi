import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror/shared/thread-doc'
import {
    buildCanvasConversationContent,
    contentJSONHasPromptReference,
    extractPromptTextFromContentJSON,
    getPromptReferenceCanvasNodeIds,
    getLatestUserPromptReferenceCanvasNodeIds,
    getLatestUserPromptText,
    type AiPromptComposerSubmitData,
} from './canvas-conversation-content.ts'

const identity = { threadId: 'thread', messageId: 'message', createdAt: 42, referenceNodeIds: ['reference'] }
const paragraph = (text: string): ProseMirrorJsonNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const mediaReference: ProseMirrorJsonNode = { type: 'prompt_reference', attrs: { referenceType: 'media', assetId: 'asset', nodeId: 'node', mediaKind: 'image', displayName: 'Frame' } }
const input = (): AiPromptComposerSubmitData => ({ contentJSON: [paragraph('Generate a frame')], mediaGenerationMode: 'image', aiReasoningModels: ['test:reasoner-a', 'test:reasoner-b'], useMultipleReasoningModels: false, useMultipleImageModels: false, useMultipleVideoModels: false, capabilityInputs: {} })

describe('canvas conversation content', () => {
    it('keeps persisted identity and omits absent configuration fields without adding defaults', () => {
        const data = input()
        const doc = buildCanvasConversationContent(data, identity)
        const thread = doc.content![0]
        expect(thread.attrs).toEqual({ threadId: 'thread', mediaGenerationMode: 'image', aiReasoningModels: '["test:reasoner-a"]', useMultipleReasoningModels: false, useMultipleImageModels: false, useMultipleVideoModels: false, capabilityInputs: '' })
        expect(thread.content![0]).toEqual({ type: 'aiUserMessage', attrs: { id: 'message', createdAt: 42, referenceNodeIds: ['reference'] }, content: data.contentJSON })
        expect(doc.type).toBe('doc')
    })

    it('retains only the first model on each single-selection axis without mutating the input', () => {
        const data = { ...input(), imageOptions: { aiImageModels: ['test:image-a', 'test:image-b'], imageGenerationSize: 'square' }, videoOptions: { aiVideoModels: ['test:video-a', 'test:video-b'], videoDuration: '8' } }
        const snapshot = structuredClone(data)
        const attrs = buildCanvasConversationContent(data, identity).content![0].attrs!
        expect(JSON.parse(attrs.aiImageModels)).toEqual(['test:image-a'])
        expect(JSON.parse(attrs.aiVideoModels)).toEqual(['test:video-a'])
        expect(data).toEqual(snapshot)
    })

    it('preserves multiple selections, configuration groups and Capability inputs in the persisted format', () => {
        const data: AiPromptComposerSubmitData = {
            ...input(),
            useMultipleReasoningModels: true,
            useMultipleImageModels: true,
            useMultipleVideoModels: true,
            mediaGenerationMode: 'video',
            reasoningOptions: { configGroups: [{ groupId: 'reasoning', modelIds: ['test:reasoner-a'], values: {} }] },
            imageOptions: { aiImageModels: ['test:image-a', 'test:image-b'], imageGenerationSize: 'square', configGroups: [{ groupId: 'images', modelIds: ['test:image-a'], values: {} }] },
            videoOptions: { aiVideoModels: ['test:video-a', 'test:video-b'], videoAspectRatio: 'wide', videoResolution: 'hd', videoDuration: '8', configGroups: [{ groupId: 'videos', modelIds: ['test:video-a'], values: {} }] },
            capabilityInputs: { 'test-module': { prompt: 'input', enabled: true } },
        }
        const attrs = buildCanvasConversationContent(data, identity).content![0].attrs!
        expect(JSON.parse(attrs.aiReasoningModels)).toEqual(data.aiReasoningModels)
        expect(JSON.parse(attrs.aiImageModels)).toEqual(data.imageOptions!.aiImageModels)
        expect(JSON.parse(attrs.aiVideoModels)).toEqual(data.videoOptions!.aiVideoModels)
        expect(JSON.parse(attrs.reasoningGenerationConfigGroups)).toEqual(data.reasoningOptions!.configGroups)
        expect(JSON.parse(attrs.imageGenerationConfigGroups)).toEqual(data.imageOptions!.configGroups)
        expect(JSON.parse(attrs.videoGenerationConfigGroups)).toEqual(data.videoOptions!.configGroups)
        expect(JSON.parse(attrs.capabilityInputs)).toEqual(data.capabilityInputs)
        expect(attrs).toMatchObject({ mediaGenerationMode: 'video', imageGenerationSize: 'square', videoAspectRatio: 'wide', videoResolution: 'hd', videoDuration: '8' })
    })

    it('provides one empty paragraph for an empty submitted document', () => {
        const doc = buildCanvasConversationContent({ ...input(), contentJSON: [] }, identity)
        expect(doc.content![0].content![0].content).toEqual([{ type: 'paragraph' }])
    })

    it('preserves visible reference labels and their order while deduplicating only canvas node IDs', () => {
        const content = [{ type: 'paragraph', content: [{ type: 'text', text: 'Use ' }, mediaReference, { type: 'text', text: ' and ' }, mediaReference, { type: 'hard_break' }, { type: 'text', text: 'again' }] }]
        expect(extractPromptTextFromContentJSON(content)).toBe('Use Frame and Frame\nagain')
        expect(getPromptReferenceCanvasNodeIds(content)).toEqual(['node'])
        expect(contentJSONHasPromptReference(content)).toBe(true)
    })

    it('recognizes a reference-only request even when its display label is absent', () => {
        const reference = { type: 'prompt_reference' }
        expect(contentJSONHasPromptReference([reference])).toBe(true)
        expect(extractPromptTextFromContentJSON([reference])).toBe('')
        expect(contentJSONHasPromptReference([paragraph('text only')])).toBe(false)
    })

    it('reads only the latest user prompt from the requested conversation', () => {
        const doc: ProseMirrorJsonNode = {
            type: 'doc',
            content: [{
                type: 'aiChatThread',
                attrs: { threadId: 'thread' },
                content: [
                    { type: 'aiUserMessage', content: [paragraph('old prompt')] },
                    { type: 'aiResponseMessage', content: [paragraph('old response')] },
                    { type: 'aiUserMessage', content: [{ type: 'paragraph', content: [mediaReference] }] },
                    { type: 'aiResponseMessage', content: [paragraph('response is not the prompt')] },
                ],
            }],
        }
        expect(getLatestUserPromptText(doc, 'thread')).toBe('Frame')
        expect(getLatestUserPromptReferenceCanvasNodeIds(doc, 'thread')).toEqual(['node'])
    })

    it('handles missing and malformed content without inventing references', () => {
        for (const content of [undefined, null, 123, '{invalid']) {
            expect(contentJSONHasPromptReference(content)).toBe(false)
            expect(getPromptReferenceCanvasNodeIds(content)).toEqual([])
            expect(getLatestUserPromptText(content, 'thread')).toBe('')
            expect(getLatestUserPromptReferenceCanvasNodeIds(content, 'thread')).toEqual([])
        }
    })
})
