// Markdoc transform config for the Lixpi docs site.
//
// Keep this dependency-light: the only import is @markdoc/markdoc itself. Every
// custom node/tag must render to a plain HTML tag name (a string) because the
// build uses Markdoc's built-in HTML renderer (Markdoc.renderers.html), which
// has no concept of client UI components.

import Markdoc from '@markdoc/markdoc'

const { Tag } = Markdoc

function textFromChildren(children = []) {
    return children.map((child) => {
        if (typeof child === 'string') return child
        if (child?.attributes?.content) return child.attributes.content
        if (child?.children) return textFromChildren(child.children)
        return ''
    }).join('')
}

export function slugifyHeading(value) {
    return String(value)
        .trim()
        .toLowerCase()
        .replace(/[`*_~[\](){}:;"'.,!?]/g, '')
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

export function createHeadingIdFactory() {
    const seen = new Map()

    return (text) => {
        const base = slugifyHeading(text) || 'section'
        const count = seen.get(base) || 0
        seen.set(base, count + 1)
        return count === 0 ? base : `${base}-${count}`
    }
}

// Validation and rendering use the same source-aware resolver.
function createLink(resolve) {
    return {
        render: 'a',
        attributes: { href: { type: String }, title: { type: String } },
        transform(node, config) {
            const attributes = node.transformAttributes(config)
            return new Tag('a', { ...attributes, href: resolve(attributes.href) }, node.transformChildren(config))
        },
    }
}

function createImage(resolve) {
    return {
        ...Markdoc.nodes.image,
        transform(node, config) {
            const attributes = node.transformAttributes(config)
            return new Tag('img', { ...attributes, src: resolve(attributes.src) })
        },
    }
}

export function collectHeadingIds(ast) {
    const headingId = createHeadingIdFactory()
    const ids = new Set()
    for (const node of ast.walk()) {
        if (node.type === 'heading') ids.add(headingId(textFromChildren(node.children)))
    }
    return ids
}

function createHeading() {
    const headingId = createHeadingIdFactory()

    return {
        attributes: {
            level: { type: Number, required: true },
        },
        transform(node, config) {
            const attributes = node.transformAttributes(config)
            const children = node.transformChildren(config)
            const level = Math.min(Math.max(Number(attributes.level) || 2, 1), 6)
            return new Tag(`h${level}`, { id: headingId(textFromChildren(children)) }, children)
        },
    }
}

// Fenced code blocks. Mermaid blocks are passed through as a placeholder
// (`<pre class="mermaid">`) so a future step can hydrate them client-side;
// every other language renders as a normal highlighted-ready code block.
const fence = {
    attributes: {
        content: { type: String, render: false, required: true },
        language: { type: String, render: false },
        process: { type: Boolean, render: false, default: false },
    },
    transform(node) {
        const content = typeof node.attributes.content === 'string' ? node.attributes.content : ''
        const language = node.attributes.language || ''

        if (language === 'mermaid') {
            return new Tag('pre', { class: 'mermaid', 'data-diagram': 'mermaid' }, [content])
        }

        const codeAttributes = language ? { class: `language-${language}` } : {}
        return new Tag('pre', { class: 'code-block', 'data-language': language }, [
            new Tag('code', codeAttributes, [content]),
        ])
    },
}

// {% callout type="note|warning|important|tip" title="..." %} ... {% /callout %}
// Replaces the heavy "> ⚠️ **CRITICAL**" blockquote convention with a real,
// styleable block. Plain blockquotes still render as <blockquote> fallback.
const callout = {
    render: 'div',
    children: ['paragraph', 'list', 'fence', 'heading', 'table', 'tag'],
    attributes: {
        type: { type: String, default: 'note', matches: ['note', 'warning', 'important', 'tip'] },
        title: { type: String },
    },
    transform(node, config) {
        const attributes = node.transformAttributes(config)
        const children = node.transformChildren(config)
        const type = attributes.type || 'note'

        const body = []
        if (attributes.title) {
            body.push(new Tag('p', { class: 'callout-title' }, [attributes.title]))
        }
        body.push(...children)

        return new Tag('div', { class: `callout callout-${type}`, role: 'note' }, body)
    },
}

export function createConfig({ sources, source }) {
    const resolve = href => sources.resolve(source, href)

    return {
        nodes: { link: createLink(resolve), image: createImage(resolve), fence, heading: createHeading() },
        tags: { callout },
        variables: {},
    }
}
