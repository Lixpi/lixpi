import { describe, it, expect } from 'vitest'
import { NodeSelection } from 'prosemirror-state'
import { getSelectionContext } from '$src/components/proseMirror/plugins/bubbleMenuPlugin/bubbleMenuItems.ts'
import {
    doc,
    p,
    img,
    aiImg,
    blockquote,
    createEditorState,
    createStateWithNodeSelection,
    createStateWithTextSelection,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'
import { createMockEditorView } from '$src/components/proseMirror/plugins/testUtils/testHelpers.ts'

// =============================================================================
// PARAMETERIZED IMAGE NODE TEST CASES
// =============================================================================

// Both image and aiGeneratedImage should behave the same for selection context
const imageNodeCases = [
    { name: 'image', createNode: () => img({ src: 'test.jpg', alt: 'test' }) },
    { name: 'aiGeneratedImage', createNode: () => aiImg({ imageData: 'data:image/png;base64,abc' }) },
] as const

// =============================================================================
// getSelectionContext TESTS
// =============================================================================

describe('getSelectionContext', () => {
    describe('returns "none" for empty selection', () => {
        it('with cursor in empty paragraph', () => {
            const state = createEditorState(doc(p()))
            const view = createMockEditorView({ state })

            expect(getSelectionContext(view)).toBe('none')
        })

        it('with cursor in paragraph with text', () => {
            // Place cursor at position 1 (after opening <p>)
            const state = createEditorState(doc(p('Hello world')))
            const view = createMockEditorView({ state })

            expect(getSelectionContext(view)).toBe('none')
        })
    })

    describe('returns "text" for non-empty text selection', () => {
        it('with partial word selected', () => {
            const state = createStateWithTextSelection(doc(p('Hello world')), 1, 6)
            const view = createMockEditorView({ state })

            expect(getSelectionContext(view)).toBe('text')
        })

        it('with entire paragraph selected', () => {
            const state = createStateWithTextSelection(doc(p('Hello')), 1, 6)
            const view = createMockEditorView({ state })

            expect(getSelectionContext(view)).toBe('text')
        })

        it('with selection spanning multiple paragraphs', () => {
            const state = createStateWithTextSelection(doc(p('Hello'), p('World')), 1, 13)
            const view = createMockEditorView({ state })

            expect(getSelectionContext(view)).toBe('text')
        })
    })

    describe('returns "image" for image node selection (parameterized)', () => {
        imageNodeCases.forEach(({ name, createNode }) => {
            it(`returns "image" when ${name} is selected`, () => {
                const imageNode = createNode()
                const state = createStateWithNodeSelection(doc(p('Before'), imageNode, p('After')), 8)
                const view = createMockEditorView({ state })

                expect(getSelectionContext(view)).toBe('image')
            })
        })

        imageNodeCases.forEach(({ name, createNode }) => {
            it(`returns "image" when ${name} is the only content`, () => {
                const imageNode = createNode()
                const state = createStateWithNodeSelection(doc(imageNode), 0)
                const view = createMockEditorView({ state })

                expect(getSelectionContext(view)).toBe('image')
            })
        })
    })

    describe('returns "none" for non-image node selection', () => {
        it('with blockquote selected', () => {
            // Create a state with a blockquote at the document root level
            const state = createEditorState(doc(blockquote(p('Quote content'))))
            // Create a NodeSelection for the blockquote (position 0)
            const nodeSelection = NodeSelection.create(state.doc, 0)
            const stateWithSelection = state.apply(state.tr.setSelection(nodeSelection))
            const view = createMockEditorView({ state: stateWithSelection })

            expect(getSelectionContext(view)).toBe('none')
        })
    })
})

// =============================================================================
// getSelectedImageNode TESTS
// =============================================================================

// Note: getSelectedImageNode is not exported, but we can test it indirectly
// through the image alignment and wrap button behaviors, or we can add an
// export for testing purposes. For now, we focus on getSelectionContext.

// If we need to test getSelectedImageNode directly, we could:
// 1. Export it from bubbleMenuItems.ts
// 2. Or test it through integration tests with the actual menu items
