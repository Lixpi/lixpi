import { Plugin, PluginKey, NodeSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { computePosition, inline, flip, shift, offset, hide, type VirtualElement } from '@floating-ui/dom'
import { createEl } from '../../components/domTemplates.ts'
import { buildBubbleMenuItems, getSelectionContext, updateImageButtonStates, type MenuItemElement, type SelectionContext } from './bubbleMenuItems.ts'
import { documentTitleNodeType } from '../../customNodes/documentTitleNode.js'

export const bubbleMenuPluginKey = new PluginKey('bubbleMenu')

const isTouchDevice = (): boolean => 'ontouchstart' in window || navigator.maxTouchPoints > 0

type BubbleMenuViewOptions = {
    view: EditorView
}

class BubbleMenuView {
    private view: EditorView
    private menu: HTMLElement
    private menuContent: HTMLElement
    private preventHide = false
    private updateDebounceTimer: ReturnType<typeof setTimeout> | null = null
    private readonly debounceDelay: number
    private linkInputPanel: HTMLElement | null = null
    private isLinkInputActive = false
    private isSelecting = false
    private menuItems: MenuItemElement[] = []
    private currentContext: SelectionContext = 'none'
    private scrollContainer: HTMLElement | Window = window
    private activeImageWrapper: HTMLElement | null = null

    constructor({ view }: BubbleMenuViewOptions) {
        this.view = view
        this.debounceDelay = isTouchDevice() ? 350 : 200

        this.menu = createEl('div', {
            className: 'bubble-menu',
            role: 'toolbar',
            'aria-label': 'Formatting toolbar',
            tabIndex: 0,
            style: {
                position: 'fixed',
                visibility: 'hidden',
                zIndex: '100',
            },
        })

        this.menuContent = createEl('div', { className: 'bubble-menu-content' })
        this.menu.appendChild(this.menuContent)

        this.buildMenu()

        this.menu.addEventListener('mousedown', this.handleMenuMouseDown)

        // Track selection state
        view.dom.addEventListener('mousedown', this.handleEditorMouseDown)
        view.dom.addEventListener('touchstart', this.handleEditorTouchStart)
        document.addEventListener('mouseup', this.handleDocumentMouseUp)
        document.addEventListener('touchend', this.handleDocumentTouchEnd)

        // Listen for image resize events
        view.dom.addEventListener('image-resize', this.handleImageResize)

        // Listen for scroll events to reposition menu
        this.scrollContainer = this.findScrollContainer(view.dom)
        this.scrollContainer.addEventListener('scroll', this.handleScroll, { passive: true })

        view.dom.parentNode?.appendChild(this.menu)

        if (isTouchDevice()) {
            window.visualViewport?.addEventListener('resize', this.handleViewportResize)
        }
    }

    // Expose view for image actions
    getView(): EditorView {
        return this.view
    }

    private buildMenu(): void {
        const { items, linkInputPanel } = buildBubbleMenuItems(this.view, this)
        this.menuItems = items
        this.linkInputPanel = linkInputPanel

        // Add all items to content (visibility controlled by context)
        for (const item of items) {
            this.menuContent.appendChild(item.element)
        }

        if (this.linkInputPanel) {
            this.menu.appendChild(this.linkInputPanel)
        }
    }

    private updateVisibleItems(context: SelectionContext): void {
        this.currentContext = context

        // Show/hide items based on context
        for (const item of this.menuItems) {
            const isVisible = item.context.includes(context)
            item.element.style.display = isVisible ? '' : 'none'
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
            setTimeout(() => this.showIfNeeded(), 10)
        }
    }

    private handleDocumentTouchEnd = (): void => {
        if (this.isSelecting) {
            this.isSelecting = false
            setTimeout(() => this.showIfNeeded(), 100)
        }
    }

    private handleImageResize = (): void => {
        if (this.currentContext === 'image' && this.menu.classList.contains('is-visible')) {
            this.updatePosition()
        }
    }

    private handleScroll = (): void => {
        if (this.menu.classList.contains('is-visible')) {
            this.updatePosition()
        }
    }

    private findScrollContainer(element: HTMLElement): HTMLElement | Window {
        let current: HTMLElement | null = element
        while (current) {
            const style = getComputedStyle(current)
            if (style.overflow === 'auto' || style.overflow === 'scroll' || style.overflowY === 'auto' || style.overflowY === 'scroll') {
                return current
            }
            current = current.parentElement
        }
        return window
    }

    private showIfNeeded(): void {
        const context = getSelectionContext(this.view)
        if (context !== 'none' && this.shouldShow(context) && !this.isSelecting) {
            this.updateVisibleItems(context)
            this.show()
            this.updateMenuState()
            this.updatePosition()
        }
    }

    private handleViewportResize = (): void => {
        const context = getSelectionContext(this.view)
        if (context !== 'none' && this.shouldShow(context)) {
            this.updatePosition()
        }
    }

    private shouldShow(context: SelectionContext): boolean {
        if (!this.view.hasFocus()) return false
        if (!this.view.editable) return false
        if (context === 'none') return false

        const { state } = this.view
        const { selection } = state
        const { $from, $to } = selection

        // Don't show in code blocks
        const isCodeBlock = $from.parent.type.name === 'code_block' || $to.parent.type.name === 'code_block'
        if (isCodeBlock) return false

        // Don't show in document title
        const isDocumentTitle = $from.parent.type.name === documentTitleNodeType || $to.parent.type.name === documentTitleNodeType
        if (isDocumentTitle) return false

        return true
    }

    private getImageElement(): HTMLImageElement | null {
        const { selection } = this.view.state
        if (!(selection instanceof NodeSelection)) return null
        if (selection.node.type.name !== 'image') return null

        const nodeDom = this.view.nodeDOM(selection.from)
        if (!nodeDom) return null

        const element = nodeDom as HTMLElement

        if (element.classList?.contains('pm-image-wrapper')) {
            const img = element.querySelector('img')
            if (img) return img
        }

        if (element.tagName === 'IMG') {
            return element as HTMLImageElement
        }

        const img = element.querySelector?.('img')
        if (img) return img

        return null
    }

    private getImageWrapper(): HTMLElement | null {
        const { selection } = this.view.state
        if (!(selection instanceof NodeSelection)) return null
        if (selection.node.type.name !== 'image') return null

        const nodeDom = this.view.nodeDOM(selection.from)
        if (!nodeDom) return null

        const element = nodeDom as HTMLElement
        if (element.classList?.contains('pm-image-wrapper')) {
            return element
        }

        return null
    }

    private createTextVirtualElement(): VirtualElement {
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

    private async updatePosition(retryCount = 0): Promise<void> {
        if (this.currentContext === 'image') {
            // Position below the image, centered
            const imgElement = this.getImageElement()
            if (!imgElement) {
                // After undo, the DOM might not be ready yet - retry a few times
                if (retryCount < 3) {
                    requestAnimationFrame(() => this.updatePosition(retryCount + 1))
                }
                return
            }

            const imageRect = imgElement.getBoundingClientRect()

            // Measure toolbar
            this.menu.style.visibility = 'hidden'
            this.menu.style.display = 'flex'
            const toolbarRect = this.menu.getBoundingClientRect()

            // Center toolbar horizontally below the image
            const imageCenterX = imageRect.left + imageRect.width / 2
            const toolbarLeft = imageCenterX - toolbarRect.width / 2
            const toolbarTop = imageRect.bottom + 8

            // Clamp to viewport bounds
            const maxLeft = window.innerWidth - toolbarRect.width - 8
            const clampedLeft = Math.max(8, Math.min(toolbarLeft, maxLeft))

            Object.assign(this.menu.style, {
                left: `${clampedLeft}px`,
                top: `${toolbarTop}px`,
                visibility: 'visible',
            })
        } else {
            // Position above text selection using floating-ui
            const virtualElement = this.createTextVirtualElement()

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
    }

    update(): void {
        if (this.isSelecting) {
            return
        }

        const wasVisible = this.menu.classList.contains('is-visible')
        const context = getSelectionContext(this.view)

        if (this.preventHide) {
            this.preventHide = false
            this.updateMenuState()
            this.markImageActive()
            // Reposition after state change (e.g., alignment changed)
            requestAnimationFrame(() => {
                this.updatePosition()
            })
            return
        }

        if (this.isLinkInputActive) {
            return
        }

        const shouldBeVisible = context !== 'none' && this.shouldShow(context)

        if (shouldBeVisible && !wasVisible) {
            this.updateVisibleItems(context)
            this.show()
            this.markImageActive()
            this.updateMenuState()
            // Use requestAnimationFrame to ensure DOM is updated before positioning
            requestAnimationFrame(() => {
                this.updatePosition()
            })
        } else if (shouldBeVisible && wasVisible) {
            // Context might have changed
            if (context !== this.currentContext) {
                this.updateVisibleItems(context)
            }

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
        if (this.currentContext === 'text') {
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
            for (const item of this.menuItems) {
                if (item.update) item.update()
            }
        } else if (this.currentContext === 'image') {
            // Update image button states (alignment, wrap)
            updateImageButtonStates(this.menuItems, this.view)
        }
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

    private markImageActive(): void {
        // Mark image as menu-active to keep selection visible
        if (this.currentContext === 'image') {
            const wrapper = this.getImageWrapper()
            if (wrapper && wrapper !== this.activeImageWrapper) {
                this.activeImageWrapper?.classList.remove('pm-image-menu-active')
                this.activeImageWrapper = wrapper
            }
            this.activeImageWrapper?.classList.add('pm-image-menu-active')
        }
    }

    private hide(): void {
        this.menu.style.visibility = 'hidden'
        this.menu.classList.remove('is-visible')
        this.currentContext = 'none'
        this.closeLinkInput()

        // Remove menu-active state from image
        this.activeImageWrapper?.classList.remove('pm-image-menu-active')
        this.activeImageWrapper = null
    }

    forceHide(): void {
        this.preventHide = false
        this.hide()
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
        this.view.dom.removeEventListener('image-resize', this.handleImageResize)
        this.scrollContainer.removeEventListener('scroll', this.handleScroll)
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
