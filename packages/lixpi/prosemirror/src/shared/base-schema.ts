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
            assetId: { default: null },
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
                        assetId: img.getAttribute('data-asset-id'),
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
                        assetId: dom.getAttribute('data-asset-id'),
                        width: null,
                        alignment: 'center',
                        textWrap: 'none',
                    }
                },
            },
        ],
        toDOM(node) {
            const { src, alt, assetId, width, alignment, textWrap } = node.attrs
            const imgAttrs: Record<string, string> = { src }
            if (alt) imgAttrs.alt = alt
            if (assetId) imgAttrs['data-asset-id'] = assetId

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

    prompt_reference: {
        inline: true,
        atom: true,
        selectable: false,
        group: 'inline',
        attrs: {
            referenceType: { default: 'skill' },
            assetId: { default: '' },
            nodeId: { default: '' },
            mediaKind: { default: '' },
            moduleId: { default: '' },
            capabilityId: { default: '' },
            artifactTypeId: { default: '' },
            displayName: { default: '' },
        },
        parseDOM: [{
            tag: 'span[data-prompt-reference-type]',
            getAttrs(dom: HTMLElement) {
                return {
                    referenceType: dom.getAttribute('data-prompt-reference-type') ?? 'skill',
                    assetId: dom.getAttribute('data-asset-id') ?? '',
                    nodeId: dom.getAttribute('data-node-id') ?? '',
                    mediaKind: dom.getAttribute('data-media-kind') ?? '',
                    moduleId: dom.getAttribute('data-module-id') ?? '',
                    capabilityId: dom.getAttribute('data-capability-id') ?? '',
                    artifactTypeId: dom.getAttribute('data-artifact-type-id') ?? '',
                    displayName: dom.getAttribute('data-prompt-reference-display-name') ?? '',
                }
            },
        }],
        toDOM(node) {
            const referenceType = ['media', 'capability-artifact', 'capability-module', 'tool', 'skill'].includes(node.attrs.referenceType)
                ? node.attrs.referenceType
                : 'skill'
            return ['span', {
                'data-prompt-reference-type': referenceType,
                'data-asset-id': node.attrs.assetId,
                'data-node-id': node.attrs.nodeId,
                'data-media-kind': node.attrs.mediaKind,
                'data-module-id': node.attrs.moduleId,
                'data-capability-id': node.attrs.capabilityId,
                'data-artifact-type-id': node.attrs.artifactTypeId,
                'data-prompt-reference-display-name': node.attrs.displayName,
                class: `prompt-reference-chip prompt-reference-chip-${referenceType}`,
            },
                ['span', { class: 'prompt-reference-chip-name' }, node.attrs.displayName],
            ]
        },
    } as NodeSpec,

    // Read-only compatibility for persisted drafts and conversation snapshots
    // written before prompt_reference replaced the Tool/Skill-only atom. New
    // editors never create this node type, but keeping it in schema v1 prevents
    // old documents from becoming unparseable.
    capability_reference: {
        inline: true,
        atom: true,
        selectable: false,
        group: 'inline',
        attrs: {
            capabilityId: { default: '' },
            kind: { default: 'skill' },
            displayName: { default: '' },
        },
        parseDOM: [{
            tag: 'span[data-capability-id]',
            getAttrs(dom: HTMLElement) {
                return {
                    capabilityId: dom.getAttribute('data-capability-id') ?? '',
                    kind: dom.getAttribute('data-capability-kind') === 'tool' ? 'tool' : 'skill',
                    displayName: dom.getAttribute('data-capability-display-name') ?? '',
                }
            },
        }],
        toDOM(node) {
            const kind = node.attrs.kind === 'tool' ? 'tool' : 'skill'
            return ['span', {
                'data-capability-id': node.attrs.capabilityId,
                'data-capability-kind': kind,
                'data-capability-display-name': node.attrs.displayName,
                class: `prompt-reference-chip prompt-reference-chip-${kind}`,
            },
                ['span', { class: 'prompt-reference-chip-name' }, node.attrs.displayName],
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
            const { href } = node.attrs
            return ['a', { href }, 0]
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
