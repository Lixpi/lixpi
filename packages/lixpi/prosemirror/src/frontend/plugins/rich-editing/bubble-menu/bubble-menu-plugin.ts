import {
    Plugin,
    PluginKey,
    NodeSelection,
} from 'prosemirror-state'
import {
    type Node as ProseMirrorNode,
} from 'prosemirror-model'
import {
    type EditorView,
} from 'prosemirror-view'
import {
    BubbleMenu,
    type BubbleMenuPositionRequest,
} from '@lixpi/ui-kit/components/bubble-menu'
import {
    buildBubbleMenuItems,
    getSelectionContext,
    updateImageButtonStates,
    type BubbleMenuItemDefinition,
    type MenuItemElement,
    type SelectionContext,
} from './bubble-menu-items.ts'

export const bubbleMenuPluginKey = new PluginKey('bubbleMenu')

const isTouchDevice = (): boolean => 'ontouchstart' in window || navigator.maxTouchPoints > 0

const resolvedPositionHasNodeType = (
    position: {
        depth: number
        node: (depth: number) => ProseMirrorNode
    },
    nodeType: string,
): boolean => {
    for (let depth = position.depth; depth >= 0; depth -= 1) {
        if (position.node(depth).type.name === nodeType)
            return true
    }

    return false
}

type BubbleMenuViewOptions = {
    downloadImage?: (src: string) => Promise<void>
    // Replaces the default rich-text items.
    items?: BubbleMenuItemDefinition[]
    presentation?: BubbleMenuPresentation
    view: EditorView
}

// How a view presents the menu. By default it opens for a text selection,
// above it. A view can open it for the line holding the caret instead, beside
// that line.
export type BubbleMenuPresentation = {
    textPlacement?: 'above' | 'below' | 'right'
    // When the menu belongs on screen. Defaults to a text or image selection.
    selectionContext?: (view: EditorView) => SelectionContext
}

class BubbleMenuView {
    private view: EditorView
    private bubbleMenu: BubbleMenu
    private menuItems: MenuItemElement[] = []
    private updateDebounceTimer: ReturnType<typeof setTimeout> | null = null
    private readonly debounceDelay: number
    private linkInputPanel: HTMLElement | null = null
    private isLinkInputActive = false
    private isSelecting = false
    // Set by a press outside the text, or one a feature consumed. The menu
    // stays closed until the user selects text again, whatever the editor
    // updates in the meantime.
    private dismissed = false
    private readonly textPlacement: 'above' | 'below' | 'right'
    private readonly selectionContext: (view: EditorView) => SelectionContext
    private currentContext: SelectionContext = 'none'
    private activeImageWrapper: HTMLElement | null = null

    constructor({
        downloadImage,
        items: menuItems,
        presentation = {},
        view,
    }: BubbleMenuViewOptions) {
        this.textPlacement = presentation.textPlacement ?? 'above'
        this.selectionContext = presentation.selectionContext ?? getSelectionContext
        this.view = view
        this.debounceDelay = isTouchDevice() ? 350 : 200

        const {
            items,
            linkInputPanel,
        } = buildBubbleMenuItems(
            this.view,
            this,
            downloadImage,
            menuItems,
        )
        this.menuItems = items
        this.linkInputPanel = linkInputPanel

        const menuParent = view.dom.parentNode as HTMLElement

        this.bubbleMenu = new BubbleMenu({
            parentEl: menuParent,
            items: this.menuItems,
            panels: this.linkInputPanel ? [this.linkInputPanel] : [],
            onHide: () => {
                this.currentContext = 'none'
                this.closeLinkInput()
                this.activeImageWrapper?.classList.remove('pm-image-menu-active')
                this.activeImageWrapper = null
            },
        })

        // Track selection state
        view.dom.addEventListener('mousedown', this.handleEditorMouseDown)
        view.dom.addEventListener('touchstart', this.handleEditorTouchStart)
        view.dom.addEventListener('focusout', this.handleEditorFocusOut)
        view.dom.addEventListener('keydown', this.handleEditorKeyDown)
        // Capture, because the canvas and panels stop their presses from
        // reaching the page or moving focus.
        document.addEventListener(
            'pointerdown',
            this.handleDocumentPointerDown,
            true,
        )
        document.addEventListener('mouseup', this.handleDocumentMouseUp)
        document.addEventListener('touchend', this.handleDocumentTouchEnd)

        // Listen for image resize events
        view.dom.addEventListener('image-resize', this.handleImageResize)
    }

