import { Plugin, PluginKey, NodeSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { createEl } from '$src/utils/domTemplates.ts'
import { buildBubbleMenuItems, getSelectionContext, updateImageButtonStates, type MenuItemElement, type SelectionContext } from '$src/components/proseMirror/plugins/bubbleMenuPlugin/bubbleMenuItems.ts'
import { documentTitleNodeType } from '$src/components/proseMirror/customNodes/documentTitleNode.js'

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
    private menuParent: HTMLElement | null = null

    constructor({ view }: BubbleMenuViewOptions) {
        this.view = view
        this.debounceDelay = isTouchDevice() ? 350 : 200

        this.menu = createEl('div', {
            className: 'bubble-menu',
            role: 'toolbar',
            'aria-label': 'Formatting toolbar',
            tabIndex: 0,
            style: {
                position: 'absolute',
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

        // Append to editor's parent - menu will scale with the transformed viewport
        this.menuParent = view.dom.parentNode as HTMLElement
        this.menuParent?.appendChild(this.menu)

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

    private findTransformedAncestor(): { element: HTMLElement; scale: number } | null {
        // Walk up the DOM tree to find an ancestor with a CSS transform
        let current: HTMLElement | null = this.menuParent
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
        // Convert screen coordinates to local coordinates relative to menuParent
        // accounting for CSS transforms on ancestor elements
        if (!this.menuParent) {
            return { x: screenX, y: screenY }
        }

        const parentRect = this.menuParent.getBoundingClientRect()
        const transformInfo = this.findTransformedAncestor()
        const scale = transformInfo?.scale ?? 1

        // parentRect is already in screen coordinates (post-transform)
        // So the offset from screen to parent is just the difference
        // But we need to divide by scale to get local coordinates
        const localX = (screenX - parentRect.left) / scale
        const localY = (screenY - parentRect.top) / scale

        return { x: localX, y: localY }
    }

    private getScale(): number {
        const transformInfo = this.findTransformedAncestor()
        return transformInfo?.scale ?? 1
    }

    private updatePosition(retryCount = 0): void {
        const scale = this.getScale()

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
            const toolbarWidthLocal = toolbarRect.width / scale

            // Center toolbar horizontally below the image (in screen coords)
            const imageCenterX = imageRect.left + imageRect.width / 2
            const toolbarScreenLeft = imageCenterX - toolbarRect.width / 2
            const toolbarScreenTop = imageRect.bottom + 8 * scale

            // Convert to local coordinates
            const local = this.screenToLocal(toolbarScreenLeft, toolbarScreenTop)

            // Clamp to parent bounds (in local coordinates)
            const parentRect = this.menuParent?.getBoundingClientRect()
            const parentWidthLocal = parentRect ? parentRect.width / scale : window.innerWidth
            const maxLeft = parentWidthLocal - toolbarWidthLocal - 8
            const clampedLeft = Math.max(8, Math.min(local.x, maxLeft))

            Object.assign(this.menu.style, {
                left: `${clampedLeft}px`,
                top: `${local.y}px`,
                visibility: 'visible',
            })
        } else {
            // Position above text selection
            const { state } = this.view
            const { from, to } = state.selection

            const start = this.view.coordsAtPos(from)
            const end = this.view.coordsAtPos(to)

            // Measure menu
            this.menu.style.visibility = 'hidden'
            this.menu.style.display = 'flex'
            const menuRect = this.menu.getBoundingClientRect()
            const menuWidthLocal = menuRect.width / scale

            // Calculate center of selection in screen coords
            const selectionLeft = Math.min(start.left, end.left)
            const selectionRight = Math.max(start.right, end.right)
            const selectionTop = Math.min(start.top, end.top)
            const selectionBottom = Math.max(start.bottom, end.bottom)
            const selectionCenterX = (selectionLeft + selectionRight) / 2

            // Position menu above selection, centered (in screen coords)
            const menuScreenLeft = selectionCenterX - menuRect.width / 2
            const menuScreenTop = selectionTop - menuRect.height - 8 * scale

            // Convert to local coordinates
            const local = this.screenToLocal(menuScreenLeft, menuScreenTop)

            // Clamp horizontal position
            const parentRect = this.menuParent?.getBoundingClientRect()
            const parentWidthLocal = parentRect ? parentRect.width / scale : window.innerWidth
            const maxLeft = parentWidthLocal - menuWidthLocal - 8
            const clampedLeft = Math.max(8, Math.min(local.x, maxLeft))

            // Check if menu would go above parent bounds, flip to below
            let finalY = local.y
            if (local.y < 8) {
                const belowScreenTop = selectionBottom + 8 * scale
                finalY = this.screenToLocal(0, belowScreenTop).y
            }

            Object.assign(this.menu.style, {
                left: `${clampedLeft}px`,
                top: `${finalY}px`,
                visibility: 'visible',
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
