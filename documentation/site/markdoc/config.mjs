// Markdoc transform config for the Lixpi docs site.
//
// Keep this dependency-light: the only import is @markdoc/markdoc itself. Every
// custom node/tag must render to a plain HTML tag name (a string) because the
// build uses Markdoc's built-in HTML renderer (Markdoc.renderers.html), which
// has no concept of React/Svelte components.

import Markdoc from '@markdoc/markdoc'

const { Tag } = Markdoc

// Rewrite intra-doc links from authoring form (.md) to rendered form (.html).
// Leaves external links (scheme present), pure anchors, and non-.md targets
// untouched. Kept relative so links work both on GitHub and in the built site.
export function rewriteHref(href) {
    if (!href) return href
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return href // http:, https:, mailto:, etc.
    if (href.startsWith('#')) return href
    return href.replace(/\.md(#.*)?$/i, '.html$1')
}

// <a> — same as the default link node, but with .md -> .html rewriting.
const link = {
    render: 'a',
    attributes: {
        href: { type: String },
        title: { type: String },
    },
    transform(node, config) {
        const attributes = node.transformAttributes(config)
        const children = node.transformChildren(config)
        return new Tag('a', { ...attributes, href: rewriteHref(attributes.href) }, children)
    },
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

export function createConfig() {
    return {
        nodes: { link, fence },
        tags: { callout },
        variables: {},
    }
}
