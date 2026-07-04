import { describe, expect, it } from 'vitest'
import { EditorState } from 'prosemirror-state'

import {
    applyStreamingBlockContentToTransaction,
    applyStreamingInlineContentToTransaction,
    applyStreamingSegmentToTransaction,
    buildStreamingSegmentSteps,
    buildStreamingSegmentTransaction,
    createStreamingMarks,
} from './stream-assembly.ts'
import { createProseMirrorSchema, DOCUMENT_TYPE } from './schema-builder.ts'

type SegmentTargetInfo = {
    endOfNodePos: number
    childCount: number
}

function createDocumentState(): {
    state: import('prosemirror-state').EditorState
    schema: ReturnType<typeof createProseMirrorSchema>
} {
    const schema = createProseMirrorSchema(DOCUMENT_TYPE.DOCUMENT)
    const doc = schema.nodes.doc.create(null, [
        schema.nodes.documentTitle.create(null, schema.text('Document Title')),
        schema.nodes.paragraph.create(null, schema.text('seed')),
    ])

    return {
        schema,
        state: EditorState.create({ doc }),
    }
}

function getFirstParagraphEnd(state: EditorState): number {
    let paragraphStart = 0
    let paragraphNode = state.doc
    state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph') {
            paragraphStart = pos
            paragraphNode = node
            return false
        }
        return true
    })

    return paragraphStart + paragraphNode.nodeSize
}

function getDocumentEnd(state: EditorState): number {
    return state.doc.content.size + 1
}

describe('createStreamingMarks', () => {
    it('returns null when no styles are present', () => {
        const { schema } = createDocumentState()
        expect(createStreamingMarks(schema, undefined)).toBeNull()
        expect(createStreamingMarks(schema, [])).toBeNull()
    })

    it('filters unknown styles and keeps order for supported styles', () => {
        const { schema } = createDocumentState()
        const marks = createStreamingMarks(schema, ['bold', 'missing', 'code', 'italic'])
        expect(marks?.map(mark => mark.type.name)).toEqual(['strong', 'code', 'em'])
    })
})

describe('buildStreamingSegmentTransaction', () => {
    it('routes block-defining and inline segments to expected handlers', () => {
        const { state, schema } = createDocumentState()
        const blockTarget: SegmentTargetInfo = {
            endOfNodePos: getDocumentEnd(state),
            childCount: state.doc.childCount,
        }
        const inlineTarget: SegmentTargetInfo = {
            endOfNodePos: getFirstParagraphEnd(state),
            childCount: 0,
        }

        const blockTr = buildStreamingSegmentTransaction(state, {
            type: 'header',
            segment: 'Header text',
            level: 2,
            styles: ['bold'],
            isBlockDefining: true,
        }, blockTarget)
        const inlineTr = buildStreamingSegmentTransaction(state, {
            type: 'text',
            segment: ' plus inline',
            styles: ['code'],
            isBlockDefining: false,
            level: undefined,
        }, inlineTarget)

        expect(blockTr.doc.textBetween(1, blockTr.doc.content.size, '\n', ''))
            .toContain('Header text')
        expect(blockTr.doc.toJSON().content?.some((node) => node.type === 'heading')).toBe(true)
        expect(inlineTr.doc.textBetween(1, inlineTr.doc.content.size, '\n', ''))
            .toContain('plus inline')
        expect(inlineTr.doc.toJSON().content?.some((node) => node.type === 'code_block')).toBe(false)
        expect(inlineTr.doc.nodeSize).toBeGreaterThan(0)
        expect(schema).toBeTruthy()
    })

    it('builds both transaction and extracted steps from a single build call', () => {
        const { state } = createDocumentState()
        const target: SegmentTargetInfo = {
            endOfNodePos: getDocumentEnd(state),
            childCount: state.doc.childCount,
        }
        const result = buildStreamingSegmentSteps(state, {
            type: 'paragraph',
            segment: 'line',
            styles: undefined,
            level: undefined,
            isBlockDefining: false,
        }, target)

        expect(result.steps).toHaveLength(result.transaction.steps.length)
        expect(result.transaction.doc).toBeDefined()
    })
})

