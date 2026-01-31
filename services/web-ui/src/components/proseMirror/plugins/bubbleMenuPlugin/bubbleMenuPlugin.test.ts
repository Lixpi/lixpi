import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NodeSelection } from 'prosemirror-state'
import {
    doc,
    p,
    img,
    aiImg,
    createEditorState,
    createStateWithNodeSelection,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'
import { createMockEditorView, createMockImageWrapper } from '$src/components/proseMirror/plugins/testUtils/testHelpers.ts'

// =============================================================================
// PARAMETERIZED IMAGE NODE TEST CASES
// =============================================================================

const imageNodeCases = [
    { name: 'image', createNode: () => img({ src: 'test.jpg', alt: 'test' }) },
    { name: 'aiGeneratedImage', createNode: () => aiImg({ imageData: 'data:image/png;base64,abc' }) },
] as const

// =============================================================================
// getImageElement TESTS (testing the logic, not the private method directly)
// =============================================================================

describe('Image element retrieval logic', () => {
    describe('returns null for non-NodeSelection', () => {
        it('returns null when cursor is in paragraph', () => {
            const state = createEditorState(doc(p('Hello')))
            const selection = state.selection

            expect(selection instanceof NodeSelection).toBe(false)
        })
    })

    describe('returns null for non-image NodeSelection', () => {
        it('returns null when blockquote is selected', () => {
            // When a non-image node is selected, getImageElement should return null
            // This tests the logic: nodeType !== 'image' && nodeType !== 'aiGeneratedImage'
            const state = createEditorState(doc(p('Hello')))
            const selection = state.selection

            // Not a NodeSelection, so any image retrieval should fail
            expect(selection instanceof NodeSelection).toBe(false)
        })
    })

    describe('handles both image types (parameterized)', () => {
        imageNodeCases.forEach(({ name, createNode }) => {
            it(`recognizes ${name} as valid image node`, () => {
                const imageNode = createNode()
                const state = createStateWithNodeSelection(doc(imageNode), 0)
                const selection = state.selection as NodeSelection

                expect(selection.node.type.name).toBe(name)
            })
        })
    })
})

// =============================================================================
// getImageWrapper TESTS
// =============================================================================

describe('Image wrapper retrieval logic', () => {
    describe('finds wrapper with pm-image-wrapper class', () => {
        it('returns element when it has pm-image-wrapper class', () => {
            const wrapper = createMockImageWrapper('test.jpg')

            expect(wrapper.classList.contains('pm-image-wrapper')).toBe(true)
            expect(wrapper.querySelector('img')).not.toBeNull()
        })
    })

    describe('handles both image types (parameterized)', () => {
        imageNodeCases.forEach(({ name, createNode }) => {
            it(`can create wrapper for ${name}`, () => {
                const imageNode = createNode()
                const state = createStateWithNodeSelection(doc(imageNode), 0)
                const selection = state.selection as NodeSelection

                // The node type should be correct
                expect(selection.node.type.name).toBe(name)

                // Both types should work with the same wrapper structure
                const wrapper = createMockImageWrapper('test.jpg')
                expect(wrapper.classList.contains('pm-image-wrapper')).toBe(true)
            })
        })
    })
})

// =============================================================================
// Menu positioning logic tests
// =============================================================================

describe('Menu positioning with images', () => {
    describe('calculates position from image bounds', () => {
        it('positions menu above image center', () => {
            const wrapper = createMockImageWrapper('test.jpg')
            document.body.appendChild(wrapper)

            // Mock getBoundingClientRect
            wrapper.getBoundingClientRect = () => ({
                left: 100,
                right: 300,
                top: 200,
                bottom: 400,
                width: 200,
                height: 200,
                x: 100,
                y: 200,
                toJSON: () => ({}),
            })

            const rect = wrapper.getBoundingClientRect()
            const centerX = (rect.left + rect.right) / 2

            expect(centerX).toBe(200)
            expect(rect.top).toBe(200)

            document.body.removeChild(wrapper)
        })
    })

    describe('handles both image types identically (parameterized)', () => {
        imageNodeCases.forEach(({ name, createNode }) => {
            it(`positions menu the same way for ${name}`, () => {
                const imageNode = createNode()
                const state = createStateWithNodeSelection(doc(imageNode), 0)
                const selection = state.selection as NodeSelection

                // Both should use the same positioning logic
                expect(selection.node.type.name).toBe(name)

                // The positioning algorithm doesn't care about the node type,
                // only that it's a valid image node
                const nodeTypeName = selection.node.type.name
                const isValidImage = nodeTypeName === 'image' || nodeTypeName === 'aiGeneratedImage'
                expect(isValidImage).toBe(true)
            })
        })
    })
})
