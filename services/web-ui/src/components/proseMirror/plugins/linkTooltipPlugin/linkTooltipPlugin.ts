import { Plugin, PluginKey } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
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
    private tooltipParent: HTMLElement | null = null

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

        // Append to editor's parent so tooltip scales with transformed viewport
        this.tooltipParent = view.dom.parentNode as HTMLElement
        this.tooltipParent?.appendChild(this.tooltip)

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

    private findTransformedAncestor(): { element: HTMLElement; scale: number } | null {
        let current: HTMLElement | null = this.tooltipParent
        while (current) {
            const style = getComputedStyle(current)
            const transform = style.transform
            if (transform && transform !== 'none') {
                const match = transform.match(/matrix\(([^,]+),/)
                if (match) {
                    return { element: current, scale: parseFloat(match[1]) }
                }
            }
            current = current.parentElement
        }
        return null
    }

    private screenToLocal(screenX: number, screenY: number): { x: number; y: number } {
        if (!this.tooltipParent) {
            return { x: screenX, y: screenY }
        }

        const parentRect = this.tooltipParent.getBoundingClientRect()
        const transformInfo = this.findTransformedAncestor()
        const scale = transformInfo?.scale ?? 1

        const localX = (screenX - parentRect.left) / scale
        const localY = (screenY - parentRect.top) / scale

        return { x: localX, y: localY }
    }

    private getScale(): number {
        const transformInfo = this.findTransformedAncestor()
        return transformInfo?.scale ?? 1
    }

    private show(anchor: HTMLElement): void {
        const urlEl = this.tooltip.querySelector('.link-tooltip-url') as HTMLAnchorElement
        if (urlEl) {
            urlEl.href = this.currentHref
            urlEl.textContent = this.currentHref
        }

        this.tooltip.style.visibility = 'hidden'
        this.tooltip.style.display = 'block'
        this.tooltip.classList.add('is-visible')

        const scale = this.getScale()
        const anchorRect = anchor.getBoundingClientRect()
        const tooltipRect = this.tooltip.getBoundingClientRect()
        const tooltipWidthLocal = tooltipRect.width / scale

        // Position below the anchor, centered (in screen coords)
        const anchorCenterX = anchorRect.left + anchorRect.width / 2
        const tooltipScreenLeft = anchorCenterX - tooltipRect.width / 2
        const tooltipScreenTop = anchorRect.bottom + 6 * scale

        const local = this.screenToLocal(tooltipScreenLeft, tooltipScreenTop)

        // Clamp to parent bounds
        const parentRect = this.tooltipParent?.getBoundingClientRect()
        const parentWidthLocal = parentRect ? parentRect.width / scale : window.innerWidth
        const maxLeft = parentWidthLocal - tooltipWidthLocal - 8
        const clampedLeft = Math.max(8, Math.min(local.x, maxLeft))

        Object.assign(this.tooltip.style, {
            left: `${clampedLeft}px`,
            top: `${local.y}px`,
            visibility: 'visible',
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
