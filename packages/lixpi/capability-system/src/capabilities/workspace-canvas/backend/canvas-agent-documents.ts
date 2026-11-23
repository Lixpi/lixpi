import {
    type Node as ProseMirrorNode,
} from 'prosemirror-model'
import {
    type HeadlessProseMirrorEngine,
} from '@lixpi/prosemirror/backend/headless-engine'
import {
    type CanvasAgentDocumentEdit,
    type CanvasAgentPreparedStep,
} from './canvas-agent-ports.ts'

export const createCanvasDocumentContent = (content: string | undefined): object => ({
    type: 'doc',
    content: (content ?? '').split('\n').map(
        text => ({
            type: 'paragraph',
            ...(text ? { content: [{
                type: 'text',
                text,
            }] } : {}),
        }),
    ),
})

const linkTargets = (doc: ProseMirrorNode): Set<unknown> => {
    const links = new Set<unknown>()

    doc.descendants(node => {
        for (const mark of node.marks)
            if (mark.type.name === 'link')
                links.add(mark.attrs.href)
    })

    return links
}

const isSafeLink = (href: unknown): boolean => {
    if (
        typeof href !== 'string'
        || !href.trim()
    )
        return false

    try {
        return ['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(href, 'https://workspace.invalid').protocol)
    } catch {
        return false
    }
}

const validateNewLinks = (
    before: ProseMirrorNode,
    after: ProseMirrorNode,
): void => {
    const previous = linkTargets(before)

    for (const href of linkTargets(after))
        if (
            !previous.has(href)
            && !isSafeLink(href)
        )
            throw new Error('CANVAS_DOCUMENT_INVALID_LINK')
}

export const prepareCanvasDocumentStep = (
    engine: HeadlessProseMirrorEngine,
    edit: CanvasAgentDocumentEdit,
): CanvasAgentPreparedStep | undefined => {
    const before = engine.snapshot()

    try {
        if ('stepJson' in edit) {
            const step = JSON.parse(edit.stepJson)
            const { transaction } = engine.applyStepJson(step)
            engine.doc.check()
            validateNewLinks(transaction.before, transaction.doc)

            return transaction.doc.eq(transaction.before) ? undefined : {
                step: transaction.steps[0]!.toJSON() as object,
                before,
                after: engine.snapshot(),
            }
        }

        const transaction = engine.state.tr

        if ('contentJson' in edit) {
            const content: unknown = JSON.parse(edit.contentJson)

            if (
                !Array.isArray(content)
                || !content.length
                || content.length > 256
            )
                throw new Error('CANVAS_DOCUMENT_CONTENT_INVALID')

            const replacement = engine.schema.nodeFromJSON({
                type: 'doc',
                content,
            })
            replacement.check()
            transaction.replaceWith(
                0,
                engine.doc.content.size,
                replacement.content,
            )
        } else {
            if (
                edit.from > edit.to
                || edit.to > engine.doc.content.size
            )
                throw new Error('CANVAS_DOCUMENT_RANGE_INVALID')

            transaction.insertText(
                edit.text,
                edit.from,
                edit.to,
            )
        }

        if (
            transaction.steps.length === 0
            || transaction.doc.eq(transaction.before)
        )
            return undefined

        if (transaction.steps.length !== 1)
            throw new Error('CANVAS_DOCUMENT_MULTIPLE_STEPS')

        transaction.doc.check()
        validateNewLinks(transaction.before, transaction.doc)

        return {
            step: transaction.steps[0]!.toJSON() as object,
            before,
            after: transaction.doc.toJSON() as object,
        }
    } catch (error) {
        if (
            error instanceof Error
            && error.message === 'CANVAS_DOCUMENT_INVALID_LINK'
        )
            throw error

        throw new Error('CANVAS_DOCUMENT_STEP_INVALID')
    }
}
