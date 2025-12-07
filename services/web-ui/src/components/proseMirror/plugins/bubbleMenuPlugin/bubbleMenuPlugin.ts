import { Plugin, PluginKey } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { computePosition, inline, flip, shift, offset, hide, type VirtualElement } from '@floating-ui/dom'
import { createEl } from '../../components/domTemplates.ts'
import { buildBubbleMenuItems } from './bubbleMenuItems.ts'
import { documentTitleNodeType } from '../../customNodes/documentTitleNode.js'

export const bubbleMenuPluginKey = new PluginKey('bubbleMenu')

const isTouchDevice = (): boolean => 'ontouchstart' in window || navigator.maxTouchPoints > 0

type BubbleMenuViewOptions = {
    view: EditorView
}

class BubbleMenuView {
    private view: EditorView
    private menu: HTMLElement
    private preventHide = false
    private updateDebounceTimer: ReturnType<typeof setTimeout> | null = null
    private readonly debounceDelay: number
    private linkInputPanel: HTMLElement | null = null
    private isLinkInputActive = false
    private isSelecting = false
    private dropdownUpdaters: Array<() => void> = []

    constructor({ view }: BubbleMenuViewOptions) {
        this.view = view
        this.debounceDelay = isTouchDevice() ? 350 : 200

        this.menu = createEl('div', {
            className: 'bubble-menu',
            role: 'toolbar',
            'aria-label': 'Text formatting',
            tabIndex: 0,
            style: {
                position: 'absolute',
                visibility: 'hidden',
                zIndex: '100',
            },
        })

        this.buildMenu()

        this.menu.addEventListener('mousedown', this.handleMenuMouseDown)

        // Track selection state
        view.dom.addEventListener('mousedown', this.handleEditorMouseDown)
        view.dom.addEventListener('touchstart', this.handleEditorTouchStart)
        document.addEventListener('mouseup', this.handleDocumentMouseUp)
        document.addEventListener('touchend', this.handleDocumentTouchEnd)

        view.dom.parentNode?.appendChild(this.menu)

        if (isTouchDevice()) {
            window.visualViewport?.addEventListener('resize', this.handleViewportResize)
        }
    }

    private buildMenu(): void {
        const { items, linkInputPanel, dropdownUpdaters } = buildBubbleMenuItems(this.view, this)
        this.linkInputPanel = linkInputPanel
        this.dropdownUpdaters = dropdownUpdaters

        const menuContent = createEl('div', { className: 'bubble-menu-content' })

        items.forEach((item: HTMLElement) => {
            menuContent.appendChild(item)
        })

        this.menu.appendChild(menuContent)

        if (this.linkInputPanel) {
            this.menu.appendChild(this.linkInputPanel)
        }
    }

    private handleMenuMouseDown = (event: MouseEvent): void => {
        this.preventHide = true

        const target = event.target as HTMLElement
        if (target.closest('.bubble-menu-button') || target.closest('.bubble-menu-dropdown')) {
            event.preventDefault()
        }
    }

    private handleEditorMouseDown = (): void => {
        this.isSelecting = true
        this.hide()
    }

    private handleEditorTouchStart = (): void => {
        this.isSelecting = true
    }

    private handleDocumentMouseUp = (): void => {
        if (this.isSelecting) {
            this.isSelecting = false
            // Small delay to let the selection settle
            setTimeout(() => this.showIfNeeded(), 10)
        }
    }

    private handleDocumentTouchEnd = (): void => {
        if (this.isSelecting) {
            this.isSelecting = false
            // Longer delay for touch to let selection handles settle
            setTimeout(() => this.showIfNeeded(), 100)
        }
    }

    private showIfNeeded(): void {
        if (this.shouldShow() && !this.isSelecting) {
            this.show()
            this.updateMenuState()
            this.updatePosition()
        }
    }

    private handleViewportResize = (): void => {
        if (this.shouldShow()) {
            this.updatePosition()
        }
    }

    private shouldShow(): boolean {
        const { state } = this.view
        const { selection } = state
        const { empty } = selection

        if (!this.view.hasFocus()) return false
        if (empty) return false
        if (!this.view.editable) return false

        const { $from, $to } = selection
        const isCodeBlock = $from.parent.type.name === 'code_block' || $to.parent.type.name === 'code_block'
        if (isCodeBlock) return false

        const isDocumentTitle = $from.parent.type.name === documentTitleNodeType || $to.parent.type.name === documentTitleNodeType
        if (isDocumentTitle) return false

        return true
    }

    private createVirtualElement(): VirtualElement {
        const { state } = this.view
        const { from, to } = state.selection

        return {
            getBoundingClientRect: () => {
                const start = this.view.coordsAtPos(from)
                const end = this.view.coordsAtPos(to)

                const left = Math.min(start.left, end.left)
                const right = Math.max(start.right, end.right)
                const top = Math.min(start.top, end.top)
                const bottom = Math.max(start.bottom, end.bottom)

                return {
                    x: left,
                    y: top,
                    top,
                    left,
                    bottom,
                    right,
                    width: right - left,
                    height: bottom - top,
                }
            },
            getClientRects: () => {
                const { from, to } = this.view.state.selection
                const rects: DOMRect[] = []

                this.view.state.doc.nodesBetween(from, to, (node: ProseMirrorNode, pos: number) => {
                    if (node.isText) {
                        const start = Math.max(from, pos)
                        const end = Math.min(to, pos + node.nodeSize)
                        const startCoords = this.view.coordsAtPos(start)
                        const endCoords = this.view.coordsAtPos(end)

                        rects.push(
                            new DOMRect(
                                startCoords.left,
                                startCoords.top,
                                endCoords.right - startCoords.left,
                                endCoords.bottom - startCoords.top
                            )
                        )
                    }
                    return true
                })

                return rects
            },
        }
    }

