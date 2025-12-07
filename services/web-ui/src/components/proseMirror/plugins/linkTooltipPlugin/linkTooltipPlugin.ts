import { Plugin, PluginKey } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import type { Mark } from 'prosemirror-model'
import { computePosition, flip, shift, offset, hide, type VirtualElement } from '@floating-ui/dom'
import { createEl } from '../../components/domTemplates.ts'

export const linkTooltipPluginKey = new PluginKey('linkTooltip')

type LinkTooltipViewOptions = {
    view: EditorView
}

class LinkTooltipView {
    private view: EditorView
    private tooltip: HTMLElement
    private currentHref: string = ''
    private linkElement: HTMLElement | null = null

    constructor({ view }: LinkTooltipViewOptions) {
        this.view = view

        this.tooltip = createEl('div', {
            className: 'link-tooltip',
            style: {
                position: 'absolute',
                visibility: 'hidden',
                zIndex: '100',
            },
        })

        this.buildTooltip()

        view.dom.parentNode?.appendChild(this.tooltip)

        view.dom.addEventListener('click', this.handleClick)
        document.addEventListener('click', this.handleDocumentClick)
    }

    private buildTooltip(): void {
        const urlText = createEl('a', {
            className: 'link-tooltip-url',
            target: '_blank',
            rel: 'noopener noreferrer',
        })

        urlText.addEventListener('click', (e) => {
            e.stopPropagation()
            this.hide()
        })

        this.tooltip.appendChild(urlText)
    }

    private handleClick = (e: MouseEvent): void => {
        const target = e.target as HTMLElement
        const linkEl = target.closest('a')

        if (linkEl && this.view.dom.contains(linkEl)) {
            e.preventDefault()
            this.linkElement = linkEl
            this.currentHref = linkEl.getAttribute('href') || ''
            this.show(linkEl)
        }
    }

    private handleDocumentClick = (e: MouseEvent): void => {
        if (!this.tooltip.contains(e.target as Node) && !this.linkElement?.contains(e.target as Node)) {
            this.hide()
        }
    }

    private async show(anchor: HTMLElement): Promise<void> {
        const urlEl = this.tooltip.querySelector('.link-tooltip-url') as HTMLAnchorElement
        if (urlEl) {
            urlEl.href = this.currentHref
            urlEl.textContent = this.currentHref
        }

        this.tooltip.style.visibility = 'visible'
        this.tooltip.classList.add('is-visible')

        const virtualElement: VirtualElement = {
            getBoundingClientRect: () => anchor.getBoundingClientRect(),
        }

        const { x, y, middlewareData } = await computePosition(virtualElement, this.tooltip, {
            placement: 'bottom',
            middleware: [offset(6), flip({ fallbackPlacements: ['top', 'bottom-start', 'top-start'] }), shift({ padding: 8 }), hide()],
        })

        const isHidden = middlewareData.hide?.referenceHidden

        Object.assign(this.tooltip.style, {
            left: `${x}px`,
            top: `${y}px`,
            visibility: isHidden ? 'hidden' : 'visible',
        })
    }

    private hide(): void {
        this.tooltip.style.visibility = 'hidden'
        this.tooltip.classList.remove('is-visible')
        this.linkElement = null
        this.currentHref = ''
    }

    update(): void {
        // Close tooltip on any editor update if the link element is gone
        if (this.linkElement && !this.view.dom.contains(this.linkElement)) {
            this.hide()
        }
    }

    destroy(): void {
        this.view.dom.removeEventListener('click', this.handleClick)
        document.removeEventListener('click', this.handleDocumentClick)
        this.tooltip.remove()
    }
}

export function linkTooltipPlugin(): Plugin {
    return new Plugin({
        key: linkTooltipPluginKey,
        view(editorView: EditorView) {
            return new LinkTooltipView({ view: editorView })
        },
    })
}
