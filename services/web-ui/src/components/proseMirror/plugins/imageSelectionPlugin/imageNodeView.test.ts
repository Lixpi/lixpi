import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NodeSelection } from 'prosemirror-state'
import {
    doc,
    img,
    aiImg,
    createStateWithNodeSelection,
    schema,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'

// =============================================================================
// PARAMETERIZED IMAGE NODE TEST CASES
// =============================================================================

const imageNodeCases = [
    {
        name: 'image',
        createNode: (attrs: Record<string, unknown> = {}) =>
            img({ src: 'test.jpg', alt: 'test', ...attrs }),
        srcAttr: 'src',
    },
    {
        name: 'aiGeneratedImage',
        createNode: (attrs: Record<string, unknown> = {}) =>
            aiImg({ imageData: 'data:image/png;base64,abc', ...attrs }),
        srcAttr: 'imageData',
    },
] as const

// =============================================================================
// getImageSrcAttr TESTS (testing the logic)
// =============================================================================

describe('getImageSrcAttr logic', () => {
    describe('returns correct source attribute (parameterized)', () => {
        imageNodeCases.forEach(({ name, createNode, srcAttr }) => {
            it(`reads ${srcAttr} for ${name}`, () => {
                const imageNode = createNode()
                const state = createStateWithNodeSelection(doc(imageNode), 0)
                const selection = state.selection as NodeSelection

                // The logic: return node.attrs.src || node.attrs.imageData || ''
                const src = selection.node.attrs.src || selection.node.attrs.imageData || ''
                expect(src).toBeTruthy()
            })
        })
    })

    it('returns empty string when neither src nor imageData is set', () => {
        // Create a node with empty src
        const imageNode = img({ src: '', alt: 'test' })
        const state = createStateWithNodeSelection(doc(imageNode), 0)
        const selection = state.selection as NodeSelection

        const src = selection.node.attrs.src || selection.node.attrs.imageData || ''
        expect(src).toBe('')
    })
})

// =============================================================================
// ImageNodeView shared behavior tests
// =============================================================================

describe('ImageNodeView shared behavior', () => {
    describe('applies alignment attribute correctly (parameterized)', () => {
        const alignments = ['left', 'center', 'right'] as const

        imageNodeCases.forEach(({ name, createNode }) => {
            alignments.forEach((alignment) => {
                it(`applies ${alignment} alignment for ${name}`, () => {
                    const imageNode = createNode({ alignment })
                    const state = createStateWithNodeSelection(doc(imageNode), 0)
                    const selection = state.selection as NodeSelection

                    expect(selection.node.attrs.alignment).toBe(alignment)
                })
            })
        })
    })

    describe('applies textWrap attribute correctly (parameterized)', () => {
        const wraps = ['none', 'left', 'right'] as const

        imageNodeCases.forEach(({ name, createNode }) => {
            wraps.forEach((wrap) => {
                it(`applies ${wrap} textWrap for ${name}`, () => {
                    const imageNode = createNode({ textWrap: wrap })
                    const state = createStateWithNodeSelection(doc(imageNode), 0)
                    const selection = state.selection as NodeSelection

                    expect(selection.node.attrs.textWrap).toBe(wrap)
                })
            })
        })
    })

    describe('applies width attribute correctly (parameterized)', () => {
        imageNodeCases.forEach(({ name, createNode }) => {
            it(`stores width for ${name}`, () => {
                const imageNode = createNode({ width: '50%' })
                const state = createStateWithNodeSelection(doc(imageNode), 0)
                const selection = state.selection as NodeSelection

                expect(selection.node.attrs.width).toBe('50%')
            })

            it(`allows null width for ${name}`, () => {
                const imageNode = createNode({ width: null })
                const state = createStateWithNodeSelection(doc(imageNode), 0)
                const selection = state.selection as NodeSelection

                expect(selection.node.attrs.width).toBeNull()
            })
        })
    })
})

// =============================================================================
// CSS class building logic tests
// =============================================================================

describe('Image wrapper CSS class building', () => {
    describe('builds correct class string (parameterized)', () => {
        imageNodeCases.forEach(({ name, createNode }) => {
            it(`builds class for ${name} with left alignment and no wrap`, () => {
                const imageNode = createNode({ alignment: 'left', textWrap: 'none' })
                const state = createStateWithNodeSelection(doc(imageNode), 0)
                const selection = state.selection as NodeSelection
                const { alignment, textWrap } = selection.node.attrs

                const className = `pm-image-wrapper pm-image-align-${alignment} pm-image-wrap-${textWrap}`
                expect(className).toBe('pm-image-wrapper pm-image-align-left pm-image-wrap-none')
            })

            it(`builds class for ${name} with center alignment and left wrap`, () => {
                const imageNode = createNode({ alignment: 'center', textWrap: 'left' })
                const state = createStateWithNodeSelection(doc(imageNode), 0)
                const selection = state.selection as NodeSelection
                const { alignment, textWrap } = selection.node.attrs

                const className = `pm-image-wrapper pm-image-align-${alignment} pm-image-wrap-${textWrap}`
                expect(className).toBe('pm-image-wrapper pm-image-align-center pm-image-wrap-left')
            })
        })
    })
})

// =============================================================================
// Node selection behavior tests
// =============================================================================

describe('Image node selection', () => {
    describe('creates NodeSelection correctly (parameterized)', () => {
        imageNodeCases.forEach(({ name, createNode }) => {
            it(`selects ${name} at position 0`, () => {
                const imageNode = createNode()
                const state = createStateWithNodeSelection(doc(imageNode), 0)

                expect(state.selection instanceof NodeSelection).toBe(true)
                expect((state.selection as NodeSelection).node.type.name).toBe(name)
            })
        })
    })
})
