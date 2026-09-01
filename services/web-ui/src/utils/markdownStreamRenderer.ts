'use strict'

import { MarkdownStreamParser } from '@lixpi/markdown-stream-parser'
import type { MarkdownStreamToken } from '@lixpi/constants'
import { html } from '@lixpi/ui-primitives/dom'

// Unified, framework-agnostic renderer that turns a markdown token stream into plain DOM
// using the app's @lixpi/markdown-stream-parser.
//
// RULE: this is the ONLY way non-editable markdown may be rendered in the web UI. Editable
// markdown in ProseMirror is handled by the aiChatThreadPlugin (StreamingInserter); every
// other place that shows markdown — extraction tab, Media Library, future surfaces — MUST
// use this class (or renderMarkdownStatic). Never hand-roll markdown→HTML and never render
// raw markdown as plain text. See documentation/conventions/MARKDOWN-RENDERING.md.
//
// The emitted token shape (MarkdownStreamToken) lives in @lixpi/constants — type ∈
// 'paragraph' | 'header' | 'code' and styles ⊆ 'bold' | 'italic' | 'strikethrough' | 'code'.
// NOTE: it is centralized in @lixpi/constants only because the published parser version does
// not export its segment types. A newer @lixpi/markdown-stream-parser that exports proper types
// is in development — once it ships, import the token type from the package instead.

function wrapInline(child: Node, style: string): Node {
    if (style === 'bold') {
        const el = html`<strong></strong>` as HTMLElement
        el.appendChild(child)
        return el
    }
    if (style === 'italic') {
        const el = html`<em></em>` as HTMLElement
        el.appendChild(child)
        return el
    }
    if (style === 'strikethrough') {
        const el = html`<del></del>` as HTMLElement
        el.appendChild(child)
        return el
    }
    if (style === 'code') {
        const el = html`<code className="lixpi-md-code-inline"></code>` as HTMLElement
        el.appendChild(child)
        return el
    }
    return child
}

// Wraps the text node from inner to outer so the outermost element is bold.
function styledTextNode(text: string, styles: string[], blockType: string): Node {
    if (blockType === 'code') return document.createTextNode(text)
    let node: Node = document.createTextNode(text)
    if (styles.includes('code')) node = wrapInline(node, 'code')
    if (styles.includes('strikethrough')) node = wrapInline(node, 'strikethrough')
    if (styles.includes('italic')) node = wrapInline(node, 'italic')
    if (styles.includes('bold')) node = wrapInline(node, 'bold')
    return node
}

function createBlock(type: string, level: number | undefined): HTMLElement {
    if (type === 'header') {
        const lvl = Math.min(Math.max(level ?? 3, 1), 6)
        return html`<div className=${`lixpi-md-heading lixpi-md-h${lvl}`}></div>` as HTMLElement
    }
    if (type === 'code') return html`<pre className="lixpi-md-pre"><code></code></pre>` as HTMLElement
    return html`<p className="lixpi-md-paragraph"></p>` as HTMLElement
}

export class MarkdownStreamRenderer {
    readonly contentEl: HTMLElement
    private readonly instanceId: string
    private parser: ReturnType<typeof MarkdownStreamParser.getInstance>
    private unsubscribe: (() => void) | null = null
    private currentBlock: HTMLElement | null = null
    private currentType: string | null = null

    constructor(instanceId: string, className = 'lixpi-markdown') {
        this.instanceId = instanceId
        this.contentEl = html`<div className=${className}></div>` as HTMLElement
        this.parser = MarkdownStreamParser.getInstance(instanceId)
        this.unsubscribe = this.parser.subscribeToTokenParse((parsed: MarkdownStreamToken) => this.handleSegment(parsed))
        this.parser.startParsing()
    }

    push(text: string): void {
        if (!text) return
        this.parser.parseToken(text)
    }

    // Flushes any buffered block and tears down the parser. The END_STREAM segment from
    // stopParsing triggers cleanup() so the final block renders whether the parser emits
    // synchronously or asynchronously.
    finalize(): void {
        try {
            this.parser.stopParsing()
        } catch {}
    }

    private cleanup(): void {
        this.unsubscribe?.()
        this.unsubscribe = null
        try {
            MarkdownStreamParser.removeInstance(this.instanceId)
        } catch {}
    }

    private handleSegment(parsed: MarkdownStreamToken): void {
        if (!parsed) return
        if (parsed.status === 'END_STREAM') {
            this.cleanup()
            return
        }
        const seg = parsed.segment
        if (!seg) return
        const type = seg.type ?? 'paragraph'
        const text = seg.segment ?? ''
        const styles = seg.styles ?? []
        if (seg.isBlockDefining || !this.currentBlock || type !== this.currentType) {
            this.currentBlock = createBlock(type, seg.level)
            this.currentType = type
            this.contentEl.appendChild(this.currentBlock)
        }
        if (!text) return
        const target = type === 'code'
            ? (this.currentBlock.querySelector('code') ?? this.currentBlock)
            : this.currentBlock
        target.appendChild(styledTextNode(text, styles, type))
    }
}

let staticRenderCounter = 0

// One-shot render of a complete markdown string into a fresh element.
export function renderMarkdownStatic(text: string, idBase: string, className = 'lixpi-markdown'): HTMLElement {
    const renderer = new MarkdownStreamRenderer(`${idBase}:static:${staticRenderCounter++}`, className)
    renderer.push(text)
    renderer.finalize()
    return renderer.contentEl
}
