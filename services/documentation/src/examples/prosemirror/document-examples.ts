import { Plugin } from 'prosemirror-state'
import {
    type Node as ProseMirrorNode,
} from 'prosemirror-model'
import {
    mountDocumentView,
    type DocumentViewFeature,
    type DocumentViewHandle,
} from '@lixpi/prosemirror/frontend/document-view'
import {
    baseKeymapFeature,
    dropCursorFeature,
    gapCursorFeature,
    historyFeature,
} from '@lixpi/prosemirror/frontend/core-features'
import {
    bubbleMenuFeature,
    imageSelectionFeature,
    inputRulesFeature,
    linkTooltipFeature,
    richKeymapFeature,
    type RichEditingContext,
} from '@lixpi/prosemirror/frontend/rich-editing'
import { codeBlockFeature } from '@lixpi/prosemirror/frontend/code-block'
import { html } from '@lixpi/ui-primitives/dom'

import {
    type ExampleOwner,
} from '../../catalog/catalog.ts'
import { documentationDocumentKinds } from '../workspace/document-kinds.ts'
import { UiExample } from '../ui-example.ts'

const ASSET_CONTENT_KIND = 'assetContent'

type JsonNode = {
    type: string
    attrs?: Record<string, unknown>
    content?: JsonNode[]
    marks?: Array<{
        type: string
        attrs?: Record<string, unknown>
    }>
    text?: string
}

const text = (
    value: string,
    marks: JsonNode['marks'] = [],
): JsonNode => ({
    type: 'text',
    text: value,
    ...(marks.length ? { marks } : {}),
})

const paragraph = (...content: JsonNode[]): JsonNode => ({
    type: 'paragraph',
    content,
})

const heading = (
    level: number,
    value: string,
): JsonNode => ({
    type: 'heading',
    attrs: { level },
    content: [text(value)],
})

const codeBlock = (source: string): JsonNode => ({
    type: 'code_block',
    content: [text(source)],
})

const richDocument: JsonNode = {
    type: 'doc',
    content: [
        heading(2, 'Launch notes'),
        paragraph(
            text('Select any text to open the formatting bubble. Make it '),
            text('bold', [{ type: 'strong' }]),
            text(', '),
            text('italic', [{ type: 'em' }]),
            text(' or '),
            text(
                'a link',
                [{
                    type: 'link',
                    attrs: { href: 'https://lixpi.com' },
                }],
            ),
            text('. Place the cursor in the link to open its tooltip.'),
        ),
        paragraph(
            text('Markdown shortcuts work as you type: start a line with "## " for a heading or "> " for a quote.'),
        ),
        {
            type: 'blockquote',
            content: [paragraph(
                text('Keep the product in sharp focus and the background soft.'),
            )],
        },
        codeBlock("const brief = await workspace.read('creative-brief')"),
        { type: 'horizontal_rule' },
        paragraph(
            text('Undo with Mod-z and redo with Mod-Shift-z.'),
        ),
    ],
}

const richFeatures: DocumentViewFeature<RichEditingContext>[] = [
    bubbleMenuFeature,
    linkTooltipFeature,
    imageSelectionFeature,
    inputRulesFeature,
    richKeymapFeature,
    baseKeymapFeature,
    dropCursorFeature,
    gapCursorFeature,
    historyFeature,
    codeBlockFeature,
]

// The fixture has no media service, so stored references are already
// browser URLs.
const richEditingContext: RichEditingContext = {
    richEditing: {
        resolveMediaUrl: async url => url,
    },
}

const editorHost = (): HTMLElement => html`<div className="documentation-ui-editor"></div>` as HTMLElement

const createRichTextExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'This document view runs the rich-editing features of @lixpi/prosemirror on the asset content schema: the formatting bubble menu, link tooltips, markdown input rules, the formatting keymap, history and CodeMirror code blocks. Edit freely; nothing is saved.',
    )
    const container = editorHost()
    example.specimen('Editor', container)
    const handle = mountDocumentView<RichEditingContext>({
        registry: documentationDocumentKinds,
        definition: {
            kindId: ASSET_CONTENT_KIND,
            features: richFeatures,
        },
        container,
        document: richDocument,
        context: richEditingContext,
    })
    example.own(() => handle.destroy())
    example.frame.button('Restore the document', () => handle.replaceDocument(richDocument))
    example.frame.code(
        () => [
            "import { mountDocumentView } from '@lixpi/prosemirror/frontend/document-view'",
            "import { historyFeature, baseKeymapFeature } from '@lixpi/prosemirror/frontend/core-features'",
            "import { bubbleMenuFeature, linkTooltipFeature, inputRulesFeature, richKeymapFeature } from '@lixpi/prosemirror/frontend/rich-editing'",
            "import { codeBlockFeature } from '@lixpi/prosemirror/frontend/code-block'",
            '',
            'const handle = mountDocumentView({',
            '    registry: createCoreDocumentKindRegistry(),',
            "    definition: { kindId: 'assetContent', features: [bubbleMenuFeature, linkTooltipFeature, inputRulesFeature, richKeymapFeature, baseKeymapFeature, historyFeature, codeBlockFeature] },",
            '    container,',
            '    document,',
            '    context: { richEditing: { resolveMediaUrl } },',
            '})',
        ].join('\n'),
    )

    return example
}

