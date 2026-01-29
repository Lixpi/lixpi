import { describe, it, expect } from 'vitest'
import { NodeSelection } from 'prosemirror-state'
import {
    doc,
    aiImg,
    createStateWithNodeSelection,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'

// =============================================================================
// AI-GENERATED IMAGE SPECIFIC TESTS
// These test attributes unique to aiGeneratedImage that don't exist on image
// =============================================================================

describe('aiGeneratedImage AI-specific attributes', () => {
    describe('revisedPrompt attribute', () => {
        it('stores revisedPrompt from AI response', () => {
            const imageNode = aiImg({
                imageData: 'data:image/png;base64,abc',
                revisedPrompt: 'A beautiful sunset over the ocean with vibrant colors',
            })
            const state = createStateWithNodeSelection(doc(imageNode), 0)
            const selection = state.selection as NodeSelection

            expect(selection.node.attrs.revisedPrompt).toBe(
                'A beautiful sunset over the ocean with vibrant colors'
            )
        })

        it('defaults to empty string when not provided', () => {
            const imageNode = aiImg({ imageData: 'data:image/png;base64,abc' })
            const state = createStateWithNodeSelection(doc(imageNode), 0)
            const selection = state.selection as NodeSelection

            expect(selection.node.attrs.revisedPrompt).toBe('')
        })
    })

    describe('responseId attribute', () => {
        it('stores responseId for tracking', () => {
            const imageNode = aiImg({
                imageData: 'data:image/png;base64,abc',
                responseId: 'resp_abc123xyz',
            })
            const state = createStateWithNodeSelection(doc(imageNode), 0)
            const selection = state.selection as NodeSelection

            expect(selection.node.attrs.responseId).toBe('resp_abc123xyz')
        })

        it('defaults to empty string when not provided', () => {
            const imageNode = aiImg({ imageData: 'data:image/png;base64,abc' })
            const state = createStateWithNodeSelection(doc(imageNode), 0)
            const selection = state.selection as NodeSelection

            expect(selection.node.attrs.responseId).toBe('')
        })
    })

    describe('aiModel attribute', () => {
        it('stores the AI model used for generation', () => {
            const imageNode = aiImg({
                imageData: 'data:image/png;base64,abc',
                aiModel: 'dall-e-3',
            })
            const state = createStateWithNodeSelection(doc(imageNode), 0)
            const selection = state.selection as NodeSelection

            expect(selection.node.attrs.aiModel).toBe('dall-e-3')
        })

        it('defaults to empty string when not provided', () => {
            const imageNode = aiImg({ imageData: 'data:image/png;base64,abc' })
            const state = createStateWithNodeSelection(doc(imageNode), 0)
            const selection = state.selection as NodeSelection

            expect(selection.node.attrs.aiModel).toBe('')
        })
    })

    describe('isPartial attribute', () => {
        it('is true during streaming', () => {
            const imageNode = aiImg({
                imageData: 'data:image/png;base64,partial',
                isPartial: true,
            })
            const state = createStateWithNodeSelection(doc(imageNode), 0)
            const selection = state.selection as NodeSelection

            expect(selection.node.attrs.isPartial).toBe(true)
        })

        it('is false when image is complete', () => {
            const imageNode = aiImg({
                imageData: 'data:image/png;base64,complete',
                isPartial: false,
            })
            const state = createStateWithNodeSelection(doc(imageNode), 0)
            const selection = state.selection as NodeSelection

            expect(selection.node.attrs.isPartial).toBe(false)
        })

        it('defaults to true (streaming state)', () => {
            const imageNode = aiImg({ imageData: 'data:image/png;base64,abc' })
            const state = createStateWithNodeSelection(doc(imageNode), 0)
            const selection = state.selection as NodeSelection

            expect(selection.node.attrs.isPartial).toBe(true)
        })
    })

    describe('partialIndex attribute', () => {
        it('tracks streaming chunk index', () => {
            const imageNode = aiImg({
                imageData: 'data:image/png;base64,abc',
                partialIndex: 5,
            })
            const state = createStateWithNodeSelection(doc(imageNode), 0)
            const selection = state.selection as NodeSelection

            expect(selection.node.attrs.partialIndex).toBe(5)
        })

        it('defaults to 0', () => {
            const imageNode = aiImg({ imageData: 'data:image/png;base64,abc' })
            const state = createStateWithNodeSelection(doc(imageNode), 0)
            const selection = state.selection as NodeSelection

            expect(selection.node.attrs.partialIndex).toBe(0)
        })
    })

    describe('fileId attribute', () => {
        it('stores fileId after image is saved', () => {
            const imageNode = aiImg({
                imageData: 'data:image/png;base64,abc',
                fileId: 'file_xyz789',
            })
            const state = createStateWithNodeSelection(doc(imageNode), 0)
            const selection = state.selection as NodeSelection

            expect(selection.node.attrs.fileId).toBe('file_xyz789')
        })

        it('defaults to empty string before save', () => {
            const imageNode = aiImg({ imageData: 'data:image/png;base64,abc' })
            const state = createStateWithNodeSelection(doc(imageNode), 0)
            const selection = state.selection as NodeSelection

            expect(selection.node.attrs.fileId).toBe('')
        })
    })
})

// =============================================================================
// AI-GENERATED IMAGE NODE TYPE TESTS
// =============================================================================

describe('aiGeneratedImage node type', () => {
    it('has correct node type name', () => {
        const imageNode = aiImg({ imageData: 'data:image/png;base64,abc' })
        const state = createStateWithNodeSelection(doc(imageNode), 0)
        const selection = state.selection as NodeSelection

        expect(selection.node.type.name).toBe('aiGeneratedImage')
    })

    it('is an atom (non-editable content)', () => {
        const imageNode = aiImg({ imageData: 'data:image/png;base64,abc' })
        const state = createStateWithNodeSelection(doc(imageNode), 0)
        const selection = state.selection as NodeSelection

        expect(selection.node.isAtom).toBe(true)
    })

    it('is a block node', () => {
        const imageNode = aiImg({ imageData: 'data:image/png;base64,abc' })
        const state = createStateWithNodeSelection(doc(imageNode), 0)
        const selection = state.selection as NodeSelection

        expect(selection.node.isBlock).toBe(true)
    })
})

// =============================================================================
// IMAGE DATA HANDLING TESTS
// =============================================================================

describe('aiGeneratedImage imageData handling', () => {
    it('stores base64 data URL', () => {
        const base64Data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk'
        const imageNode = aiImg({ imageData: base64Data })
        const state = createStateWithNodeSelection(doc(imageNode), 0)
        const selection = state.selection as NodeSelection

        expect(selection.node.attrs.imageData).toBe(base64Data)
    })

    it('stores API path after save', () => {
        const apiPath = '/api/files/user123/images/generated-abc.png'
        const imageNode = aiImg({
            imageData: apiPath,
            fileId: 'file_abc',
        })
        const state = createStateWithNodeSelection(doc(imageNode), 0)
        const selection = state.selection as NodeSelection

        expect(selection.node.attrs.imageData).toBe(apiPath)
    })
})
