import {
    type MarkdownParsedSegment,
} from '@lixpi/constants'
import {
    type Mark,
    type Schema,
} from 'prosemirror-model'
import {
    type EditorState,
    type Transaction,
} from 'prosemirror-state'
import {
    type Step,
} from 'prosemirror-transform'

export type StreamingSegmentTarget = {
    endOfNodePos: number
    childCount: number
}

export type StreamingSegmentAssembly = {
    transaction: Transaction
    steps: readonly Step[]
}

export function buildStreamingSegmentTransaction(
    state: EditorState,
    segment: MarkdownParsedSegment,
    target: StreamingSegmentTarget,
): Transaction {
    const tr = state.tr
    applyStreamingSegmentToTransaction(tr, segment, target)
    return tr
}

export function buildStreamingSegmentSteps(
    state: EditorState,
    segment: MarkdownParsedSegment,
    target: StreamingSegmentTarget,
): StreamingSegmentAssembly {
    const transaction = buildStreamingSegmentTransaction(state, segment, target)
    return {
        transaction,
        steps: transaction.steps,
    }
}

export function applyStreamingSegmentToTransaction(
    tr: Transaction,
    segment: MarkdownParsedSegment,
    target: StreamingSegmentTarget,
): void {
    const marks = createStreamingMarks(tr.doc.type.schema, segment.styles)
    if (segment.isBlockDefining) {
        applyStreamingBlockContentToTransaction(
            tr,
            segment.type,
            segment.segment,
            segment.level,
            marks,
            target.endOfNodePos,
            target.childCount,
        )
        return
    }

    applyStreamingInlineContentToTransaction(
        tr,
        segment.type,
        segment.segment,
        marks,
        target.endOfNodePos,
    )
}

export function createStreamingMarks(
    schema: Schema,
    styles: readonly string[] | undefined,
): Mark[] | null {
    if (!styles || styles.length === 0) return null

    const marks = styles.flatMap((style): Mark[] => {
        const mark = createStreamingMark(schema, style)
        return mark ? [mark] : []
    })

    return marks.length > 0 ? marks : null
}

export function applyStreamingBlockContentToTransaction(
    tr: Transaction,
    type: string,
    content: string,
    level: number | undefined,
    marks: readonly Mark[] | null,
    endOfNodePos: number,
    childCount: number,
): void {
    const insertPos = endOfNodePos - 1
    tr.doc.resolve(insertPos)

    switch (type) {
        case 'header': {
            const textNode = tr.doc.type.schema.text(content)
            const headingNode = tr.doc.type.schema.nodes.heading.createAndFill({ level }, textNode)
            if (!headingNode) return

            if (childCount === 0) {
                tr.insert(insertPos, headingNode)
            } else {
                const paragraphNode = tr.doc.type.schema.nodes.paragraph.createAndFill()
                if (paragraphNode) tr.insert(insertPos, paragraphNode)
                tr.insert(endOfNodePos, headingNode)
            }
            break
        }

        case 'paragraph': {
            if (content) {
                const textNode = marks
                    ? tr.doc.type.schema.text(content, marks)
                    : tr.doc.type.schema.text(content)
                const paragraphNode = tr.doc.type.schema.nodes.paragraph.createAndFill(null, textNode)
                if (paragraphNode) tr.insert(insertPos, paragraphNode)
            } else {
                const emptyParagraph = tr.doc.type.schema.nodes.paragraph.create()
                tr.insert(insertPos, emptyParagraph)
            }
            break
        }

        case 'codeBlock': {
            const codeText = tr.doc.type.schema.text(content)
            const codeBlock = tr.doc.type.schema.nodes.code_block.createAndFill(null, codeText)
            if (codeBlock) tr.insert(insertPos, codeBlock)
            break
        }
    }
}

export function applyStreamingInlineContentToTransaction(
    tr: Transaction,
    type: string,
    content: string,
    marks: readonly Mark[] | null,
    endOfNodePos: number,
): void {
    const insertPos = endOfNodePos - 2
    tr.doc.resolve(insertPos)

    if (type === 'codeBlock') {
        const codeText = tr.doc.type.schema.text(content)
        tr.insert(insertPos, codeText)
        return
    }

    if (content === '\n') {
        const newParagraph = tr.doc.type.schema.nodes.paragraph.create()
        tr.insert(endOfNodePos - 1, newParagraph)
        return
    }

    if (content) {
        const textNode = marks
            ? tr.doc.type.schema.text(content, marks)
            : tr.doc.type.schema.text(content)
        tr.insert(insertPos, textNode)
    }
}

function createStreamingMark(
    schema: Schema,
    style: string,
): Mark | null {
    switch (style) {
        case 'bold':
            return schema.marks.strong.create()
        case 'italic':
            return schema.marks.em.create()
        case 'strikethrough':
            return schema.marks.strikethrough.create()
        case 'code':
            return schema.marks.code.create()
        default:
            return null
    }
}
