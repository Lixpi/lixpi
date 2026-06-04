// Markdoc transform config for the Lixpi docs site.
//
// Keep this dependency-light: the only import is @markdoc/markdoc itself. Every
// custom node/tag must render to a plain HTML tag name (a string) because the
// build uses Markdoc's built-in HTML renderer (Markdoc.renderers.html), which
// has no concept of React/Svelte components.

import Markdoc from '@markdoc/markdoc'
import path from 'node:path'

const { Tag } = Markdoc
const DEFAULT_REPO_BLOB_URL = 'https://github.com/Lixpi/lixpi/blob/main'

function textFromChildren(children = []) {
    return children.map((child) => {
        if (typeof child === 'string') return child
        if (child?.children) return textFromChildren(child.children)
        if (child?.attributes?.content) return child.attributes.content
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

// Rewrite links from authoring form to rendered-site form.
// - docs-to-docs links become relative .html links
// - links that escape documentation/ become explicit GitHub source links
// - external links, pure anchors, and non-.md targets are left alone
export function rewriteHref(href, pageRelMd = '', repoBlobUrl = DEFAULT_REPO_BLOB_URL) {
    if (!href) return href
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return href // http:, https:, mailto:, etc.
    if (href.startsWith('#')) return href

    const [target, fragment] = href.split('#')
    const suffix = fragment ? `#${fragment}` : ''
    const pageDir = pageRelMd ? path.posix.dirname(pageRelMd) : ''
    const resolvedFromDocs = pageRelMd
        ? path.posix.normalize(path.posix.join(pageDir, target))
        : target

    if (resolvedFromDocs.startsWith('..')) {
        const repoRel = path.posix.normalize(path.posix.join('documentation', pageDir, target))
        if (repoRel.startsWith('..')) return href
        return `${repoBlobUrl.replace(/\/$/, '')}/${repoRel}${suffix}`
    }

    return `${target.replace(/\.md$/i, '.html')}${suffix}`
}

// <a> — same as the default link node, but with .md -> .html rewriting.
function createLink(pageRelMd, repoBlobUrl) {
    return {
        render: 'a',
        attributes: {
            href: { type: String },
            title: { type: String },
        },
        transform(node, config) {
            const attributes = node.transformAttributes(config)
            const children = node.transformChildren(config)
            return new Tag('a', { ...attributes, href: rewriteHref(attributes.href, pageRelMd, repoBlobUrl) }, children)
        },
    }
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

export function createConfig(options = {}) {
    const { pageRelMd = '', repoBlobUrl = DEFAULT_REPO_BLOB_URL } = options

    return {
        nodes: { link: createLink(pageRelMd, repoBlobUrl), fence, heading: createHeading() },
        tags: { callout },
        variables: {},
    }
}