    // Expose view for image actions
    getView(): EditorView {
        return this.view
    }

    // A press that a feature already consumed, such as a click on a
    // non-text row, is not a text selection, so its release does not bring
    // the menu back.
    private handleEditorMouseDown = (event: MouseEvent): void => {
        const inText = !event.defaultPrevented && this.pressLandsInText(event.target)
        this.isSelecting = inText
        this.dismissed = !inText
        this.close()
    }

    // A press in a text block can start a selection. A press on the editor's
    // empty space, between or below its blocks, cannot, and is a click away.
    private pressLandsInText(target: EventTarget | null): boolean {
        if (
            !(target instanceof Node)
            || target === this.view.dom
        )
            return false

        try {
            return this.view.state.doc.resolve(
                this.view.posAtDOM(target, 0),
            ).parent.isTextblock
        } catch {
            return false
        }
    }

    // Hides the menu and drops any pending reposition, which would otherwise
    // show it again.
    private close(): void {
        if (this.updateDebounceTimer) {
            clearTimeout(this.updateDebounceTimer)
            this.updateDebounceTimer = null
        }

        this.bubbleMenu.hide()
    }

    private handleEditorKeyDown = (): void => void (this.dismissed = false)

    private handleDocumentPointerDown = (event: PointerEvent): void => {
        const target = event.target as Node | null

        if (
            !target
            || this.view.dom.contains(target)
            || this.bubbleMenu.element.contains(target)
        )
            return

        this.dismissed = true
        this.close()
    }

    // Focus leaving the text, to another part of the page or to a focusable
    // element inside the editor, closes the menu. Focus moving into the menu
    // itself keeps it.
    private handleEditorFocusOut = (event: FocusEvent): void => {
        const next = event.relatedTarget as Node | null

        if (
            next
            && this.bubbleMenu.element.contains(next)
        )
            return

        // Switching to another window takes focus from the whole page; the
        // caret is still there when the user comes back, so the menu stays.
        // Only focus moving elsewhere on the page closes it.
        setTimeout(() => {
            if (
                document.hasFocus()
                && !this.view.hasFocus()
            )
                this.close()
        })
    }

