import { html } from '$src/utils/domTemplates.ts'

export const aiCollapsibleBlockNodeType = 'aiCollapsibleBlock'

export const aiCollapsibleBlockNodeSpec = {
    attrs: {
        title: { default: 'Image generation prompt' },
        isOpen: { default: false },
        isStreaming: { default: true },
    },
    content: '(paragraph | block)*',
    group: 'block',
    draggable: false,
    parseDOM: [
        {
            tag: 'details.ai-collapsible-block',
            getAttrs(dom: HTMLDetailsElement) {
                const summary = dom.querySelector('summary')
                return {
                    title: summary?.textContent || 'Image generation prompt',
                    isOpen: dom.open,
                    isStreaming: false,
                }
            },
        },
    ],
    toDOM(node: any) {
        return [
            'details',
            {
                class: `ai-collapsible-block${node.attrs.isStreaming ? ' is-streaming' : ''}`,
                ...(node.attrs.isOpen ? { open: 'true' } : {}),
            },
            ['summary', {}, node.attrs.isStreaming ? 'Preparing image generation prompt' : node.attrs.title],
            ['div', { class: 'ai-collapsible-block-content' }, 0],
        ]
    },
}

export const aiCollapsibleBlockNodeView = (node: any, view: any, getPos: () => number | undefined) => {
    const wrapper = html`
        <details className="ai-collapsible-block${node.attrs.isStreaming ? ' is-streaming' : ''}">
            <summary></summary>
            <div className="ai-collapsible-block-content"></div>
        </details>
    ` as HTMLDetailsElement

    const summary = wrapper.querySelector('summary')!
    const contentDom = wrapper.querySelector('.ai-collapsible-block-content')!

    summary.textContent = node.attrs.isStreaming
        ? 'Preparing image generation prompt'
        : node.attrs.title

    if (node.attrs.isOpen) {
        wrapper.open = true
    }

    // Toggle open state on click — native <details> toggle is blocked by ProseMirror
    summary.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault()
        const pos = getPos()
        if (pos === undefined) return

        const newOpen = !wrapper.open
        wrapper.open = newOpen

        // Sync the isOpen attr back to the ProseMirror node
        const tr = view.state.tr.setNodeMarkup(pos, undefined, {
            ...view.state.doc.nodeAt(pos)?.attrs,
            isOpen: newOpen,
        })
        view.dispatch(tr)
    })

    return {
        dom: wrapper,
        contentDOM: contentDom,
        stopEvent(event: Event) {
            // Let clicks on summary through so the toggle handler works
            return event.target === summary || summary.contains(event.target as Node)
        },
        update(updatedNode: any) {
            if (updatedNode.type.name !== aiCollapsibleBlockNodeType) return false

            summary.textContent = updatedNode.attrs.isStreaming
                ? 'Preparing image generation prompt'
                : updatedNode.attrs.title

            if (updatedNode.attrs.isStreaming) {
                wrapper.classList.add('is-streaming')
            } else {
                wrapper.classList.remove('is-streaming')
            }

            wrapper.open = !!updatedNode.attrs.isOpen

            return true
        },
    }
}
