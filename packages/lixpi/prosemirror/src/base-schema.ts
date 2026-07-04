import {
    Schema,
    type DOMOutputSpec,
    type MarkSpec,
    type NodeSpec,
} from 'prosemirror-model'

const pDOM: DOMOutputSpec = ['p', 0]
const blockquoteDOM: DOMOutputSpec = ['blockquote', 0]
const hrDOM: DOMOutputSpec = ['hr']
const preDOM: DOMOutputSpec = ['pre', ['code', 0]]
const brDOM: DOMOutputSpec = ['br']

export const nodes = {
    doc: {
        content: 'block+',
    } as NodeSpec,

    paragraph: {
        content: 'inline*',
        group: 'block',
        parseDOM: [{ tag: 'p' }],
        toDOM() { return pDOM },
    } as NodeSpec,

    blockquote: {
        content: 'block+',
        group: 'block',
        defining: true,
        parseDOM: [{ tag: 'blockquote' }],
        toDOM() { return blockquoteDOM },
    } as NodeSpec,

    horizontal_rule: {
        group: 'block',
        parseDOM: [{ tag: 'hr' }],
        toDOM() { return hrDOM },
    } as NodeSpec,

    heading: {
        attrs: { level: { default: 1 } },
        content: 'inline*',
        group: 'block',
        defining: true,
        parseDOM: [
            { tag: 'h1', attrs: { level: 1 } },
            { tag: 'h2', attrs: { level: 2 } },
            { tag: 'h3', attrs: { level: 3 } },
            { tag: 'h4', attrs: { level: 4 } },
            { tag: 'h5', attrs: { level: 5 } },
            { tag: 'h6', attrs: { level: 6 } },
        ],
        toDOM(node) { return [`h${node.attrs.level}`, 0] },
    } as NodeSpec,

    code_block: {
        content: 'text*',
        marks: '',
        group: 'block',
        code: true,
        defining: true,
        parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
        toDOM() { return preDOM },
    } as NodeSpec,

    text: {
        group: 'inline',
    } as NodeSpec,

    image: {
        inline: false,
        attrs: {
            src: {},
            alt: { default: null },
            title: { default: null },
            fileId: { default: null },
            workspaceId: { default: null },
            width: { default: null },
            alignment: { default: 'left' },
            textWrap: { default: 'none' },
            revisedPrompt: { default: null },
            responseId: { default: null },
            aiModel: { default: null },
            isPartial: { default: false },
        },
        group: 'block',
        draggable: true,
        parseDOM: [
            {
                tag: 'figure.pm-image-wrapper',
                getAttrs(dom: HTMLElement) {
                    const img = dom.querySelector('img')
                    if (!img) return false
                    return {
                        src: img.getAttribute('src'),
                        title: img.getAttribute('title'),
                        alt: img.getAttribute('alt'),
                        fileId: img.getAttribute('data-file-id'),
                        workspaceId: img.getAttribute('data-workspace-id'),
                        width: dom.getAttribute('data-width'),
                        alignment: dom.getAttribute('data-alignment') || 'center',
                        textWrap: dom.getAttribute('data-text-wrap') || 'none',
                    }
                },
            },
            {
                tag: 'img[src]',
                getAttrs(dom: HTMLElement) {
                    return {
                        src: dom.getAttribute('src'),
                        title: dom.getAttribute('title'),
                        alt: dom.getAttribute('alt'),
                        fileId: dom.getAttribute('data-file-id'),
                        workspaceId: dom.getAttribute('data-workspace-id'),
                        width: null,
                        alignment: 'center',
                        textWrap: 'none',
                    }
                },
            },
        ],
        toDOM(node) {
            const { src, alt, title, fileId, workspaceId, width, alignment, textWrap } = node.attrs
            const imgAttrs: Record<string, string> = { src }
            if (alt) imgAttrs.alt = alt
            if (title) imgAttrs.title = title
            if (fileId) imgAttrs['data-file-id'] = fileId
            if (workspaceId) imgAttrs['data-workspace-id'] = workspaceId

            const figureAttrs: Record<string, string> = {
                class: `pm-image-wrapper pm-image-align-${alignment} pm-image-wrap-${textWrap}`,
            }
            if (width) {
                figureAttrs['data-width'] = width
                figureAttrs.style = `width: ${width}`
            }
            figureAttrs['data-alignment'] = alignment
            figureAttrs['data-text-wrap'] = textWrap

            return ['figure', figureAttrs, ['img', imgAttrs]]
        },
    } as NodeSpec,

    hard_break: {
        inline: true,
        group: 'inline',
        selectable: false,
        parseDOM: [{ tag: 'br' }],
        toDOM() { return brDOM },
    } as NodeSpec,

    feature_reference: {
        inline: true,
        atom: true,
        group: 'inline',
        attrs: {
            featureId: { default: '' },
            featureName: { default: '' },
            category: { default: '' },
        },
        parseDOM: [{
            tag: 'span[data-feature-id]',
            getAttrs(dom: HTMLElement) {
                return {
                    featureId: dom.getAttribute('data-feature-id') ?? '',
                    featureName: dom.getAttribute('data-feature-name') ?? '',
                    category: dom.getAttribute('data-feature-category') ?? '',
                }
            },
        }],
        toDOM(node) {
            return ['span', {
                'data-feature-id': node.attrs.featureId,
                'data-feature-name': node.attrs.featureName,
                'data-feature-category': node.attrs.category,
                class: `feature-reference-chip feature-reference-chip-${node.attrs.category || 'default'}`,
            },
                ['span', { class: 'feature-reference-chip-prefix' }, 'feature:'],
                ['span', { class: 'feature-reference-chip-name' }, node.attrs.featureName],
            ]
        },
    } as NodeSpec,
}

const emDOM: DOMOutputSpec = ['em', 0]
const strongDOM: DOMOutputSpec = ['strong', 0]
const codeDOM: DOMOutputSpec = ['code', 0]
const strikethroughDOM: DOMOutputSpec = ['s', 0]

export const marks = {
    link: {
        attrs: {
            href: {},
            title: { default: null },
        },
        inclusive: false,
        parseDOM: [{
            tag: 'a[href]',
            getAttrs(dom: HTMLElement) {
                return { href: dom.getAttribute('href'), title: dom.getAttribute('title') }
            },
        }],
        toDOM(node) {
            const { href, title } = node.attrs
            return ['a', { href, title }, 0]
        },
    } as MarkSpec,

    em: {
        parseDOM: [
            { tag: 'i' },
            { tag: 'em' },
            { style: 'font-style=italic' },
            { style: 'font-style=normal', clearMark: m => m.type.name === 'em' },
        ],
        toDOM() { return emDOM },
    } as MarkSpec,

    strikethrough: {
        parseDOM: [
            { tag: 's' },
            { tag: 'strikethrough' },
            { style: 'font-style=strikethrough' },
            { style: 'font-style=normal', clearMark: m => m.type.name === 'strikethrough' },
        ],
        toDOM() { return strikethroughDOM },
    } as MarkSpec,

    strong: {
        parseDOM: [
            { tag: 'strong' },
            { tag: 'b', getAttrs: (node: HTMLElement) => node.style.fontWeight !== 'normal' && null },
            { style: 'font-weight=400', clearMark: m => m.type.name === 'strong' },
            { style: 'font-weight', getAttrs: (value: string) => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null },
        ],
        toDOM() { return strongDOM },
    } as MarkSpec,

    code: {
        parseDOM: [{ tag: 'code' }],
        toDOM() { return codeDOM },
    } as MarkSpec,
}

export const schema = new Schema({ nodes, marks })