describe('applyStreamingBlockContentToTransaction', () => {
    it('adds a heading and prepended paragraph when children already exist', () => {
        const { state } = createDocumentState()
        const tr = state.tr
        const target: SegmentTargetInfo = {
            endOfNodePos: getDocumentEnd(state),
            childCount: state.doc.childCount,
        }

        applyStreamingBlockContentToTransaction(tr, 'header', 'New heading', 2, undefined, target.endOfNodePos, target.childCount)
        expect(tr.doc.toJSON().content?.some((node) => node.type === 'paragraph')).toBe(true)
        expect(tr.doc.toJSON().content?.some((node) => node.type === 'heading')).toBe(true)
    })

    it('adds only a heading when childCount is zero', () => {
        const { state } = createDocumentState()
        const tr = state.tr
        const target: SegmentTargetInfo = {
            endOfNodePos: getDocumentEnd(state),
            childCount: 0,
        }

        applyStreamingBlockContentToTransaction(tr, 'header', 'First heading', 3, undefined, target.endOfNodePos, target.childCount)
        expect(tr.doc.toJSON().content?.filter((node) => node.type === 'heading').length).toBe(1)
        expect(tr.doc.toJSON().content?.filter((node) => node.type === 'paragraph').length).toBe(1)
    })

    it('adds empty paragraphs when paragraph content is empty', () => {
        const { state, schema } = createDocumentState()
        const tr = state.tr
        const target: SegmentTargetInfo = {
            endOfNodePos: getDocumentEnd(state),
            childCount: state.doc.childCount,
        }
        const firstParagraph = schema.nodes.paragraph.create()
        const targetState = EditorState.create({
            doc: schema.nodes.doc.create(null, [
                schema.nodes.documentTitle.create(null, schema.text('Document Title')),
                firstParagraph,
            ]),
        })
        const paragraphTr = targetState.tr

        applyStreamingBlockContentToTransaction(
            paragraphTr,
            'paragraph',
            '',
            1,
            undefined,
            getDocumentEnd(targetState),
            target.childCount,
        )
        expect(paragraphTr.doc.toJSON().content?.filter((node) => node.type === 'paragraph').length).toBe(2)
    })

    it('handles code block block content insertion as code_block', () => {
        const { state } = createDocumentState()
        const tr = state.tr
        const target: SegmentTargetInfo = {
            endOfNodePos: getDocumentEnd(state),
            childCount: state.doc.childCount,
        }
        applyStreamingBlockContentToTransaction(tr, 'codeBlock', 'const x = 1', 1, undefined, target.endOfNodePos, target.childCount)
        expect(tr.doc.toJSON().content?.some((node) => node.type === 'code_block')).toBe(true)
    })

    it('no-ops for unsupported block types', () => {
        const { state } = createDocumentState()
        const tr = state.tr
        applyStreamingBlockContentToTransaction(tr, 'bulletList', 'x', 1, undefined, getDocumentEnd(state), state.doc.childCount)
        expect(tr.steps).toHaveLength(0)
    })
})

describe('applyStreamingInlineContentToTransaction', () => {
    it('handles newline by inserting a paragraph', () => {
        const { state } = createDocumentState()
        const tr = state.tr
        const beforeParagraphCount = tr.doc.childCount
        applyStreamingInlineContentToTransaction(tr, 'text', '\n', undefined, getFirstParagraphEnd(state))
        expect(tr.doc.childCount).toBe(beforeParagraphCount + 1)
    })

    it('inserts code-style inline content as text when content is code block type', () => {
        const { state } = createDocumentState()
        const tr = state.tr
        applyStreamingInlineContentToTransaction(tr, 'codeBlock', 'token', undefined, getFirstParagraphEnd(state))
        expect(tr.doc.textBetween(1, tr.doc.content.size, '\n', '')).toContain('token')
    })

    it('applies unknown style markers as inline text with no crash', () => {
        const { state, schema } = createDocumentState()
        const tr = state.tr
        const markAware = createStreamingMarks(schema, undefined)
        applyStreamingInlineContentToTransaction(tr, 'text', 'safe', markAware, getFirstParagraphEnd(state))
        expect(tr.doc.textBetween(1, tr.doc.content.size, '\n', '')).toContain('safe')
    })
})