    private async updatePosition(): Promise<void> {
        const virtualElement = this.createVirtualElement()

        const { x, y, middlewareData } = await computePosition(virtualElement, this.menu, {
            placement: 'top',
            middleware: [
                inline(),
                offset(8),
                flip({ fallbackPlacements: ['bottom', 'top-start', 'bottom-start'] }),
                shift({ padding: 8 }),
                hide(),
            ],
        })

        const isHidden = middlewareData.hide?.referenceHidden

        Object.assign(this.menu.style, {
            left: `${x}px`,
            top: `${y}px`,
            visibility: isHidden ? 'hidden' : 'visible',
        })
    }

    update(): void {
        // Don't show while user is actively selecting
        if (this.isSelecting) {
            return
        }

        const wasVisible = this.menu.classList.contains('is-visible')

        if (this.preventHide) {
            this.preventHide = false
            this.updateMenuState()
            return
        }

        if (this.isLinkInputActive) {
            return
        }

        const shouldBeVisible = this.shouldShow()

        if (shouldBeVisible && !wasVisible) {
            // Show immediately without delay
            this.show()
            this.updateMenuState()
            this.updatePosition()
        } else if (shouldBeVisible && wasVisible) {
            // Debounce position updates while visible (for selection handle dragging)
            if (this.updateDebounceTimer) {
                clearTimeout(this.updateDebounceTimer)
            }
            this.updateDebounceTimer = setTimeout(() => {
                this.updateMenuState()
                this.updatePosition()
            }, this.debounceDelay)
        } else if (!shouldBeVisible) {
            this.hide()
        }
    }



    private updateMenuState(): void {
        // Update mark button states
        const buttons = this.menu.querySelectorAll('.bubble-menu-button')
        buttons.forEach((button) => {
            const updateFn = (button as HTMLElement).dataset.update
            if (updateFn) {
                const isActive = this.checkMarkActive((button as HTMLElement).dataset.markType || '')
                button.classList.toggle('is-active', isActive)
            }
        })

        // Update dropdown labels
        this.dropdownUpdaters.forEach((update) => update())
    }

    private checkMarkActive(markType: string): boolean {
        const { state } = this.view
        const { from, $from, to, empty } = state.selection
        const type = state.schema.marks[markType]
        if (!type) return false

        if (empty) {
            return !!type.isInSet(state.storedMarks || $from.marks())
        }

        return state.doc.rangeHasMark(from, to, type)
    }

    private show(): void {
        this.menu.style.visibility = 'visible'
        this.menu.classList.add('is-visible')
    }

    private hide(): void {
        this.menu.style.visibility = 'hidden'
        this.menu.classList.remove('is-visible')
        this.closeLinkInput()
    }

    showLinkInput(): void {
        this.isLinkInputActive = true
        if (this.linkInputPanel) {
            this.linkInputPanel.classList.add('is-active')
            const input = this.linkInputPanel.querySelector('input') as HTMLInputElement
            if (input) {
                const { state } = this.view
                const { from, to } = state.selection
                const linkMark = state.schema.marks.link
                let existingHref = ''

                state.doc.nodesBetween(from, to, (node: ProseMirrorNode) => {
                    const mark = linkMark.isInSet(node.marks)
                    if (mark) {
                        existingHref = mark.attrs.href || ''
                    }
                })

                input.value = existingHref
                setTimeout(() => input.focus(), 0)
            }
        }
    }

    closeLinkInput(): void {
        this.isLinkInputActive = false
        if (this.linkInputPanel) {
            this.linkInputPanel.classList.remove('is-active')
        }
    }

    applyLink(href: string): void {
        const { state, dispatch } = this.view
        const { from, to } = state.selection
        const linkMark = state.schema.marks.link

        if (!href.trim()) {
            dispatch(state.tr.removeMark(from, to, linkMark))
        } else {
            const normalizedHref = href.startsWith('http://') || href.startsWith('https://') ? href : `https://${href}`
            dispatch(state.tr.addMark(from, to, linkMark.create({ href: normalizedHref })))
        }

        this.closeLinkInput()
        this.view.focus()
    }

    removeLink(): void {
        const { state, dispatch } = this.view
        const { from, to } = state.selection
        const linkMark = state.schema.marks.link
        dispatch(state.tr.removeMark(from, to, linkMark))
        this.closeLinkInput()
        this.view.focus()
    }

    destroy(): void {
        if (this.updateDebounceTimer) {
            clearTimeout(this.updateDebounceTimer)
        }

        this.view.dom.removeEventListener('mousedown', this.handleEditorMouseDown)
        this.view.dom.removeEventListener('touchstart', this.handleEditorTouchStart)
        document.removeEventListener('mouseup', this.handleDocumentMouseUp)
        document.removeEventListener('touchend', this.handleDocumentTouchEnd)
        window.visualViewport?.removeEventListener('resize', this.handleViewportResize)
        this.menu.removeEventListener('mousedown', this.handleMenuMouseDown)
        this.menu.remove()
    }
}

export function bubbleMenuPlugin(): Plugin {
    return new Plugin({
        key: bubbleMenuPluginKey,
        view(editorView: EditorView) {
            return new BubbleMenuView({ view: editorView })
        },
    })
}

export { BubbleMenuView }