const codeDocument: JsonNode = {
    type: 'doc',
    content: [
        paragraph(
            text('Each code block below is a CodeMirror editor inside the document. Arrow keys move between the document and the code.'),
        ),
        codeBlock(
            [
                'const createPoster = async (brief) => {',
                '    const prompt = `${brief.subject}, ${brief.mood}`',
                '    return generateImage({ prompt, size: [1024, 1536] })',
                '}',
            ].join('\n'),
        ),
        paragraph(
            text('Type three backticks at the start of an empty line to add another block.'),
        ),
        codeBlock('export const sizes = { poster: [1024, 1536], square: [1024, 1024] }'),
    ],
}

const createCodeBlockExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'codeBlockFeature renders every code_block node as a nested CodeMirror editor with JavaScript highlighting and the Lixpi Gruvbox Light theme, and adds the triple-backtick input rule.',
    )
    const container = editorHost()
    example.specimen('Document with code', container)
    const handle = mountDocumentView<unknown>({
        registry: documentationDocumentKinds,
        definition: {
            kindId: ASSET_CONTENT_KIND,
            features: [
                baseKeymapFeature,
                historyFeature,
                codeBlockFeature,
            ],
        },
        container,
        document: codeDocument,
        context: undefined,
    })
    example.own(() => handle.destroy())
    example.frame.button('Restore the document', () => handle.replaceDocument(codeDocument))
    example.frame.code(
        () => [
            "import { codeBlockFeature } from '@lixpi/prosemirror/frontend/code-block'",
            "import '@lixpi/prosemirror/styles/code-mirror'",
            '',
            "definition: { kindId: 'assetContent', features: [baseKeymapFeature, historyFeature, codeBlockFeature] }",
        ].join('\n'),
    )

    return example
}

type WordCountContext = {
    isEditable: () => boolean
    onDocumentChange: (doc: ProseMirrorNode) => void
}

// A host feature: it contributes a plugin that reports every document
// change, and an editable check the view combines with other features.
const wordCountFeature: DocumentViewFeature<WordCountContext> = {
    id: 'word-count',
    create: ({ context }) => ({
        plugins: [new Plugin({
            view: view => {
                context.onDocumentChange(view.state.doc)

                return {
                    update: updated => context.onDocumentChange(updated.state.doc),
                }
            },
        })],
        props: { editable: () => context.isEditable() },
    }),
}

const countWords = (doc: ProseMirrorNode): number => doc.textBetween(
    0,
    doc.content.size,
    ' ',
    ' ',
).split(/\s+/).filter(Boolean).length

const sampleDocuments: Record<string, JsonNode> = {
    brief: {
        type: 'doc',
        content: [
            heading(2, 'Creative brief'),
            paragraph(
                text('A poster for an autumn product launch with warm light and generous negative space.'),
            ),
        ],
    },
    shotList: {
        type: 'doc',
        content: [
            heading(2, 'Shot list'),
            paragraph(
                text('Wide establishing shot, medium product shot, macro texture detail and a closing logo card.'),
            ),
        ],
    },
}

const createDocumentViewExample = (host: HTMLElement): UiExample => {
    const example = new UiExample(
        host,
        'mountDocumentView builds an editor from named features. Each feature contributes plugins, node views and props; the view is editable only while every feature allows it. The word-count feature here is written by the host. replaceDocument swaps the content in one transaction that history ignores.',
    )
    const container = editorHost()
    example.specimen('View', container)
    let editable = true
    let words = 0
    const view: DocumentViewHandle = mountDocumentView<WordCountContext>({
        registry: documentationDocumentKinds,
        definition: {
            kindId: ASSET_CONTENT_KIND,
            features: [
                wordCountFeature,
                baseKeymapFeature,
                historyFeature,
            ],
        },
        container,
        document: sampleDocuments.brief,
        context: {
            isEditable: () => editable,
            onDocumentChange: doc => {
                words = countWords(doc)
                example.frame.report(`${words} words.`)
            },
        },
    })
    example.own(() => view.destroy())
    example.frame.toggle(
        'Editable',
        editable,
        value => {
            editable = value
            // An empty transaction makes the view read its editable prop again.
            view.view.dispatch(view.view.state.tr)
        },
    )
    example.frame.select(
        'Document',
        'brief',
        {
            brief: 'Creative brief',
            shotList: 'Shot list',
        },
        value => view.replaceDocument(sampleDocuments[value]),
    )
    example.frame.code(
        () => [
            "import { mountDocumentView, type DocumentViewFeature } from '@lixpi/prosemirror/frontend/document-view'",
            '',
            'const wordCount: DocumentViewFeature<Context> = {',
            "    id: 'word-count',",
            '    create: ({ context }) => ({',
            '        plugins: [new Plugin({ view: () => ({ update: view => context.onDocumentChange(view.state.doc) }) })],',
            '        props: { editable: () => context.isEditable() },',
            '    }),',
            '}',
            '',
            "const handle = mountDocumentView({ registry, definition: { kindId: 'assetContent', features: [wordCount, historyFeature] }, container, context })",
            `// editable: ${editable}, ${words} words`,
        ].join('\n'),
    )

    return example
}

const factories: Record<string, (host: HTMLElement) => UiExample> = {
    'prosemirror-rich-text': createRichTextExample,
    'prosemirror-code-block': createCodeBlockExample,
    'prosemirror-document-view': createDocumentViewExample,
}

export const createExample = (
    host: HTMLElement,
    id: string,
): ExampleOwner => {
    const factory = factories[id]

    if (!factory)
        throw new Error(`Unknown ProseMirror example: ${id}`)

    return factory(host)
}