    private handleEditorTouchStart = (): void => void (this.isSelecting = true)

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
        if (
            this.currentContext === 'image'
            && this.bubbleMenu.isVisible
        ) {
            const position = this.getPositionRequest()

            if (position)
                this.bubbleMenu.reposition(position)
        }
    }

    private showIfNeeded(): void {
        const context = this.selectionContext(this.view)

        if (
            context !== 'none'
            && this.shouldShow(context)
            && !this.isSelecting
        ) {
            this.currentContext = context
            const position = this.getPositionRequest()

            if (position) {
                this.bubbleMenu.show(context, position)
                this.markImageActive()
                this.updateMenuState()
            }
        }
    }

    private shouldShow(context: SelectionContext): boolean {
        if (this.dismissed)
            return false

        if (!this.view.hasFocus())
            return false

        if (!this.view.editable)
            return false

        if (context === 'none')
            return false

        const { state } = this.view
        const { selection } = state
        const {
            $from,
            $to,
        } = selection

        const selectsDocumentTitle = selection instanceof NodeSelection
            ? selection.node.type.name === 'documentTitle'
            : resolvedPositionHasNodeType($from, 'documentTitle')
                || resolvedPositionHasNodeType($to, 'documentTitle')

        if (selectsDocumentTitle)
            return false

        // Don't show in code blocks
        const isCodeBlock = $from.parent.type.name === 'code_block' || $to.parent.type.name === 'code_block'

        if (isCodeBlock)
            return false

        return true
    }

    private getImageElement(): HTMLImageElement | null {
        const { selection } = this.view.state

        if (!(selection instanceof NodeSelection))
            return null

        const nodeType = selection.node.type.name

        if (
            nodeType !== 'image'
            && nodeType !== 'aiGeneratedImage'
        )
            return null

        const nodeDom = this.view.nodeDOM(selection.from)

        if (!nodeDom)
            return null

        const element = nodeDom as HTMLElement

        if (element.classList?.contains('pm-image-wrapper')) {
            const img = element.querySelector('img')

            if (img)
                return img
        }

        if (element.tagName === 'IMG')
            return element as HTMLImageElement

        const img = element.querySelector?.('img')

        if (img)
            return img

        return null
    }

    private getImageWrapper(): HTMLElement | null {
        const { selection } = this.view.state

        if (!(selection instanceof NodeSelection))
            return null

        const nodeType = selection.node.type.name

        if (
            nodeType !== 'image'
            && nodeType !== 'aiGeneratedImage'
        )
            return null

        const nodeDom = this.view.nodeDOM(selection.from)

        if (!nodeDom)
            return null

        const element = nodeDom as HTMLElement

        if (element.classList?.contains('pm-image-wrapper'))
            return element

        return null
    }

    private getPositionRequest(): BubbleMenuPositionRequest | null {
        if (this.currentContext === 'image') {
            const imgElement = this.getImageElement()

            if (!imgElement)
                return null

            return {
                targetRect: imgElement.getBoundingClientRect(),
                placement: 'below',
            }
        }

        // At the far right of the caret's line, inside it.
        if (this.textPlacement === 'right') {
            const { $from } = this.view.state.selection
            const line = this.view.nodeDOM(
                $from.before(),
            ) as HTMLElement | null

            if (!line?.getBoundingClientRect)
                return null

            return {
                targetRect: line.getBoundingClientRect(),
                placement: 'right',
                horizontalAlignment: 'end',
            }
        }

        // Text context: compute selection bounding rect
        const { state } = this.view
        const {
            from,
            to,
        } = state.selection

        const start = this.view.coordsAtPos(from)
        const end = this.view.coordsAtPos(to)

        const left = Math.min(start.left, end.left)
        const right = Math.max(start.right, end.right)
        const top = Math.min(start.top, end.top)
        const bottom = Math.max(start.bottom, end.bottom)

        const targetRect = new DOMRect(
            left,
            top,
            right - left,
            bottom - top,
        )

        return {
            targetRect,
            placement: this.textPlacement,
        }
    }

    update(): void {
        if (this.isSelecting)
            return

        const wasVisible = this.bubbleMenu.isVisible
        const context = this.selectionContext(this.view)

        if (this.bubbleMenu.preventHide) {
            this.bubbleMenu.preventHide = false
            this.currentContext = context !== 'none' ? context : this.currentContext
            this.updateMenuState()
            this.markImageActive()
            // Reposition after state change (e.g., alignment changed)
            const position = this.getPositionRequest()

            if (position)
                requestAnimationFrame(() => void this.bubbleMenu.reposition(position))

            return
        }

        if (this.isLinkInputActive)
            return

        const shouldBeVisible = context !== 'none' && this.shouldShow(context)

        if (
            shouldBeVisible
            && !wasVisible
        ) {
            this.currentContext = context
            const position = this.getPositionRequest()

            if (position) {
                this.bubbleMenu.show(context, position)
                this.markImageActive()
                this.updateMenuState()
            }
        } else if (
            shouldBeVisible
            && wasVisible
        ) {
            // Context might have changed
            if (context !== this.currentContext)
                this.currentContext = context

            if (this.updateDebounceTimer)
                clearTimeout(this.updateDebounceTimer)

            this.updateDebounceTimer = setTimeout(
                () => {
                    this.updateMenuState()
                    const position = this.getPositionRequest()

                    if (position)
                        this.bubbleMenu.updateContext(context, position)
                },
                this.debounceDelay,
            )
        } else if (!shouldBeVisible)
            this.bubbleMenu.hide()
    }

    private updateMenuState(): void {
        if (this.currentContext === 'text') {
            // Update mark button states
            const buttons = this.bubbleMenu.element.querySelectorAll('.bubble-menu-button')
            buttons.forEach(button => {
                const updateFn = (button as HTMLElement).dataset.update

                if (updateFn) {
                    const isActive = this.checkMarkActive((button as HTMLElement).dataset.markType || '')
                    button.classList.toggle('is-active', isActive)
                }
            })

            // Update dropdown labels
            for (const item of this.menuItems) {
                if (item.update)
                    item.update()
            }
        } else if (this.currentContext === 'image') {
            // Update image button states (alignment, wrap)
            updateImageButtonStates(this.menuItems, this.view)
        }
    }

    private checkMarkActive(markType: string): boolean {
        const { state } = this.view
        const {
            from,
            $from,
            to,
            empty,
        } = state.selection
        const type = state.schema.marks[markType]

        if (!type)
            return false

        if (empty)
            return !!type.isInSet(state.storedMarks || $from.marks())

        return state.doc.rangeHasMark(
            from,
            to,
            type,
        )
    }

    private markImageActive(): void {
        if (this.currentContext === 'image') {
            const wrapper = this.getImageWrapper()

            if (
                wrapper
                && wrapper !== this.activeImageWrapper
            ) {
                this.activeImageWrapper?.classList.remove('pm-image-menu-active')
                this.activeImageWrapper = wrapper
            }

            this.activeImageWrapper?.classList.add('pm-image-menu-active')
        }
    }

    forceHide(): void {
        this.bubbleMenu.forceHide()
    }

    showLinkInput(): void {
        this.isLinkInputActive = true

        if (this.linkInputPanel) {
            this.linkInputPanel.classList.add('is-active')
            const input = this.linkInputPanel.querySelector('input') as HTMLInputElement

            if (input) {
                const { state } = this.view
                const {
                    from,
                    to,
                } = state.selection
                const linkMark = state.schema.marks.link
                let existingHref = ''

                state.doc.nodesBetween(
                    from,
                    to,
                    (node: ProseMirrorNode) => {
                        const mark = linkMark.isInSet(node.marks)

                        if (mark)
                            existingHref = mark.attrs.href || ''
                    },
                )

                input.value = existingHref
                setTimeout(() => input.focus(), 0)
            }
        }
    }

    closeLinkInput(): void {
        this.isLinkInputActive = false

        if (this.linkInputPanel)
            this.linkInputPanel.classList.remove('is-active')
    }

    applyLink(href: string): void {
        const {
            state,
            dispatch,
        } = this.view
        const {
            from,
            to,
        } = state.selection
        const linkMark = state.schema.marks.link

        if (!href.trim())
            dispatch(
                state.tr.removeMark(
                    from,
                    to,
                    linkMark,
                ),
            )
        else {
            const normalizedHref = href.startsWith('http://')
                || href.startsWith('https://')
                ? href
                : `https://${href}`
            dispatch(
                state.tr.addMark(
                    from,
                    to,
                    linkMark.create({ href: normalizedHref }),
                ),
            )
        }

        this.closeLinkInput()
        this.view.focus()
    }

    removeLink(): void {
        const {
            state,
            dispatch,
        } = this.view
        const {
            from,
            to,
        } = state.selection
        const linkMark = state.schema.marks.link
        dispatch(
            state.tr.removeMark(
                from,
                to,
                linkMark,
            ),
        )
        this.closeLinkInput()
        this.view.focus()
    }

    destroy(): void {
        if (this.updateDebounceTimer)
            clearTimeout(this.updateDebounceTimer)

        this.view.dom.removeEventListener('mousedown', this.handleEditorMouseDown)
        this.view.dom.removeEventListener('touchstart', this.handleEditorTouchStart)
        this.view.dom.removeEventListener('image-resize', this.handleImageResize)
        document.removeEventListener('mouseup', this.handleDocumentMouseUp)
        this.view.dom.removeEventListener('focusout', this.handleEditorFocusOut)
        this.view.dom.removeEventListener('keydown', this.handleEditorKeyDown)
        document.removeEventListener(
            'pointerdown',
            this.handleDocumentPointerDown,
            true,
        )
        document.removeEventListener('touchend', this.handleDocumentTouchEnd)
        this.bubbleMenu.destroy()
    }
}

export const bubbleMenuPlugin = (
    downloadImage?: (src: string) => Promise<void>,
    items?: BubbleMenuItemDefinition[],
    presentation?: BubbleMenuPresentation,
): Plugin => {
    return new Plugin({
        key: bubbleMenuPluginKey,
        view(editorView: EditorView) {
            return new BubbleMenuView({
                downloadImage,
                items,
                presentation,
                view: editorView,
            })
        },
    })
}

export { BubbleMenuView }
