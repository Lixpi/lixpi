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

    const handleSummaryMouseDown = (event: MouseEvent) => {
        // Prevent the parent thread's mousedown focus handler from stealing the interaction.
        event.preventDefault()
        event.stopPropagation()
    }

    const handleSummaryClick = (event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()

        const pos = getPos()
        if (pos === undefined) return

        const newOpen = !wrapper.open
        wrapper.open = newOpen

        const tr = view.state.tr.setNodeMarkup(pos, undefined, {
            ...view.state.doc.nodeAt(pos)?.attrs,
            isOpen: newOpen,
        })
        view.dispatch(tr)
    }

    summary.textContent = node.attrs.isStreaming
        ? 'Preparing image generation prompt'
        : node.attrs.title

    if (node.attrs.isOpen) {
        wrapper.open = true
    }

    summary.addEventListener('mousedown', handleSummaryMouseDown)
    summary.addEventListener('click', handleSummaryClick)

    return {
        dom: wrapper,
        contentDOM: contentDom,
        stopEvent(event: Event) {
            return event.target === summary || summary.contains(event.target as Node)
        },
        ignoreMutation(mutation: MutationRecord) {
            return mutation.type === 'attributes'
                && mutation.attributeName === 'open'
                && mutation.target === wrapper
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
        destroy() {
            summary.removeEventListener('mousedown', handleSummaryMouseDown)
            summary.removeEventListener('click', handleSummaryClick)
        },
    }
}
